import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Designed demo source. The frozen regression corpus in fixtures/ is never changed.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'showcase/emails');
const forest = '#163c30', ivory = '#f5f1e7', citrus = '#d4e876';
const sans = 'Arial, Helvetica, sans-serif';
const serif = 'Georgia, Times New Roman, serif';
const body = `font-family:${sans};font-size:16px;line-height:1.65;`;
const campaignHero = (await readFile(path.join(root, 'showcase/campaign-hero.png'))).toString('base64');
const small = `font-family:${sans};font-size:12px;line-height:1.5;`;
const start = title => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background-color:${ivory};color:${forest};${body}">
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:${ivory};"><tr><td style="padding:24px 12px;">
<div style="width:100%;max-width:640px;margin:0 auto;background-color:#ffffff;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:24px 24px;border-bottom:1px solid #d9dfd4;"><p style="margin:0;font-family:${sans};font-size:27px;font-weight:700;letter-spacing:-1px;">mogs<span style="color:#54856a;">.</span></p></td><td style="padding:24px 24px;text-align:right;border-bottom:1px solid #d9dfd4;"><p style="margin:0;${small}letter-spacing:1px;">A LITTLE MORE ROOM</p></td></tr></table>`;
const end = `
<div style="padding:24px 24px;background-color:${ivory};">
<p style="margin:0 0 8px;${small}color:#455d50;">Fictional MOGS campaign · October 2026</p>
<p style="margin:0;${small}color:#455d50;">A calmer way to coordinate your team.</p>
</div></div></td></tr></table></body></html>\n`;
const greeting = '<p style="margin:0 0 16px;'+body+'">Hello {{ first_name }},</p>';
const cta = (label, link) => `<p style="margin:24px 0 0;"><a href="${link}" style="display:inline-block;padding:14px 22px;background-color:${forest};color:#ffffff;font-family:${sans};font-size:14px;font-weight:700;line-height:1.4;text-decoration:none;border-radius:4px;">${label} &rarr;</a></p>`;

const launch = start('Make room for good work') + `
<div style="padding:40px 24px 32px;background-color:${ivory};">
<p style="margin:0 0 20px;${small}font-weight:700;letter-spacing:1.5px;">MEET YOUR NEXT CHAPTER</p>
<h1 style="margin:0;font-family:${serif};font-size:48px;font-weight:400;letter-spacing:-1.5px;line-height:1.06;">Make room<br>for good work.</h1>
<p style="margin:24px 0 0;${body}max-width:430px;">A week with fewer back-and-forths.<br>And more time for the work that matters.</p>
</div>
<div style="background-color:${citrus};">
<img src="data:image/png;base64,${campaignHero}" alt="A sunlit desk with a notebook, an olive branch, and a forest-green chair." style="display:block;width:100%;height:auto;">
<p style="margin:0;padding:16px 24px;${small}font-weight:700;letter-spacing:1px;">A LITTLE SPACE. A FRESH PERSPECTIVE.</p>
</div>
<div style="padding:32px 24px;">
${greeting}
<p style="margin:0 0 24px;${body}">Good work needs a little breathing room. Bring your team together with MOGS, and put the next thing on the calendar.</p>
<h2 style="margin:0 0 12px;font-family:${serif};font-size:30px;font-weight:400;line-height:1.2;">Start something good.</h2>
<p style="margin:0 0 12px;font-family:${sans};font-size:20px;font-weight:700;line-height:1.4;">Starter is $30 a month.</p>
<p style="margin:0;${body}color:#455d50;">Starter is $288 a year, or $24 a month billed annually.</p>
${cta('Find your rhythm', 'https://example.invalid/mogs/start?utm_source=welcome')}
</div>
<div style="padding:24px;background-color:${forest};color:${ivory};">
<p style="margin:0;font-family:${serif};font-size:27px;line-height:1.25;">The next great thing starts with a little space.</p>
</div>` + end;

const legacy = start('Good news: your rhythm stays the same') + `
<div style="padding:40px 24px 32px;background-color:${forest};color:${ivory};">
<p style="margin:0 0 20px;${small}font-weight:700;letter-spacing:1.5px;color:${citrus};">A NOTE FOR OUR EARLY CUSTOMERS</p>
<h1 style="margin:0;font-family:${serif};font-size:46px;font-weight:400;letter-spacing:-1.5px;line-height:1.08;">Good things<br>stay with you.</h1>
<p style="margin:24px 0 0;${body}max-width:430px;">Your team. Your rhythm.<br>And the monthly price you started with.</p>
</div>
<div style="padding:32px 24px;">
${greeting}
<p style="margin:0 0 24px;${body}">You made room for MOGS early on. Thank you for making us part of your team's week.</p>
<p style="margin:0;${body}">This note is for active Starter monthly subscribers who joined before October 3, 2026. Your legacy rate stays with your active subscription.</p>
</div>
<div style="padding:28px 24px;background-color:${citrus};">
<p style="margin:0 0 16px;${small}font-weight:700;letter-spacing:1.5px;">YOUR MONTHLY PLAN</p>
<p style="margin:0 0 12px;font-family:${serif};font-size:34px;line-height:1.16;">Starter is $30 a month.</p>
<p style="margin:0;${body}">Same plan. A familiar price.<br>Nothing for you to change.</p>
</div>
<div style="padding:32px 24px;">
<h2 style="margin:0 0 12px;font-family:${serif};font-size:30px;font-weight:400;line-height:1.2;">Here's to the work ahead.</h2>
<p style="margin:0;${body}">Keep building a week that works for you. We'll be here to help you make room for it.</p>
${cta('Open your workspace', 'https://example.invalid/mogs/workspace?utm_source=customer-note')}
<p style="margin:28px 0 0;${body}">With thanks,<br>The MOGS team</p>
</div>` + end;

// Expected outcomes are authored with the sources before evaluation.
const assets = [
  {filename:'emails/welcome-room-to-work.html',surface:'email',context:{title:'Make room for good work',audience:'new_customers',legacyEligible:false,journey:'New customer welcome campaign',subject:'Make room for good work',preheader:'A calmer week starts with a little breathing room.',plainText:'Hello {{ first_name }},\n\nMake room for good work with MOGS.\n\nStarter is $30 a month.\n\nStarter is $288 a year, or $24 a month billed annually.\n\nFind your rhythm: https://example.invalid/mogs/start?utm_source=welcome',region:'US',date:'2026-10-03'},pages:1,expected:[
    {text:'Starter is $30 a month.',label:'contradicting',replacement:'Starter is $40 a month.'},
    {text:'Starter is $288 a year, or $24 a month billed annually.',label:'consistent'},
    {text:'Starter is $30 a month.',label:'contradicting',field:'plainText',replacement:'Starter is $40 a month.'},
    {text:'Starter is $288 a year, or $24 a month billed annually.',label:'consistent',field:'plainText'}
  ]},
  {filename:'emails/your-familiar-rate.html',surface:'email',context:{title:'Good things stay with you',audience:'existing_customers',legacyEligible:true,journey:'Active pre-cutoff Starter monthly subscriber reassurance',subject:'Good news: your rhythm stays the same',preheader:'A note of thanks, and a familiar monthly rate.',plainText:'Hello {{ first_name }},\n\nThis note is for active Starter monthly subscribers who joined before October 3, 2026. Your legacy rate stays with your active subscription.\n\nStarter is $30 a month.\n\nOpen your workspace: https://example.invalid/mogs/workspace?utm_source=customer-note',region:'US',date:'2026-10-03'},pages:1,expected:[
    {text:'Starter is $30 a month.',label:'valid_exception'},
    {text:'Starter is $30 a month.',label:'valid_exception',field:'plainText'}
  ]}
];
for (const asset of assets) { asset.file = asset.filename; asset.filename = path.basename(asset.filename); }
await mkdir(target,{recursive:true});
for (const [index, html] of [launch, legacy].entries()) {
  const file = path.join(root, 'showcase', assets[index].file);
  await writeFile(file, html, 'utf8');
  assets[index].sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(target,'manifest.fragment.json'),JSON.stringify({assets},null,2)+'\n');
console.log(JSON.stringify({assets:assets.map(a=>({filename:a.filename,sha256:a.sha256,expected:a.expected.length}))},null,2));
