import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeAsset, ENGINE } from '../src/analyze.ts';
import { ContextSchema, DEFAULT_FACTS, hash } from '../src/contracts.ts';
import type { Asset, Context, Unit } from '../src/contracts.ts';

function asset(text:string,context:Partial<Context>={},unitOverrides:Partial<Unit>={}):Asset {
  const unit:Unit={id:'unit-one',text,role:'body',locator:{kind:'html',path:'p:nth-of-type(1)'},context:text,confidence:null,uncertain:false,...unitOverrides};
  return {id:'asset-one',revision:'revision-one',sourceHash:hash(text),contextHash:hash(JSON.stringify(context)),filename:'example.html',mime:'text/html',surface:'email',context:ContextSchema.parse({audience:'new_customers',legacyEligible:false,...context}),createdAt:'2026-10-03T00:00:00Z',status:'ready',extraction:{surface:'email',extractor:'synthetic-unit-test',units:[unit],previews:[],status:'complete',warnings:[],pages:1},error:null,original:'original.html',active:true};
}
function finding(text:string,context:Partial<Context>={},unit:Partial<Unit>={}) {return analyzeAsset(asset(text,context,unit),DEFAULT_FACTS)[0]!;}

test('explicit rules engine identifies its bounded, non-model implementation',()=>assert.equal(ENGINE,'mogs-explicit-pricing-rules-v2'));
test('each supported numeric repair passes fresh context and number checks',()=>{
  for (const [source,target,kind] of [
    ['Starter is $30 a month.','Starter is $40 a month.','direct_price'],
    ['Save 20% on Starter with annual billing.','Save 40% on Starter with annual billing.','annual_savings'],
    ['Starter costs about a dollar a day.','Starter costs about $1.33 a day.','per_day'],
    ['Team is only $50 a month more than Starter.','Team is only $40 a month more than Starter.','plan_gap'],
    ['Starter monthly | $30','Starter monthly | $40','direct_price'],
  ]) {
    const result=finding(source!);assert.equal(result.label,'contradicting');assert.equal(result.kind,kind);assert.equal(result.replacement,target);assert.equal(result.checks.length,4);assert.ok(result.checks.every(c=>c.pass));
  }
});
test('paired identical email copy respects explicit legacy eligibility',()=>{
  const text='Starter is $30 a month.';
  assert.equal(finding(text,{audience:'new_customers',legacyEligible:false}).replacement,'Starter is $40 a month.');
  const legacy=finding(text,{audience:'existing_customers',legacyEligible:true});assert.equal(legacy.label,'valid_exception');assert.equal(legacy.replacement,null);
  const unknown=finding(text,{audience:'existing_customers',legacyEligible:null});assert.equal(unknown.label,'insufficient_context');assert.equal(unknown.replacement,null);
});
test('passage scope overrides audience hints and contradictory passage scope stays unresolved',()=>{
  assert.equal(finding('Starter is $30 a month for new customers.',{audience:'existing_customers',legacyEligible:true}).replacement,'Starter is $40 a month for new customers.');
  assert.equal(finding('Starter is $30 a month for legacy-eligible subscribers.',{audience:'new_customers',legacyEligible:false}).label,'valid_exception');
  assert.equal(finding('Starter is $30 a month for new customers and legacy-eligible subscribers.').label,'insufficient_context');
  assert.equal(finding('Starter is $30 a month.',{audience:'new_customers',legacyEligible:true}).label,'insufficient_context');
});
test('visible legacy footnote protects a price while conflicting footnotes withhold it',()=>{
  const text='Starter is $30 a month.';
  const footnote='Only active Starter monthly subscribers who subscribed before 2026-09-01 keep this rate.';
  assert.equal(finding(text,{audience:'existing_customers',legacyEligible:null},{context:text+'\n'+footnote}).label,'valid_exception');
  assert.equal(finding(text,{audience:'unspecified',legacyEligible:null},{context:'New customer pricing\n'+text+'\n'+footnote}).label,'insufficient_context');
});
test('a different pricing sentence does not become another passage scope',()=>{
  const result=finding('Starter is $30 a month.',{audience:'existing_customers',legacyEligible:null},{context:'Starter is $30 a month.\nStarter is under $35 a month, billed monthly for new customers.'});
  assert.equal(result.label,'insufficient_context');assert.equal(result.replacement,null);
});
test('annual, historical, unrelated, and already-correct statements remain unchanged',()=>{
  for (const [text,label] of [
    ['Starter is $288 a year, or $24 a month billed annually.','consistent'],
    ['When we launched in 2023, Starter cost $30 a month.','valid_exception'],
    ['The Locations add-on is $30 a month.','unrelated'],
    ['Cancel within 30 days.','unrelated'],
    ['Starter is $40 a month for new customers.','consistent'],
  ]) {const result=finding(text!);assert.equal(result.label,label);assert.equal(result.replacement,null);}
});
test('unknown wording, missing plan, monetary qualifiers, and multiple claims cannot receive a suggestion',()=>{
  for (const text of ['Plans from $30.','Starter begins at thirty dollars.','Starter is $30 a month per seat.','Starter is $30 a month, billed annually.','Starter is $30 a month with a $5 discount.','Starter is $30 a month. Save 20% on Starter with annual billing.']) {
    const result=finding(text);assert.equal(result.label,'insufficient_context',text);assert.equal(result.replacement,null,text);
  }
});
test('threshold contradiction is detected and withheld without inventing safe wording',()=>{
  const result=finding('Starter is under $35 a month, billed monthly for new customers.');assert.equal(result.label,'contradicting');assert.equal(result.kind,'threshold');assert.equal(result.replacement,null);assert.match(result.withholdReason!,/predetermined/);
});
test('uncertain OCR and unresolved template branches never produce suggestions',()=>{
  for (const overrides of [{uncertain:true},{confidence:0.6},{context:'{% if subscriber.active %}\nStarter is $30 a month.\n{% endif %}'}]) {
    const result=finding('Starter is $30 a month.',{},overrides);assert.equal(result.label,'insufficient_context');assert.equal(result.replacement,null);
  }
});
test('exact substitution preserves Unicode, token bytes, URLs, and line breaks',()=>{
  const source='Hello {{ first_name }}, Starter is $30 a month. Zoë — https://example.invalid/start?price=30';
  const result=finding(source);assert.equal(result.replacement,source.replace('Starter is $30','Starter is $40'));assert.ok(result.checks.every(c=>c.pass));
  const multiline=finding('Starter is $30\na month.');assert.equal(multiline.replacement,'Starter is $40\na month.');
});
test('source invalidation fails the freshness check and withholds the draft',()=>{
  const input=asset('Starter is $30 a month.');input.active=false;const result=analyzeAsset(input,DEFAULT_FACTS)[0]!;assert.equal(result.replacement,null);assert.ok(result.checks.some(c=>!c.pass));assert.match(result.withholdReason!,/checks failed/);
});
test('changed fact snapshot changes the deterministic target and finding identity',()=>{
  const input=asset('Starter is $30 a month.');const before=analyzeAsset(input,DEFAULT_FACTS)[0]!;const changed=analyzeAsset(input,{...DEFAULT_FACTS,monthlyCents:5000})[0]!;
  assert.equal(changed.replacement,'Starter is $50 a month.');assert.notEqual(before.id,changed.id);
});
test('every unit receives a result, including duplicate occurrences and ordinary text',()=>{
  const input=asset('Starter is $30 a month.');input.extraction!.units.push({...input.extraction!.units[0]!,id:'second',locator:{kind:'pdf',page:2,bbox:[0,0,200,50]}});input.extraction!.units.push({...input.extraction!.units[0]!,id:'third',text:'A friendly team.'});
  const rows=analyzeAsset(input,DEFAULT_FACTS);assert.equal(rows.length,3);assert.equal(new Set(rows.map(f=>f.id)).size,3);assert.equal(rows[2]!.label,'unrelated');
});
test('frozen manifest remains independent and byte-bound before extraction evaluation',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../fixtures/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.assets.length,12);assert.deepEqual(manifest.expectedSurfaces,{email:4,deck:4,creative:4});
  for (const entry of manifest.assets) assert.equal(hash(readFileSync(new URL('../fixtures/'+entry.filename,import.meta.url))),entry.sha256,entry.filename);
  assert.equal(manifest.assets.reduce((count:number,entry:{expected:unknown[]})=>count+entry.expected.length,0),65);
});

