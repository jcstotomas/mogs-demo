import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { createLabServer } from '../src/server.ts';
import { RUNTIME_ROOT } from '../src/store.ts';
test('HTTP reports missing agent configuration and exports frozen located scan evidence',async()=>{
 process.env.MOGS_MULTICHANNEL_ENABLED='1';delete process.env.MOGS_LAB_ANTHROPIC_API_KEY;
 const storage='test_http_agent';rmSync(path.join(RUNTIME_ROOT,storage),{recursive:true,force:true});
 const server=createLabServer({storage});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const post=(route:string,data:unknown)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 try{
  const state=await (await fetch(base+'/api/state')).json();assert.equal(state.agent.available,false);assert.match(state.agent.reason,/MOGS_LAB_ANTHROPIC_API_KEY/);assert.deepEqual(state.agentTasks,[]);
  const unavailable=await post('/api/agent',{message:'Audit all emails'});assert.equal(unavailable.status,503);
  const asset=await (await post('/api/import',{filename:'http.html',base64:Buffer.from('<h1>Starter for new customers</h1><p>Starter is $30 a month.</p>').toString('base64'),context:{audience:'new_customers',legacyEligible:false}})).json();
  const response=await post('/api/analyze',{assetIds:[asset.id],facts:state.facts});assert.equal(response.status,202);const run=await response.json();
  for(let i=0;i<100;i++){const current=await (await fetch(base+'/api/runs/'+run.id)).json();if(!['queued','running'].includes(current.status))break;await new Promise(r=>setTimeout(r,10));}
  const download=await fetch(base+'/api/runs/'+run.id+'/export');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/attachment/);const report=await download.json();assert.equal(report.publication,'none');assert.equal(report.sourceManifest[0].filename,'http.html');assert.equal(report.sourceManifest[0].sourceHash,asset.sourceHash);assert.equal(report.run.findings.filter((f:any)=>f.replacement).length,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(path.join(RUNTIME_ROOT,storage),{recursive:true,force:true});delete process.env.MOGS_MULTICHANNEL_ENABLED;}
});
