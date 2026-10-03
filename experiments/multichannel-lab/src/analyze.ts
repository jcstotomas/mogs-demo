import { hashRecord } from './contracts.ts';
import type { Asset, Facts, Finding, Label, Unit } from './contracts.ts';

/** Deliberately narrow, deterministic rules. No model, embeddings, or relevance filter. */
export const ENGINE = 'mogs-explicit-pricing-rules-v2';
const PRICING = /(?:\$\s*\d|\b(?:prices?|pricing|costs?|billing|billed|dollars?|savings?|percent|affordable)\b|\d\s*%)/i;
const CONDITIONAL = /\{%\s*(?:if|elsif|else|unless|case|when)\b|\[\[(?:if|else)\b/i;
const NEW = /\b(?:new customers?|new signups?|public (?:offer|price|pricing)|without legacy eligibility|not legacy[- ]eligible|lapsed customers?|win-?back|returning customers?)\b/i;
const LEGACY = /\b(?:legacy[- ]eligible|grandfathered|active Starter monthly subscribers.{0,110}(?:before|pre-change|pre-cutoff))\b/i;
const HISTORICAL = /\b(?:when we launched|at launch|historical(?: pricing)?|previously|in 20(?:[01]\d|2[0-5]))\b/i;
const amount = (cents:number):string => '$' + (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
const normalize = (text:string):string => text.replace(/\s+/g, ' ').trim();
const numbers = (text:string):string[] => text.match(/\d+(?:\.\d+)?/g) ?? [];
const protectedTokens = (text:string):string[] => text.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|https?:\/\/[^\s<>"']+/g) ?? [];

type Scope = 'public'|'legacy'|'historical'|'unknown'|'conflict';
function evidence(text:string):{public:boolean;legacy:boolean;historical:boolean} {
  // Negated eligibility must not also count as an affirmative legacy qualifier.
  const cleaned=text.replace(/not legacy[- ]eligible|without legacy eligibility/gi,'');
  return {public:NEW.test(text),legacy:LEGACY.test(cleaned),historical:HISTORICAL.test(text)};
}
function resolveScope(unit:Unit, asset:Asset, facts:Facts):Scope {
  const contextOnly=unit.context.split(/\r?\n/).filter(line=>{
    if (normalize(line) === normalize(unit.text)) return false;
    if (!/(?:\$\s*\d|\d\s*%|\bdollar\b)/i.test(line)) return true;
    // Monetary footnotes can establish eligibility. A neighboring independent
    // price assertion must not silently supply scope for this occurrence.
    const scoped=evidence(line);
    return (scoped.public || scoped.legacy || scoped.historical)
      && /^\s*[*†‡]?\s*(?:for|only|available (?:only )?to|applies (?:only )?to|eligible|legacy|grandfathered|active)\b/i.test(line)
      && !/\b(?:Starter (?:is|costs|monthly)|Save \d|Team is)\b/i.test(line);
  }).join('\n');
  const own=evidence(unit.text), nearby=evidence(contextOnly);
  const datedLegacy=(unit.text+'\n'+contextOnly).match(/active Starter monthly subscribers[^\n]{0,110}before (20\d\d-\d\d-\d\d)/i);
  if (datedLegacy && (Number.isNaN(Date.parse(datedLegacy[1]!)) || Date.parse(datedLegacy[1]!) > Date.parse(facts.legacyCutoff))) return 'conflict';
  if (own.public && own.legacy) return 'conflict';
  if (own.historical && own.public) return 'conflict';
  if (own.historical) return 'historical';
  // An explicit passage scope takes precedence over document audience hints.
  if (own.public) return 'public';
  if (own.legacy) return 'legacy';
  if (nearby.public && nearby.legacy) return 'conflict';
  if (nearby.historical && nearby.public) return 'conflict';
  if (nearby.historical) return 'historical';
  if (nearby.public) return asset.context.legacyEligible === true ? 'conflict' : 'public';
  if (nearby.legacy) return asset.context.legacyEligible === false ? 'conflict' : 'legacy';
  if (asset.context.audience === 'historical') return 'historical';
  if (asset.context.audience === 'new_customers' && asset.context.legacyEligible === true) return 'conflict';
  if (asset.context.legacyEligible === true) return 'legacy';
  if (asset.context.legacyEligible === false || asset.context.audience === 'new_customers') return 'public';
  return 'unknown';
}
// A supported price substring is insufficient: its own surrounding clause must
// also be understood. Preserve independent greetings/signatures, tokens and URLs.
function supportedEnvelope(text:string, match:RegExpMatchArray, monthly:boolean):boolean {
  const references=(value:string)=>value.replace(/\{\{[\s\S]*?\}\}|https?:\/\/[^\s<>"']+/g,'');
  const scopes=(value:string)=>value
    .replace(/\b(?:for\s+)?(?:new customers?|new signups?|lapsed customers?|returning customers?|win-?back customers?|the public offer|customers? without legacy eligibility|customers? who are not legacy[- ]eligible|legacy[- ]eligible subscribers?|grandfathered (?:customers?|subscribers?))(?:\s+only)?\b/gi,'')
    .replace(/\b(?:for\s+)?active Starter monthly subscribers(?: who (?:subscribed|started))? before 20\d\d-\d\d-\d\d\b/gi,'')
    .replace(/\bwithout legacy eligibility\b|\bnot legacy[- ]eligible\b/gi,'');
  const index=match.index ?? 0;
  const prefix=references(text.slice(0,index)).split(/[.!?](?:\s|$)/).at(-1) ?? '';
  const suffix=references(text.slice(index+match[0].length)).split(/[.!?](?:\s|$)/)[0] ?? '';
  const plain=(value:string)=>value.replace(/[\s,;:|()[\]"'–—-]/g,'');
  const before=scopes(prefix).replace(/^\s*(?:hello|hi|dear)(?:\s+[\p{L}' -]+)?\s*[,!:]?\s*$/iu,'');
  let after=scopes(suffix).replace(/\b(?:in\s+)?(?:USD|US dollars?)\b/gi,'');
  if (monthly) after=after.replace(/\bbilled monthly\b/gi,'');
  return plain(before)==='' && plain(after)==='';
}

interface Decision {label:Label;kind:string;rationale:string;replacement?:string;withhold?:string;old?:string;target?:string}
function unresolved(kind:string, reason:string):Decision {return {label:'insufficient_context',kind,rationale:reason,withhold:reason};}
function decide(unit:Unit, asset:Asset, facts:Facts):Decision {
  const text=normalize(unit.text), scope=resolveScope(unit,asset,facts);
  if (!PRICING.test(text)) return {label:'unrelated',kind:'none',rationale:'No supported pricing assertion occurs in this text block.'};
  if (unit.uncertain || (unit.confidence !== null && unit.confidence < 0.80)) return unresolved('other_pricing','Extraction is uncertain; inspect the original region before making a claim or suggesting copy.');
  if (CONDITIONAL.test(unit.text) || CONDITIONAL.test(unit.context)) return unresolved('other_pricing','An unresolved template conditional affects this block. No branch-specific correction is safe.');
  if (/\b(?:Locations add-on|cancel within \d+ days)\b/i.test(text) && !/\bStarter\b/i.test(text)) return {label:'unrelated',kind:'none',rationale:'This statement is about an unrelated add-on or cancellation policy.'};
  if (!/\bStarter\b/i.test(text)) return unresolved('other_pricing','The pricing text does not identify a supported Starter claim, billing term, or eligibility scope.');
  if (HISTORICAL.test(unit.text) && scope !== 'conflict') return {label:'valid_exception',kind:'other_pricing',rationale:'This passage explicitly describes historical pricing; the current change does not rewrite history.'};
  if (/\bStarter is (?:our |the )?most affordable plan\.?$/i.test(text)) {
    return facts.monthlyCents < facts.teamMonthlyCents
      ? {label:'consistent',kind:'other_pricing',rationale:'Starter remains less expensive than Team in the supplied fact snapshot.'}
      : unresolved('other_pricing','The supported plan-ordering claim is not established by these facts.');
  }
  const annual=text.match(/Starter (?:is|costs) (\$\d+(?:\.\d{1,2})?) (?:a|per) year(?:,? or (\$\d+(?:\.\d{1,2})?) (?:a|per) month billed annually)?\.?/i);
  if (annual) {
    if (PRICING.test(text.replace(annual[0],''))) return unresolved('other_pricing','A second pricing assertion occurs outside the supported annual claim.');
    const annualCorrect = Math.round(Number(annual[1]!.slice(1))*100) === facts.annualCents;
    const monthlyCorrect = !annual[2] || Math.round(Number(annual[2].slice(1))*100) === facts.annualCents/12;
    return annualCorrect && monthlyCorrect
      ? {label:'consistent',kind:'other_pricing',rationale:'The annual price and effective monthly amount are unchanged in the supplied facts.'}
      : {label:'contradicting',kind:'other_pricing',rationale:'The stated annual amount disagrees with the supplied facts.',withhold:'Annual-price rewriting is outside this explicit-rule repair set.'};
  }
  if (scope === 'conflict') return unresolved('other_pricing','Conflicting public, legacy, or historical scope requires review.');
  if (scope === 'historical') return {label:'valid_exception',kind:'other_pricing',rationale:'The local context explicitly identifies historical pricing.'};
  if (scope === 'unknown') return unresolved('other_pricing','Legacy eligibility is unknown. An existing-customer audience alone does not establish eligibility.');
  const monthly=scope === 'legacy' ? facts.legacyMonthlyCents : facts.monthlyCents;
  const direct=text.match(/\bStarter (?:(?:is|costs) (\$\d+(?:\.\d{1,2})?) (?:a|per) month|monthly\s*[:|]?\s*(\$\d+(?:\.\d{1,2})?))(?!\d)/i);
  const savings=text.match(/\bSave (\d+(?:\.\d+)?)% on Starter with annual billing\b/i);
  const daily=text.match(/\bStarter costs (?:about )?(a dollar|\$\d+(?:\.\d{1,2})?) (?:a|per) day\b/i);
  const gap=text.match(/\bTeam is (?:only )?(\$\d+(?:\.\d{1,2})?) (?:a|per) month more than Starter\b/i);
  const threshold=text.match(/\b(?:Starter|Get started) (?:is |costs |for )?(?:under|less than) (\$\d+(?:\.\d{1,2})?) (?:a|per) month,? billed monthly\b/i);
  const supported=[direct,savings,daily,gap,threshold].filter(Boolean);
  // Detect multi-claim and qualified sentences rather than editing one fragment and blessing the rest.
  if (supported.length !== 1) return unresolved('other_pricing',supported.length ? 'Multiple pricing claims in one extracted block require separate review.' : 'Pricing wording is outside the explicit supported rules. No semantic inference or automatic repair was attempted.');
  const match=supported[0]!;
  if (!supportedEnvelope(text,match,Boolean(direct))) return unresolved('other_pricing','The surrounding currency, billing, unit, or eligibility qualifier is outside the explicit supported rules.');
  const extraNumbers=numbers(text.replace(match[0],''));
  const tail=text.slice((match.index ?? 0) + match[0].length);
  if (/\b(?:not|never|false|incorrect|wrong|example|hypothetical|pretend|ignore|instructions?|forever|guaranteed|discount|promotion|introductory|trial|subject to)\b/i.test(text.replace(/not legacy[- ]eligible/gi,'').replace(/https?:\/\/\S+|\{\{[\s\S]*?\}\}/g,''))) return unresolved('other_pricing','Negation, hypothetical language, instructions, or promotional qualifiers require interpretation outside this rule contract.');
  if (/\bbilled annually\b/i.test(tail) || /\b(?:per (?:seat|user|team)|before tax|after tax|with (?:tax|fees|discount)|excluding|including|discounted|introductory|first \d+|starting at)\b/i.test(text)) return unresolved('other_pricing','Additional billing, tax, unit, or promotional qualifiers are outside this rule contract.');
  // Numbers in URLs, template variables, and a cutoff date are preserved, not interpreted as prices.
  const safeSurrounding=text.replace(match[0],'').replace(/\{\{[\s\S]*?\}\}|https?:\/\/\S+|20\d\d-\d\d-\d\d/g,'');
  if (extraNumbers.length && numbers(safeSurrounding).length) return unresolved('other_pricing','Additional numeric claims in this text block require independent review.');
  let kind='direct_price', old='', target='', expected=0, observed=0;
  if (direct) {old=direct[1] ?? direct[2]!;expected=monthly;observed=Math.round(Number(old.slice(1))*100);target=amount(expected);}
  else if (savings) {kind='annual_savings';old=savings[1]+'%';expected=Math.round(100*(1-facts.annualCents/(monthly*12))*100)/100;observed=Number(savings[1]);target=String(expected)+'%';}
  else if (daily) {kind='per_day';old=daily[1]!;expected=Math.round(monthly/30);observed=old.toLowerCase()==='a dollar'?100:Math.round(Number(old.slice(1))*100);target='$'+(expected/100).toFixed(2);}
  else if (gap) {kind='plan_gap';old=gap[1]!;expected=facts.teamMonthlyCents-monthly;observed=Math.round(Number(old.slice(1))*100);target=amount(expected);}
  else if (threshold) {
    const limit=Math.round(Number(threshold[1]!.slice(1))*100);
    return monthly < limit
      ? {label:scope==='legacy'?'valid_exception':'consistent',kind:'threshold',rationale:'The explicitly scoped monthly price satisfies the stated upper bound.'}
      : {label:'contradicting',kind:'threshold',rationale:'The monthly price no longer satisfies the stated upper bound.',withhold:'Threshold copy has no predetermined safe replacement wording.'};
  }
  if (observed===expected) return {label:scope==='legacy'?'valid_exception':'consistent',kind,rationale:scope==='legacy'?'Explicit legacy eligibility protects this matching price or derived value.':'The claim matches the supplied desired facts and deterministic derived value.'};
  // A known incorrect legacy statement is detected, but protected-scope copy is never auto-repaired.
  if (scope==='legacy') return {label:'contradicting',kind,rationale:'This claim does not match the legacy-eligible price or derived value.',withhold:'Legacy-scope inconsistencies require manual review; this experiment only repairs public-offer claims.'};
  if (kind==='plan_gap' && expected<=0) return {label:'contradicting',kind,rationale:'The supplied facts no longer support a positive Team-to-Starter gap.',withhold:'The wording requires a positive price gap; no safe amount substitution exists.'};
  // Use the match's position in normalized text only to locate a unique literal amount in the source.
  // Replacing repeated amounts could accidentally change an unrelated claim or URL.
  const rawMatch=unit.text.match(kind==='direct_price' ? /\bStarter\s+(?:(?:is|costs)\s+(\$\d+(?:\.\d{1,2})?)\s+(?:a|per)\s+month|monthly\s*[:|]?\s*(\$\d+(?:\.\d{1,2})?))/i
    :kind==='annual_savings'?/\bSave\s+\d+(?:\.\d+)?%\s+on\s+Starter\s+with\s+annual\s+billing/i
    :kind==='per_day'?/\bStarter\s+costs\s+(?:about\s+)?(?:a\s+dollar|\$\d+(?:\.\d{1,2})?)\s+(?:a|per)\s+day/i
    :/\bTeam\s+is\s+(?:only\s+)?\$\d+(?:\.\d{1,2})?\s+(?:a|per)\s+month\s+more\s+than\s+Starter/i);
  if (!rawMatch) return unresolved(kind,'The extracted source span cannot be mapped exactly for a safe substitution.');
  const within=rawMatch[0].indexOf(old);
  if (within<0) return unresolved(kind,'The exact numeric wording cannot be mapped to the source span.');
  const start=(rawMatch.index ?? 0)+within;
  const replacement=unit.text.slice(0,start)+target+unit.text.slice(start+old.length);
  return {label:'contradicting',kind,rationale:'The explicitly scoped public claim differs from the supplied desired fact or deterministic derived value.',replacement,old,target};
}

export function analyzeAsset(asset:Asset,facts:Facts):Finding[] {
  if (!asset.extraction) return [];
  return asset.extraction.units.map((unit):Finding => {
    const decision=decide(unit,asset,facts);
    const checks:Finding['checks']=[];
    let replacement=decision.replacement ?? null, withheld=decision.withhold ?? null;
    if (replacement!==null) {
      checks.push({name:'source-context-binding',pass:asset.active,detail:`asset=${asset.id};revision=${asset.revision};source=${asset.sourceHash};context=${asset.contextHash};unit=${hashRecord(unit)};facts=${hashRecord(facts)}`});
      checks.push({name:'tokens-and-urls',pass:JSON.stringify(protectedTokens(unit.text))===JSON.stringify(protectedTokens(replacement)),detail:'Literal template tokens and URLs are unchanged.'});
      checks.push({name:'exact-substitution',pass:replacement!==unit.text && !!decision.old && !!decision.target,detail:`One supported ${decision.kind} value is substituted; all surrounding text is retained.`});
      const recheck=decide({...unit,text:replacement},asset,facts);
      checks.push({name:'numeric-units-and-context',pass:recheck.label==='consistent',detail:'The suggested text is rechecked against the same facts, units, and eligibility context.'});
      if (checks.some(check=>!check.pass)) {replacement=null;withheld='One or more applicable checks failed. The draft is withheld.';}
    }
    return {id:'finding-'+hashRecord([asset.revision,unit.id,hashRecord(facts),ENGINE]).slice(0,24),assetId:asset.id,revision:asset.revision,unitId:unit.id,label:decision.label,kind:decision.kind,original:unit.text,replacement,rationale:decision.rationale,withholdReason:withheld,checks,locator:unit.locator};
  });
}
