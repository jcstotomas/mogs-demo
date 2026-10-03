import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,rmSync,mkdirSync,symlinkSync } from 'node:fs';
import { once } from 'node:events';
import { request } from 'node:http';
import { createLabServer } from '../src/server.ts';
import { enabled } from '../src/gate.ts';
import { Store,RUNTIME_ROOT,confined } from '../src/store.ts';
import path from 'node:path';
test('flag-off HTTP rejects before service initialization and body parsing',async()=>{
 const old=process.env.MOGS_MULTICHANNEL_ENABLED;delete process.env.MOGS_MULTICHANNEL_ENABLED;let calls=0;const server=createLabServer({serviceFactory:()=>{calls++;throw new Error('Must not initialize.');}});server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
 try{for(const route of ['/','/app.js','/api/state','/api/import','/api/demo','/api/analyze','/api/agent','/api/agent/task_test','/api/runs/lab_test']){const response=await fetch('http://127.0.0.1:'+port+route,{method:route.startsWith('/api/')?'POST':'GET',headers:{'Content-Type':'application/json'},...(route.startsWith('/api/')?{body:'{invalid'}:{})});assert.equal(response.status,404);}assert.equal(calls,0);assert.throws(()=>new Store('disabled_probe'),/disabled/);assert.equal(existsSync(path.join(RUNTIME_ROOT,'disabled_probe')),false);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));if(old===undefined)delete process.env.MOGS_MULTICHANNEL_ENABLED;else process.env.MOGS_MULTICHANNEL_ENABLED=old;}
});
test('only exact flag value 1 enables the lab',()=>{for(const value of [undefined,'','0','true','yes','01'])assert.equal(enabled({MOGS_MULTICHANNEL_ENABLED:value}),false);assert.equal(enabled({MOGS_MULTICHANNEL_ENABLED:'1'}),true);});
test('runtime rejects escape paths and symbolic links',()=>{const root=path.join(RUNTIME_ROOT,'path_probe');mkdirSync(root,{recursive:true});try{assert.throws(()=>confined(root,'../../outside'),/escapes/);symlinkSync('/tmp',path.join(root,'link'));assert.throws(()=>confined(root,'link/file'),/Symbolic/);}finally{rmSync(root,{recursive:true,force:true});}});
test('enabled server rejects remote origin and host without initializing storage',async()=>{
 process.env.MOGS_MULTICHANNEL_ENABLED='1';let calls=0;const server=createLabServer({serviceFactory:()=>{calls++;throw new Error('Must not initialize.');}});server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as {port:number}).port;
 try{const response=await fetch('http://127.0.0.1:'+port+'/api/state',{headers:{Origin:'https://external.invalid'}});assert.equal(response.status,403);
 const status=await new Promise<number|undefined>((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path:'/api/state',headers:{Host:'remote.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,403);assert.equal(calls,0);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));delete process.env.MOGS_MULTICHANNEL_ENABLED;}
});
