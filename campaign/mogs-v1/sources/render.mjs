import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
// Do not forward Git/provider credentials or arbitrary environment to trusted renderers.
const allowed=new Set(['PATH','HOME','TMPDIR','LANG','LC_ALL','SYSTEMROOT','CODEX_ARTIFACT_RUNTIME','CODEX_PRESENTATION_SKILL']);
for(const key of Object.keys(process.env)) if(!allowed.has(key)) delete process.env[key];
const { runtime,escapeHtml,run }=await import('./runtime.mjs');
const { campaignFields,emailMetadata,VERSION }=await import('./fields.mjs');
const { describe }=await import('./descriptor.mjs');
const { renderDeck }=await import('./deck.mjs');
const { creativeHtml }=await import('./creative.mjs');
const input=JSON.parse(await fs.readFile(path.resolve(process.argv[2]),'utf8'));
if(!input || Object.keys(input).length!==1 || !Object.hasOwn(input,'monthlyCents')) throw new Error('Input must contain only monthlyCents.');
const fields=campaignFields(input.monthlyCents);
const output=path.resolve(process.argv[3] || '');
if(!process.argv[3]) throw new Error('An isolated output directory is required.');
const sourceDir=path.dirname(fileURLToPath(import.meta.url));
if(output===sourceDir || output.startsWith(sourceDir+path.sep)) throw new Error('Output must be separate from the trusted authoring source.');
await fs.mkdir(output,{recursive:true});
if((await fs.readdir(output)).length) throw new Error('Output directory must be empty; preserve prior candidates.');
for(const dir of ['emails','creative','sources','sources/templates','.build']) await fs.mkdir(path.join(output,dir),{recursive:true});
process.env.TMPDIR=path.join(output,'.build');
const sourceFiles=['render.mjs','runtime.mjs','fields.mjs','deck.mjs','creative.mjs','descriptor.mjs','describe.mjs','hero.png','templates/welcome.html','templates/legacy.html'];
for(const file of sourceFiles) await fs.copyFile(path.join(sourceDir,file),path.join(output,'sources',file));
await fs.writeFile(path.join(output,'sources/input.json'),JSON.stringify(input,null,2)+'\n');
await fs.writeFile(path.join(output,'sources/campaign.json'),JSON.stringify(fields,null,2)+'\n');
const shared=sourceFiles.map(file=>({path:'sources/'+file,mime:file.endsWith('.png')?'image/png':file.endsWith('.html')?'text/html':'text/javascript',role:'source'}));
shared.push({path:'sources/input.json',mime:'application/json',role:'source'},{path:'sources/campaign.json',mime:'application/json',role:'source'});
const manifest={...describe(input.monthlyCents),assets:[],checks:[]};
const descriptors=describe(input.monthlyCents).assets;
const file=(p,mime,role='export')=>({path:p,mime,role});
for(const id of ['welcome','legacy']) {
 const base=await fs.readFile(path.join(sourceDir,'templates',id+'.html'),'utf8');
 const html=base.replaceAll('{{ starterMonthly }}',escapeHtml(fields.starterMonthly)).replaceAll('{{ starterAnnual }}',escapeHtml(fields.starterAnnual));
 const metadata=emailMetadata(fields,id);
 await fs.writeFile(path.join(output,'emails',id+'.html'),html);
 await fs.writeFile(path.join(output,'emails',id+'.txt'),metadata.plainText);
 await fs.writeFile(path.join(output,'emails',id+'.json'),JSON.stringify(metadata,null,2)+'\n');
 const descriptor=descriptors.find(a=>a.id===id+'-email');
 for(const claim of descriptor.claims) {
  const text=claim.id.endsWith('plain')?metadata.plainText:html;
  if(!text.includes(claim.text)) throw new Error(`Email ${id} lost bound claim ${claim.id}.`);
 }
 if(!html.includes('{{ first_name }}') || !metadata.plainText.includes('{{ first_name }}') || !html.includes(fields[id].url)) throw new Error('Email token or link lost.');
 if(id==='legacy' && (!html.includes(fields.legacyEligibility) || !metadata.plainText.includes(fields.legacyEligibility) || html!==base)) throw new Error('Protected legacy email changed.');
 manifest.assets.push({...descriptor,preview:'emails/'+id+'.html',files:[...shared,file('emails/'+id+'.html','text/html'),file('emails/'+id+'.txt','text/plain'),file('emails/'+id+'.json','application/json','source')]});
}
manifest.checks.push({name:'email_values_and_preservation',pass:true,detail:'HTML and plain-text prices agree; unchanged annual terms, legacy eligibility, template tokens, links and legacy HTML are preserved.'});
manifest.checks.push(await renderDeck(fields,sourceDir,output));
manifest.assets.push({...descriptors.find(a=>a.id==='sales-deck'),preview:'deck/campaign.pdf',files:[...shared,file('deck/campaign.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'),file('deck/campaign.pdf','application/pdf'),...[1,2,3,4,5].map(n=>file(`deck/slide-${n}.png`,'image/png','preview'))]});
const { chromium }=await import(pathToFileURL(path.join(runtime,'node/node_modules/playwright/index.mjs')));
async function browserExecutable(chromium) {
 try { await fs.access(chromium.executablePath()); return chromium.executablePath(); } catch {}
 const cache=path.join(process.env.HOME,'Library/Caches/ms-playwright');
 const versions=(await fs.readdir(cache)).filter(n=>/^chromium_headless_shell-\d+$/.test(n)).sort((a,b)=>Number(b.split('-').pop())-Number(a.split('-').pop()));
 for(const version of versions) {
  const candidate=path.join(cache,version,'chrome-headless-shell-mac-arm64/chrome-headless-shell');
  try { await fs.access(candidate); return candidate; } catch {}
 }
 throw new Error('No installed Playwright Chromium renderer is available.');
}
const context=await chromium.launchPersistentContext(path.join(output,'.build/browser'),{headless:true,executablePath:await browserExecutable(chromium),viewport:{width:1080,height:1080},deviceScaleFactor:1});
await context.route('**/*',route=>route.abort());
try {
 const page=await context.newPage();
 for(const id of ['launch','annual','legacy']) {
  const html=await creativeHtml(fields,id,sourceDir);
  await fs.writeFile(path.join(output,'creative',id+'.html'),html);
  await page.setContent(html,{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  const descriptor=descriptors.find(a=>a.id===id+'-creative');
  for(const claim of descriptor.claims) {
   if((await page.locator(`[data-source-id="${claim.id}"]`).textContent())!==claim.text) throw new Error('Creative source binding mismatch: '+claim.id);
  }
  const fit=await page.evaluate(()=>{
   const area=document.querySelector('.copy').getBoundingClientRect();
   const items=[...document.querySelector('.copy').children];
   return items.every(el=>{const r=el.getBoundingClientRect();return r.left>=area.left && r.right<=area.right && r.top>=area.top && r.bottom<=area.bottom && el.scrollWidth<=el.clientWidth+1;}) && items.every((el,index)=>index===0 || el.getBoundingClientRect().top>=items[index-1].getBoundingClientRect().bottom-1);
  });
  if(!fit) throw new Error(`Creative ${id} has overflowing or overlapping text.`);
  if(!(await page.locator('.photo').evaluate(el=>el.complete && el.naturalWidth>0))) throw new Error('Creative image failed to load.');
  await page.screenshot({path:path.join(output,'creative',id+'.png')});
  // Re-extract each exact rendered claim region. The template's stable DOM binding
  // resolves the visual object; OCR never invents an editable source coordinate.
  for(const claim of descriptor.claims) {
   const crop=path.join(output,'.build',`${id}-${claim.id}.png`);
   await page.locator(`[data-source-id="${claim.id}"]`).screenshot({path:crop});
   const args=[crop,'stdout','--psm','7'];
   if(claim.id==='savings-headline') args.push('-c','tessedit_char_whitelist=0123456789%');
   const extracted=run('/opt/homebrew/bin/tesseract',args);
   await fs.writeFile(path.join(output,'.build',`${id}-${claim.id}.txt`),extracted);
   const normalize=s=>s.replace(/\s+/g,'').replace(/[.,]/g,'');
   if(normalize(extracted)!==normalize(claim.text)) throw new Error(`Creative rendered OCR does not match ${id}/${claim.id}: ${extracted.trim()}`);
  }
  manifest.assets.push({...descriptor,preview:'creative/'+id+'.png',files:[...shared,file('creative/'+id+'.html','text/html','source'),file('creative/'+id+'.png','image/png')]});
 }
 // The rendered email DOM must contain the same claim values as HTML and plain text.
 for(const id of ['welcome','legacy']) {
  for(const width of [1440,375,320]) {
   await page.setViewportSize({width,height:900});
   await page.setContent(await fs.readFile(path.join(output,'emails',id+'.html'),'utf8'),{waitUntil:'load'});
   const expected=id==='legacy'?fields.legacyPrice:fields.starterMonthly;
   if(!(await page.locator('body').innerText()).includes(expected)) throw new Error('Rendered email lacks bound price.');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
   if(overflow) throw new Error(`Email ${id} overflows at ${width}px.`);
   if(width!==320) await page.screenshot({path:path.join(output,'.build',`${id}-${width}.png`),fullPage:true});
  }
 }
} finally { await context.close(); }
manifest.checks.push({name:'creative_rendered_bindings',pass:true,detail:'All creative copy objects match the manifest in the rendered DOM and independent OCR of their PNG regions; image inputs load; text fits the 1080px output.'});
manifest.checks.push({name:'email_rendered_layout',pass:true,detail:'Rendered email claims verified at 1440px, 375px and 320px with no horizontal overflow.'});
manifest.checks.push({name:'protected_facts',pass:fields.annualCents===28800&&fields.legacyMonthlyCents===3000&&fields.teamMonthlyCents===8000,detail:'Annual $288 ($24 effective), Team $80 and eligible legacy $30 remain fixed.'});
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({manifest:path.join(output,'manifest.json'),assets:manifest.assets.length,claims:manifest.assets.reduce((n,a)=>n+a.claims.length,0),checks:manifest.checks}));
