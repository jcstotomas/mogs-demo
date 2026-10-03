import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Uses the supplied Codex artifact runtime. Override the root for another installation.
const runtime = process.env.CODEX_ARTIFACT_RUNTIME ?? '/Users/jeremy/.cache/codex-runtimes/codex-primary-runtime/dependencies';
process.env.RUNTIME_NODE_MODULES ??= path.join(runtime, 'node/node_modules');
const skill = process.env.CODEX_PRESENTATION_SKILL ?? '/Users/jeremy/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations';
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(runtime, 'node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs')));
const { finalizePresentation } = await import(pathToFileURL(path.join(skill, 'container_tools/artifact_tool_utils.mjs')));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'showcase/deck');
const staging = path.join(output, '.build');
const finalDir = path.join(output, 'files');
await fs.mkdir(finalDir, { recursive:true });
await fs.mkdir(staging, { recursive:true });
await fs.mkdir(path.join(output, 'rendered'), { recursive:true });
const F = '#163C30', I = '#F5F1E7', C = '#D4E876', M = '#546B60', W = '#FFFFFF';
const presentation = Presentation.create({slideSize:{width:1280,height:720}});
function rect(s,x,y,w,h,fill){return s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:'none',width:0}});}
function text(s,content,x,y,w,h,size=28,color=F,serif=false,bold=false){
 const shape=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 shape.text=content;
 shape.text.style={typeface:serif?'Georgia':'Arial',fontSize:size,bold,color,autoFit:'none',wrap:'none',insets:{left:0,right:0,top:0,bottom:0},verticalAlignment:'top'};
 return shape;
}
function slide(bg,index,dark=false){
 const s=presentation.slides.add();s.background.fill=bg;
 text(s,'MOGS',64,38,190,44,30,dark?I:F,false,true);
 text(s,'Fictional MOGS campaign',64,669,440,23,14,dark?'#C7D7CE':M);
 text(s,`0${index}`,1172,669,44,23,14,dark?'#C7D7CE':M);
 s.speakerNotes.textFrame.setText('Source: project SPEC.md sections 2 and 3. MOGS is fictional team scheduling software. Pricing copy intentionally represents the unchanged $30 source offer so the isolated launch-correction lab can review stale direct and derived claims. Not a published offer or production acceptance record.');
 return s;
}
// 1. Native campaign typography beside the original, text-free generated scene.
{
 const s=slide(F,1,true);
 s.images.add({blob:new Uint8Array(await fs.readFile(path.join(root,'showcase/campaign-hero.png'))),contentType:'image/png',alt:'An imagined sunlit workspace with a forest-green chair, notebook and olive branch.',fit:'cover',position:{left:730,top:0,width:550,height:720}});
 text(s,'Make room',61,168,660,102,88,I,true);
 text(s,'for good',61,267,660,102,88,I,true);
 text(s,'work.',61,366,660,110,88,I,true);
 text(s,'Team scheduling for',65,531,600,40,28,C);
 text(s,'the work ahead.',65,572,600,40,28,C);
 s.speakerNotes.textFrame.setText('Source: project SPEC.md sections 2 and 3. Fictional MOGS campaign. Cover image generated for this campaign, not a photograph of a real MOGS office or event. Pricing pages intentionally use the unchanged $30 source offer for the isolated launch-correction lab.');
}
// 2. Short editorial statements introduce the scheduling problem without invented metrics.
{
 const s=slide(I,2);
 text(s,'A little more',62,147,1100,102,79,F,true);
 text(s,'room in the week',62,238,1150,102,79,F,true);
 rect(s,64,414,1130,2,'#BDC6B6');
 text(s,'A shared plan begins with a conversation.',65,456,1090,54,31,F);
 text(s,'Who needs to be there. What needs to happen.',65,522,1090,42,25,M);
 text(s,'MOGS is team scheduling software.',65,578,1090,42,25,M);
}
// 3. Staggered text rows preserve each pricing claim as a distinct PDF line.
{
 const s=slide(I,3);
 text(s,'Plans for your team',62,132,1150,98,73,F,true);
 rect(s,64,269,1130,2,'#A4B09F');
 text(s,'Starter is $30 a month.',64,306,1130,70,47,F,true);
 rect(s,64,401,1130,2,'#A4B09F');
 text(s,'Team is $80 a month.',64,438,1130,70,47,F,true);
 rect(s,64,530,1130,2,'#A4B09F');
 text(s,'Team is only $50 a month more than Starter.',64,570,1130,48,27,F);
}
// 4. An intentionally stale savings statement remains full-sized, selectable text.
{
 const s=slide(C,4);
 text(s,'A year of room',62,125,1130,88,72,F,true);
 text(s,'20%',55,221,1100,220,190,F,true);
 text(s,'Save 20% on Starter with annual billing.',65,467,1130,52,34,F);
 rect(s,64,545,1130,2,'#94AA4F');
 text(s,'Starter is $288 a year, or $24 a month billed annually.',65,577,1130,44,25,F);
}
// 5. The closing page repeats one derived claim and leaves room for a conversation.
{
 const s=slide(F,5,true);
 text(s,'Your next week,',62,141,1160,132,101,I,true);
 text(s,'with more room.',62,257,1160,132,101,I,true);
 text(s,'Starter costs about a dollar a day.',65,440,1120,57,34,C);
 rect(s,64,535,1130,2,'#526A5D');
 text(s,'Let’s talk about your team’s schedule.',65,570,1120,48,29,I);
}
const draft=path.join(staging,'candidate.pptx');
const final=path.join(finalDir,'mogs-make-room.pptx');
await (await PresentationFile.exportPptx(presentation)).save(draft);
await finalizePresentation({workspaceDir:root,candidatePath:draft,finalPath:final,pythonExecutable:path.join(runtime,'python/bin/python3'),integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:5,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Georgia','Arial']},verifyArtifactToolImport:true,receiptPath:path.join(staging,'validation.json')});
for(let n=0;n<presentation.slides.items.length;n++){
 const png=await presentation.export({slide:presentation.slides.items[n],format:'png',scale:1});
 await fs.writeFile(path.join(output,'rendered',`slide-${n+1}.png`),new Uint8Array(await png.arrayBuffer()));
}
// Conversion uses only the bundled office binary, not the user's desktop app.
const office=path.join(runtime,'bin/override/soffice');
const converted=spawnSync(office,['-env:UserInstallation=file:///private/tmp/mogs-showcase-office','--headless','--convert-to','pdf','--outdir',finalDir,final],{encoding:'utf8',timeout:60000});
if(converted.status!==0)throw new Error(`PDF export failed: ${converted.stderr || converted.stdout}`);
const pdf=path.join(finalDir,'mogs-make-room.pdf');
const bytes=await fs.readFile(pdf);
const claims=[
 {text:'20%',page:4,label:'insufficient_context'},
 {text:'Starter is $30 a month.',page:3,label:'contradicting',replacement:'Starter is $40 a month.'},
 {text:'Team is $80 a month.',page:3,label:'insufficient_context'},
 {text:'Team is only $50 a month more than Starter.',page:3,label:'contradicting',replacement:'Team is only $40 a month more than Starter.'},
 {text:'Save 20% on Starter with annual billing.',page:4,label:'contradicting',replacement:'Save 40% on Starter with annual billing.'},
 {text:'Starter is $288 a year, or $24 a month billed annually.',page:4,label:'consistent'},
 {text:'Starter costs about a dollar a day.',page:5,label:'contradicting',replacement:'Starter costs about $1.33 a day.'},
];
const manifest={filename:'deck/files/mogs-make-room.pdf',surface:'deck',context:{title:'MOGS - Make room for good work',audience:'new_customers',legacyEligible:false,journey:'sales',subject:'',preheader:'',plainText:'',region:'US',date:'2026-10-03'},sha256:createHash('sha256').update(bytes).digest('hex'),pages:5,expected:claims};
await fs.writeFile(path.join(output,'manifest.fragment.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({pptx:final,pdf,claims:claims.length,sha256:manifest.sha256}));
