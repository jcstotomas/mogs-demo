export const VERSION='mogs-authoring-v1';
// Authoring fields are trusted, explicit source objects, not OCR coordinates.
export function campaignFields(monthlyCents) {
 if(![3000,4000].includes(monthlyCents)) throw new Error('Only the controlled $30 and $40 Starter scenario is supported.');
 const monthly=monthlyCents/100;
 const savings=Math.round(100*(1-288/(monthly*12)));
 return {
  version:VERSION,monthlyCents,annualCents:28800,teamMonthlyCents:8000,legacyMonthlyCents:3000,legacyCutoff:'2026-10-03',
  starterMonthly:`Starter is $${monthly} a month.`,
  starterAnnual:'Starter is $288 a year, or $24 a month billed annually.',
  planGap:`Team is only $${80-monthly} a month more than Starter.`,
  savingsHeadline:`${savings}%`,
  annualSavings:`Save ${savings}% on Starter with annual billing.`,
  perDay:monthly===30?'Starter costs about a dollar a day.':`Starter costs about $${(monthly/30).toFixed(2)} a day.`,
  legacyPrice:'Starter is $30 a month.',
  legacyEligibility:'This note is for active Starter monthly subscribers who joined before October 3, 2026. Your legacy rate stays with your active subscription.',
  welcome:{subject:'Make room for good work',preheader:'A calmer week starts with a little breathing room.',greeting:'Hello {{ first_name }},',intro:'Good work needs a little breathing room. Bring your team together with MOGS, and put the next thing on the calendar.',cta:'Find your rhythm',url:'https://example.invalid/mogs/start?utm_source=welcome'},
  legacy:{subject:'Good news: your rhythm stays the same',preheader:'A note of thanks, and a familiar monthly rate.',greeting:'Hello {{ first_name }},',intro:"You made room for MOGS early on. Thank you for making us part of your team's week.",cta:'Open your workspace',url:'https://example.invalid/mogs/workspace?utm_source=customer-note'},
  creative:{launch:{eyebrow:'A LITTLE MORE ROOM',title:'Make room\nfor good work.',body:'A calmer week starts here.',qualifier:'Starter monthly plan for new customers.',cta:'Find your rhythm'},annual:{eyebrow:'YOUR YEAR, WITH MORE ROOM',title:'Room for\nthe whole year.',body:'Good work deserves a little breathing room.',qualifier:'Compared with 12 months of Starter monthly billing.',cta:'Plan your year'},legacy:{eyebrow:'A NOTE FOR OUR EARLY CUSTOMERS',title:'Good things\nstay with you.',body:'Your team. Your rhythm. Your familiar rate.',qualifier:'For active Starter monthly subscribers who joined before October 3, 2026.',cta:'Here’s to the work ahead'}}
 };
}
export function emailMetadata(fields, id) {
 const legacy=id==='legacy', c=fields[id];
 const price=legacy?fields.legacyPrice:fields.starterMonthly;
 const blocks=[c.greeting,'',legacy?'Good things stay with you.':'Make room for good work.','',c.intro,'',...(legacy?[fields.legacyEligibility,'']:[]),price,'',...(!legacy?[fields.starterAnnual,'']:[]),`${c.cta}: ${c.url}`,'','Fictional MOGS campaign · October 2026'];
 return {id,sourceVersion:VERSION,subject:c.subject,preheader:c.preheader,plainText:blocks.join('\n')+'\n',audience:legacy?'existing_customers':'new_customers',legacyEligible:legacy};
}
