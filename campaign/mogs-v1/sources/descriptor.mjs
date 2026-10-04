import { campaignFields,VERSION } from './fields.mjs';
const claim=(id,text,kind,scope='public')=>({id,text,scope,kind});
export function describe(monthlyCents) {
 const f=campaignFields(monthlyCents);
 return {version:VERSION,monthlyCents,assets:[
  {id:'welcome-email',title:'Make room for good work',kind:'email',claims:[claim('monthly-html',f.starterMonthly,'direct_price'),claim('monthly-plain',f.starterMonthly,'direct_price'),claim('annual-html',f.starterAnnual,'other_pricing'),claim('annual-plain',f.starterAnnual,'other_pricing')]},
  {id:'legacy-email',title:'Good things stay with you',kind:'email',claims:[claim('monthly-html',f.legacyPrice,'direct_price','legacy'),claim('monthly-plain',f.legacyPrice,'direct_price','legacy')]},
  {id:'sales-deck',title:'Make room for good work · sales deck',kind:'deck',claims:[claim('slide-3-starter',f.starterMonthly,'direct_price'),claim('slide-3-team','Team is $80 a month.','other_pricing'),claim('slide-3-gap',f.planGap,'plan_gap'),claim('slide-4-savings-headline',f.savingsHeadline,'annual_savings'),claim('slide-4-savings-sentence',f.annualSavings,'annual_savings'),claim('slide-4-annual',f.starterAnnual,'other_pricing'),claim('slide-5-daily',f.perDay,'per_day')]},
  {id:'launch-creative',title:'Make room for good work · creative',kind:'creative',claims:[claim('monthly-price',f.starterMonthly,'direct_price')]},
  {id:'annual-creative',title:'Room for the whole year · creative',kind:'creative',claims:[claim('savings-headline',f.savingsHeadline,'annual_savings'),claim('annual-savings',f.annualSavings,'annual_savings'),claim('annual-price','Starter is $288 a year.','other_pricing')]},
  {id:'legacy-creative',title:'Good things stay with you · creative',kind:'creative',claims:[claim('monthly-price',f.legacyPrice,'direct_price','legacy')]}
 ]};
}