test('unsupported negation, promotions, compound annual claims and changed cutoffs stay unresolved',()=>{
  for (const text of ['It is false that Starter is $30 a month.','Starter is $30 a month forever.','Starter is $30 a month. Starter is $288 a year, or $24 a month billed annually.']) {
    const result=finding(text);assert.equal(result.label,'insufficient_context');assert.equal(result.replacement,null);
  }
  const result=finding('Starter is $30 a month.',{audience:'existing_customers',legacyEligible:null},{context:'Starter is $30 a month.\nOnly active Starter monthly subscribers who subscribed before '+new Date(Date.parse(DEFAULT_FACTS.legacyCutoff)+86400000).toISOString().slice(0,10)+' keep this rate.'});
  assert.equal(result.label,'insufficient_context');assert.equal(result.replacement,null);
});


test('currency, billing period, and unit qualifiers outside the rule contract withhold corrections',()=>{
  for (const text of ['Starter is $30 a month in CAD.','Starter is $30 a month, billed quarterly.','Starter is $30 a month per employee.','Starter is $30 a month for nonprofit teams.','Save 20% on Starter with annual billing in CAD.','Team is only $50 a month more than Starter per location.']) {
    const result=finding(text);assert.equal(result.label,'insufficient_context',text);assert.equal(result.replacement,null,text);
  }
  assert.equal(finding('Starter is $30 a month in USD.').replacement,'Starter is $40 a month in USD.');
  assert.equal(finding('Starter is $30 a month, billed monthly.').replacement,'Starter is $40 a month, billed monthly.');
});
test('price-bearing eligibility footnotes protect or withhold without borrowing another claim scope',()=>{
  const text='Starter is $30 a month.';
  const qualifier='For legacy-eligible subscribers only at $30.';
  const legacy=finding(text,{audience:'existing_customers',legacyEligible:null},{context:text+'\n'+qualifier});
  assert.equal(legacy.label,'valid_exception');assert.equal(legacy.replacement,null);
  const conflict=finding(text,{audience:'new_customers',legacyEligible:false},{context:text+'\n'+qualifier});
  assert.equal(conflict.label,'insufficient_context');assert.equal(conflict.replacement,null);
});
