import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runtime, skill, run } from './runtime.mjs';
export async function renderDeck(fields, sourceDir, outputDir) {
const { Presentation, PresentationFile } = await import(pathToFileURL(path.join(runtime, 'node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs')));
const { finalizePresentation } = await import(pathToFileURL(path.join(skill, 'container_tools/artifact_tool_utils.mjs')));
const target=path.join(outputDir,'deck');
const staging=path.join(outputDir,'.build');
await fs.mkdir(target,{recursive:true});
await fs.mkdir(staging,{recursive:true});
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
 s.speakerNotes.textFrame.setText('Source: project SPEC.md sections 2 and 3. MOGS is fictional team scheduling software. Pricing represents the staged campaign source inputs. This is a fictional campaign, not a published offer or production acceptance record.');
 return s;
}
// 1. Native campaign typography beside the original, text-free generated scene.
{
 const s=slide(F,1,true);
 s.images.add({blob:new Uint8Array(await fs.readFile(path.join(sourceDir,'hero.png'))),contentType:'image/png',alt:'An imagined sunlit workspace with a forest-green chair, notebook and olive branch.',fit:'cover',position:{left:730,top:0,width:550,height:720}});
 text(s,'Make room',61,168,660,102,88,I,true);
 text(s,'for good',61,267,660,102,88,I,true);
 text(s,'work.',61,366,660,110,88,I,true);
 text(s,'Team scheduling for',65,531,600,40,28,C);
 text(s,'the work ahead.',65,572,600,40,28,C);
 s.speakerNotes.textFrame.setText('Source: project SPEC.md sections 2 and 3. Fictional MOGS campaign. Cover image generated for this campaign, not a photograph of a real MOGS office or event. Pricing pages use the staged campaign source inputs.');
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
 text(s,fields.starterMonthly,64,306,1130,70,47,F,true);
 rect(s,64,401,1130,2,'#A4B09F');
 text(s,'Team is $80 a month.',64,438,1130,70,47,F,true);
 rect(s,64,530,1130,2,'#A4B09F');
 text(s,fields.planGap,64,570,1130,48,27,F);
}
// 4. An intentionally stale savings statement remains full-sized, selectable text.
{
 const s=slide(C,4);
 text(s,'A year of room',62,125,1130,88,72,F,true);
 text(s,fields.savingsHeadline,55,221,1100,220,190,F,true);
 text(s,fields.annualSavings,65,467,1130,52,34,F);
 rect(s,64,545,1130,2,'#94AA4F');
 text(s,'Starter is $288 a year, or $24 a month billed annually.',65,577,1130,44,25,F);
}
// 5. The closing page repeats one derived claim and leaves room for a conversation.
{
 const s=slide(F,5,true);
 text(s,'Your next week,',62,141,1160,132,101,I,true);
 text(s,'with more room.',62,257,1160,132,101,I,true);
 text(s,fields.perDay,65,440,1120,57,34,C);
 rect(s,64,535,1130,2,'#526A5D');
 text(s,'Let’s talk about your team’s schedule.',65,570,1120,48,29,I);
}

const candidate=path.join(staging,'candidate.pptx');
const final=path.join(target,'campaign.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidate);
await finalizePresentation({workspaceDir:outputDir,candidatePath:candidate,finalPath:final,pythonExecutable:path.join(runtime,'python/bin/python3'),integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit'],explicitTotalSlideCount:5,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Georgia','Arial']},verifyArtifactToolImport:true,receiptPath:path.join(staging,'validation.json')});
for(let n=0;n<presentation.slides.items.length;n++){
 const png=await presentation.export({slide:presentation.slides.items[n],format:'png',scale:1});
 await fs.writeFile(path.join(target,`slide-${n+1}.png`),new Uint8Array(await png.arrayBuffer()));
}
// The bundled converter has a unique profile inside the candidate output root.
run(path.join(runtime,'bin/override/soffice'),['-env:UserInstallation='+pathToFileURL(path.join(staging,'office')).href,'--headless','--convert-to','pdf','--outdir',target,final]);
const extracted=run(path.join(runtime,'python/bin/python3'),['-c','from pypdf import PdfReader; import sys; print("\\n".join(p.extract_text() for p in PdfReader(sys.argv[1]).pages))',path.join(target,'campaign.pdf')]);
for(const claim of [fields.starterMonthly,fields.planGap,fields.savingsHeadline,fields.annualSavings,fields.perDay,fields.starterAnnual,'Team is $80 a month.']) {
 if(!extracted.replace(/\s+/g,' ').includes(claim)) throw new Error('Deck PDF missing rendered claim: '+claim);
}
await fs.writeFile(path.join(staging,'deck-extracted.txt'),extracted);
return {name:'deck_rendered_claims',pass:true,detail:'Five editable slides exported; PDF contains every bound pricing claim, linked savings headline and sentence, annual $288/$24 and Team $80.'};
}
