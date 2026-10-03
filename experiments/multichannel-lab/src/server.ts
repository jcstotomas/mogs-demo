import { createServer,type IncomingMessage,type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { load } from 'cheerio';
import { ZodError } from 'zod';
import { enabled } from './gate.ts';
import { limits } from './contracts.ts';
import { PACKAGE_ROOT } from './store.ts';
import { LabService } from './service.ts';
import { AgentRunner } from './agent.ts';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
function json(res:ServerResponse,value:unknown,status=200){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req:IncomingMessage):Promise<unknown>{
 if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('Use an application/json request.'),{status:415});
 let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>limits.requestBytes)throw Object.assign(new Error('Upload exceeds the 15 MB request limit.'),{status:413});chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createLabServer(options:{storage?:string;serviceFactory?:()=>LabService}={}){
 let service:LabService|undefined;
 let agent:AgentRunner|undefined;
 const runtime=()=>service??=(options.serviceFactory?.()??new LabService(options.storage??process.env.MOGS_LAB_STORAGE??'default'));
 const assistant=()=>agent??=new AgentRunner(runtime());
 const server=createServer(async(req,res)=>{
  try{
   // The flag is checked before reading request bodies, files, or initializing storage.
   if(!enabled()){json(res,{error:'Multichannel lab is disabled.'},404);return;}
   const host=req.headers.host??'';
   if(!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))throw Object.assign(new Error('The lab is available only on localhost.'),{status:403});
   const origin='http://'+host;
   if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site')throw Object.assign(new Error('Use the local lab console for this request.'),{status:403});
   const url=new URL(req.url??'/',origin),pathname=url.pathname;
   if(req.method==='GET'&&['/','/app.js','/styles.css'].includes(pathname)){
    const file=pathname==='/'?'index.html':pathname.slice(1);const content=await readFile(path.join(PACKAGE_ROOT,'public',file));res.writeHead(200,{...headers,'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});res.end(content);return;
   }
   if(req.method==='GET'&&pathname==='/api/state'){json(res,{...runtime().state(),agent:assistant().availability(),agentTasks:assistant().tasks()});return;}
   if(req.method==='POST'&&pathname==='/api/import'){const input=await body(req);if(!enabled()){json(res,{error:'Multichannel lab is disabled.'},404);return;}json(res,await runtime().import(input));return;}
   if(req.method==='POST'&&pathname==='/api/demo'){await body(req);json(res,await runtime().demo());return;}
   if(req.method==='POST'&&pathname==='/api/analyze'){const input=await body(req);json(res,runtime().analyze(input),202);return;}
   if(req.method==='POST'&&pathname==='/api/agent'){const input=await body(req);json(res,assistant().start(input),202);return;}
   const taskMatch=/^\/api\/agent\/(task_[a-z0-9-]+)$/.exec(pathname);
   if(req.method==='GET'&&taskMatch){json(res,assistant().task(taskMatch[1]));return;}
   const runMatch=/^\/api\/runs\/(lab_[a-z0-9-]+)(\/export)?$/.exec(pathname);
   if(req.method==='GET'&&runMatch){const run=runtime().run(runMatch[1]);if(runMatch[2])res.setHeader('Content-Disposition','attachment; filename="'+run.id+'.json"');json(res,runMatch[2]?runtime().export(run.id):run);return;}
   const previewMatch=/^\/api\/assets\/(asset_[a-f0-9]+)\/preview\/(\d+)$/.exec(pathname);
   if(req.method==='GET'&&previewMatch){
    const {preview,bytes}=runtime().preview(previewMatch[1],Number(previewMatch[2]));let output:Buffer|string=bytes;
    if(preview.mime==='text/html'){
     const $=load(bytes.toString('utf8'));const unit=url.searchParams.get('unit');if(unit) $('[data-unit-id]').each((_,node)=>{if($(node).attr('data-unit-id')===unit)$(node).attr('data-highlighted','true').attr('id','mogs-selected-unit');});
     $('head').append('<style>[data-highlighted="true"] {outline:3px solid #176044;background:#e6f1e7;color:#12382a;outline-offset:3px}</style>');output=$.html();
    }
    res.writeHead(200,{...headers,'Content-Type':preview.mime,'Content-Security-Policy':"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox"});res.end(output);return;
   }
   json(res,{error:'Not found.'},404);
  }catch(error){const status=error instanceof ZodError||error instanceof SyntaxError?400:typeof (error as {status?:unknown})?.status==='number'?(error as {status:number}).status:500;json(res,{error:error instanceof ZodError?'Check the required input fields and values.':error instanceof SyntaxError?'Invalid JSON request.':error instanceof Error?error.message:'The operation failed.'},status);}
 });
 server.requestTimeout=60000;server.headersTimeout=10000;server.on('close',()=>{agent?.close();service?.close();});
 return server;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const port=Number(process.env.MOGS_LAB_PORT??3210);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('MOGS_LAB_PORT must be 1024–65535.');
 const server=createLabServer();server.listen(port,'127.0.0.1',()=>process.stdout.write('MOGS multichannel lab: http://127.0.0.1:'+port+' ('+(enabled()?'enabled':'disabled')+')\n'));
 const stop=()=>{server.close();server.closeAllConnections();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
