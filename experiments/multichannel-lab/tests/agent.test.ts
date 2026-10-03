import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { AgentRunner, AGENT_VERSION } from '../src/agent.ts';
import { LabService } from '../src/service.ts';
import { DEFAULT_FACTS } from '../src/contracts.ts';

const usage={inputTokens:{total:20,noCache:20,cacheRead:undefined,cacheWrite:undefined},outputTokens:{total:10,text:10,reasoning:undefined}};
const call=(toolName:string,input:unknown)=>({content:[{type:'tool-call' as const,toolCallId:randomUUID(),toolName,input:JSON.stringify(input)}],finishReason:{unified:'tool-calls' as const,raw:undefined},usage,warnings:[]});
const say=(text:string)=>({content:[{type:'text' as const,text}],finishReason:{unified:'stop' as const,raw:undefined},usage,warnings:[]});
function setup(model:MockLanguageModelV4,options:{timeoutMs?:number}={}){
 process.env.MOGS_MULTICHANNEL_ENABLED='1';
 const service=new LabService('test_agent_'+randomUUID().replaceAll('-',''));
 const runner=new AgentRunner(service,{model,modelId:'mock-agent-v4',...options});
 const cleanup=()=>{runner.close();service.close();rmSync(service.store.root,{recursive:true,force:true});};return {service,runner,cleanup};
}
async function source(service:LabService,name='pricing.html') {return service.import({filename:name,base64:Buffer.from('<html><body><p>Starter is $30 a month.</p></body></html>').toString('base64'),context:{audience:'new_customers',legacyEligible:false}});}
async function terminal(runner:AgentRunner,id:string){for(let i=0;i<300;i++){const task=runner.task(id);if(!['queued','running'].includes(task.status))return task;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Agent test timed out.');}

test('real ToolLoopAgent orchestrates tools, runs scanner, and persists server-derived identity',async()=>{
 const model=new MockLanguageModelV4({doGenerate:[call('list_assets',{}),call('read_pricing_facts',{}),say('unused')]});
 const {service,runner,cleanup}=setup(model);
 try {
  const asset=await source(service);
  model.doGenerate=async options=>{
   model.doGenerateCalls.push(options);const n=model.doGenerateCalls.length;
   if(n===1)return call('list_assets',{});if(n===2)return call('read_pricing_facts',{});if(n===3)return call('inspect_asset',{assetId:asset.id});if(n===4)return call('run_pricing_audit',{assetIds:[asset.id],monthlyCents:4500,priceEvidence:'$45'});return say('The recorded scan is ready for review.');
  };
  const created=runner.start({message:'Change Starter to $45 monthly and check the selected email.',assetIds:[asset.id]});assert.equal(created.status,'queued');
  const task=await terminal(runner,created.id);assert.equal(task.status,'complete');assert.ok(task.runId?.startsWith('lab_'));assert.equal(task.usage.outputTokens,50);assert.equal(task.model,'mock-agent-v4');
  const run=service.run(task.runId!);assert.deepEqual(run.facts,{...DEFAULT_FACTS,monthlyCents:4500});assert.equal(run.counts.suggestions,1);assert.equal(task.factsHash,run.factsHash);assert.equal(task.agentVersion,'mogs-lab-tool-agent-v2');assert.equal(task.agentVersion,AGENT_VERSION);
  const toolReply=model.doGenerateCalls.at(-1)!.prompt.flatMap(message=>message.role==='tool'?message.content:[]).find(content=>content.type==='tool-result'&&content.toolName==='run_pricing_audit');
  assert.ok(toolReply&&toolReply.type==='tool-result'&&toolReply.output.type==='json');
  const audit=toolReply.output.value as {perAsset:{assetId:string;filename:string;status:string;suggestions:number;unresolved:number}[];omittedAssetSummaries:number};
  assert.deepEqual(audit.perAsset,[{assetId:asset.id,filename:'pricing.html',status:asset.status,suggestions:1,unresolved:0}]);assert.equal(audit.omittedAssetSummaries,0);
  for(const key of ['findingSamples','original','replacement','rationale','locator'])assert.ok(!JSON.stringify(audit).includes('"'+key+'"'));
  assert.ok(task.events.some(event=>event.title==='Inspected source'));assert.ok(task.events.some(event=>event.title==='Pricing audit finished'));
  const row=service.store.db.prepare('SELECT payload FROM lab_agent_tasks WHERE id=?').get(task.id);assert.ok(row);
 }finally{cleanup();}
});
test('approved facts audit needs no new numeric price from human',async()=>{
 const model=new MockLanguageModelV4({doGenerate:say('placeholder')});const {service,runner,cleanup}=setup(model);
 try{const asset=await source(service);model.doGenerate=async options=>{model.doGenerateCalls.push(options);return model.doGenerateCalls.length===1?call('run_pricing_audit',{assetIds:[asset.id]}):say('Reviewed current pricing.');};const task=await terminal(runner,runner.start({message:'Find outdated pricing.',assetIds:[asset.id]}).id);assert.equal(task.status,'complete');assert.equal(service.run(task.runId!).facts.monthlyCents,4000);}finally{cleanup();}
});
test('clarification ends without scan; follow-up retains original scope and human context',async()=>{
 const model=new MockLanguageModelV4({doGenerate:call('ask_clarification',{question:'Which monthly Starter price should I check?'})});const {service,runner,cleanup}=setup(model);
 try{
  const a=await source(service);const first=await terminal(runner,runner.start({message:'Starter is changing; check this email.',assetIds:[a.id]}).id);assert.equal(first.status,'needs_input');assert.equal(first.runId,null);assert.equal(model.doGenerateCalls.length,1);
  model.doGenerate=async options=>{model.doGenerateCalls.push(options);return model.doGenerateCalls.length===2?call('run_pricing_audit',{assetIds:[a.id],monthlyCents:5000,priceEvidence:'$50'}):say('Checked at the requested monthly rate.');};
  const next=await terminal(runner,runner.start({message:'Use $50 per month.',previousTaskId:first.id}).id);assert.equal(next.status,'complete');assert.deepEqual(next.assetIds,[a.id]);assert.equal(service.run(next.runId!).facts.monthlyCents,5000);
  assert.match(JSON.stringify(model.doGenerateCalls[1]!.prompt),/Starter is changing/);
 }finally{cleanup();}
});
test('no scope and no explicit asset selection requires clarification before scanning',async()=>{
 const model=new MockLanguageModelV4({doGenerate:call('ask_clarification',{question:'Which imported assets should I check?'})});const {service,runner,cleanup}=setup(model);
 try{await source(service);const task=await terminal(runner,runner.start({message:'Check pricing.'}).id);assert.equal(task.status,'needs_input');assert.equal(service.store.runs().length,0);}finally{cleanup();}
});
test('tool cannot invent an asset ID, widen selected scope, or invent a target price',async()=>{
 for(const mode of ['invented','outside','price'] as const){
  const model=new MockLanguageModelV4({doGenerate:say('placeholder')});const {service,runner,cleanup}=setup(model);
  try{const a=await source(service),b=await source(service,'second.html');const ids=mode==='invented'?['asset_invented']:mode==='outside'?[b.id]:[a.id];
   model.doGenerate=async options=>{model.doGenerateCalls.push(options);return model.doGenerateCalls.length===1?call('run_pricing_audit',{assetIds:ids,monthlyCents:4500,priceEvidence:'$45'}):say('Cannot perform the requested scan.');};
   const task=await terminal(runner,runner.start({message:'Audit current pricing.',assetIds:[a.id]}).id);assert.equal(task.status,mode==='price'?'needs_input':'failed',mode);assert.equal(task.runId,null,mode);assert.equal(service.store.runs().length,0,mode);
  }finally{cleanup();}
 }
});
test('one active task, source freshness at tools, and one scan per task are enforced',async()=>{
 const model=new MockLanguageModelV4({doGenerate:say('placeholder')});const {service,runner,cleanup}=setup(model);
 try{
  const a=await source(service);model.doGenerate=async options=>{model.doGenerateCalls.push(options);return model.doGenerateCalls.length===1?call('run_pricing_audit',{assetIds:[a.id]}):model.doGenerateCalls.length===2?call('run_pricing_audit',{assetIds:[a.id]}):say('Already scanned.');};
  const first=runner.start({message:'Audit current pricing.',assetIds:[a.id]});assert.throws(()=>runner.start({message:'Audit again.',assetIds:[a.id]}),/in progress/);
  const task=await terminal(runner,first.id);assert.equal(task.status,'failed');assert.equal(service.store.runs().length,1);
 }finally{cleanup();}
 const model2=new MockLanguageModelV4({doGenerate:say('placeholder')});const second=setup(model2);
 try{const a=await source(second.service);model2.doGenerate=async()=>{writeFileSync(second.service.store.file(a.original),'Changed source bytes');return call('inspect_asset',{assetId:a.id});};const task=await terminal(second.runner,second.runner.start({message:'Inspect this source.',assetIds:[a.id]}).id);assert.equal(task.status,'failed');assert.equal(second.service.store.runs().length,0);}finally{second.cleanup();}
});
test('close cancels immediately and late provider responses cannot overwrite task',async()=>{
 let release:(value:ReturnType<typeof say>)=>void=()=>{};const model=new MockLanguageModelV4({doGenerate:()=>new Promise(resolve=>{release=resolve;})});const {service,runner,cleanup}=setup(model);
 try{const a=await source(service);const task=runner.start({message:'Audit current pricing.',assetIds:[a.id]});await new Promise(resolve=>setTimeout(resolve,10));runner.close();release(say('late result'));
  await new Promise(resolve=>setTimeout(resolve,20));const row=service.store.db.prepare('SELECT payload FROM lab_agent_tasks WHERE id=?').get(task.id) as {payload:string};const saved=JSON.parse(row.payload).task;assert.equal(saved.status,'cancelled');assert.equal(saved.reply,null);assert.equal(service.store.runs().length,0);
 }finally{cleanup();}
});
test('restart preserves completed tasks and marks interrupted tasks failed',async()=>{
 const model=new MockLanguageModelV4({doGenerate:call('ask_clarification',{question:'Which assets?'})});const {service,runner,cleanup}=setup(model);
 try{const completed=await terminal(runner,runner.start({message:'Check it.'}).id);const row=JSON.parse((service.store.db.prepare('SELECT payload FROM lab_agent_tasks WHERE id=?').get(completed.id) as {payload:string}).payload);row.task.id='task_interrupted';row.task.status='running';service.store.db.prepare('INSERT INTO lab_agent_tasks VALUES(?,?,?)').run(row.task.id,row.task.createdAt,JSON.stringify(row));
  const restarted=new AgentRunner(service,{model});assert.equal(restarted.task(completed.id).status,'needs_input');assert.equal(restarted.task('task_interrupted').status,'failed');restarted.close();
 }finally{cleanup();}
});
test('missing dedicated provider key reports unavailable without provider calls',()=>{
 process.env.MOGS_MULTICHANNEL_ENABLED='1';const saved=process.env.MOGS_LAB_ANTHROPIC_API_KEY;delete process.env.MOGS_LAB_ANTHROPIC_API_KEY;const service=new LabService('test_agent_'+randomUUID().replaceAll('-',''));const runner=new AgentRunner(service);
 try{assert.equal(runner.availability().available,false);assert.throws(()=>runner.start({message:'Audit pricing.'}),/MOGS_LAB_ANTHROPIC_API_KEY/);assert.equal(runner.tasks().length,0);}finally{runner.close();service.close();rmSync(service.store.root,{recursive:true,force:true});if(saved!==undefined)process.env.MOGS_LAB_ANTHROPIC_API_KEY=saved;}
});

test('timeout persists cancellation even when a model ignores abort and resolves late',async()=>{
 let release:(value:ReturnType<typeof say>)=>void=()=>{};const model=new MockLanguageModelV4({doGenerate:()=>new Promise(resolve=>{release=resolve;})});const {service,runner,cleanup}=setup(model,{timeoutMs:20});
 try{const a=await source(service);const initial=runner.start({message:'Audit current pricing.',assetIds:[a.id]});await new Promise(resolve=>setTimeout(resolve,40));assert.equal(runner.task(initial.id).status,'cancelled');release(say('late result'));await new Promise(resolve=>setTimeout(resolve,15));assert.equal(runner.task(initial.id).status,'cancelled');assert.equal(runner.task(initial.id).reply,null);}finally{cleanup();}
});
test('bare numeric reply is accepted only after a monthly-price clarification',async()=>{
 const model=new MockLanguageModelV4({doGenerate:call('ask_clarification',{question:'Which monthly Starter price should I use?'})});const {service,runner,cleanup}=setup(model);
 try{const a=await source(service);const first=await terminal(runner,runner.start({message:'The rate changed.',assetIds:[a.id]}).id);model.doGenerate=async options=>{model.doGenerateCalls.push(options);return model.doGenerateCalls.length===2?call('run_pricing_audit',{assetIds:[a.id],monthlyCents:4500,priceEvidence:'45'}):say('Checked at $45 monthly.');};const follow=await terminal(runner,runner.start({message:'45',previousTaskId:first.id}).id);assert.equal(follow.status,'complete');assert.equal(service.run(follow.runId!).facts.monthlyCents,4500);}finally{cleanup();}
});
test('unselected assets need actual human scope evidence; six-step and output budgets stop loops',async()=>{
 const model=new MockLanguageModelV4({doGenerate:say('placeholder')});const {service,runner,cleanup}=setup(model);
 try{const a=await source(service);model.doGenerate=async options=>{model.doGenerateCalls.push(options);return call('run_pricing_audit',{assetIds:[a.id],scopeEvidence:'all assets'});};const result=await terminal(runner,runner.start({message:'Check pricing.'}).id);assert.equal(result.status,'needs_input');assert.equal(service.store.runs().length,0);
  model.doGenerateCalls.length=0;model.doGenerate=async options=>{model.doGenerateCalls.push(options);return call('read_pricing_facts',{});};const looping=await terminal(runner,runner.start({message:'Read current facts.',assetIds:[a.id]}).id);assert.equal(model.doGenerateCalls.length,6);assert.equal(looping.usage.outputTokens,60);
  model.doGenerateCalls.length=0;model.doGenerate=async options=>{model.doGenerateCalls.push(options);return {...call('read_pricing_facts',{}),usage:{...usage,outputTokens:{total:1000,text:1000,reasoning:undefined}}};};const budgeted=await terminal(runner,runner.start({message:'Read current facts.',assetIds:[a.id]}).id);assert.equal(model.doGenerateCalls.length,2);assert.equal(model.doGenerateCalls[1]!.maxOutputTokens,1000);assert.equal(budgeted.usage.outputTokens,2000);
 }finally{cleanup();}
});

test('declared full scope cannot silently omit an asset; exact filename scope can narrow it',async()=>{
 const model=new MockLanguageModelV4({doGenerate:say('placeholder')});const {service,runner,cleanup}=setup(model);
 try{const a=await source(service,'first.html'),b=await source(service,'second.html');model.doGenerate=async options=>{model.doGenerateCalls.push(options);return call('run_pricing_audit',{assetIds:[a.id],scopeEvidence:'all files'});};const omitted=await terminal(runner,runner.start({message:'Check all files.',assetIds:[a.id,b.id]}).id);assert.equal(omitted.status,'needs_input');assert.equal(service.store.runs().length,0);
  model.doGenerateCalls.length=0;model.doGenerate=async options=>{model.doGenerateCalls.push(options);return model.doGenerateCalls.length===1?call('run_pricing_audit',{assetIds:[b.id],scopeEvidence:'only second.html'}):say('Checked the requested file.');};const narrowed=await terminal(runner,runner.start({message:'Check only second.html.',assetIds:[a.id,b.id]}).id);assert.equal(narrowed.status,'complete');assert.deepEqual(service.run(narrowed.runId!).assetIds,[b.id]);
 }finally{cleanup();}
});
