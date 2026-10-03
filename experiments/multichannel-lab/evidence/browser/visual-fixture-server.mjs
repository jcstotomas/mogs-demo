// Local visual fixtures only: no provider imports, outbound calls, or proxying.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const lab=fileURLToPath(new URL('../../',import.meta.url));
const seed=JSON.parse(readFileSync(new URL('observed-existing-agent-state.json',import.meta.url)));
function stateFor(scenario){
 const s=structuredClone(seed);s.agentTasks=[];s.agent={available:false,model:'local-visual-fixture-no-provider',reason:'Local visual fixture: provider configuration is unavailable.'};
 if(scenario==='failed'){
  const a=s.assets.find(a=>a.filename==='deck-new.pdf');a.status='failed';a.extraction=null;a.error='Local parser-failure fixture: the PDF could not be read.';a.active=true;
  s.assets=[a];s.runs=[{...s.runs[0],id:'lab_fixture_parser_failure',status:'failed',assetIds:[a.id],revisions:{[a.id]:a.revision},findings:[],errors:['Local parser-failure fixture: the PDF could not be read.'],counts:{assets:1,units:0,checked:0,suggestions:0,unresolved:0},stale:false}];
 } else if(scenario==='stale'){
  s.runs=[s.runs.find(r=>r.assetIds.length===12)];s.runs[0].stale=true;
  s.assets.sort((a,b)=>Number(b.filename==='email-new.html')-Number(a.filename==='email-new.html'));
 } else {s.runs=[];}
 return s;
}
createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:3214');
 const scenario=new URL(req.headers.referer||'http://127.0.0.1:3214/unavailable').pathname.slice(1);
 const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
 if(url.pathname==='/api/state')return json(stateFor(scenario));
 const match=/^\/api\/assets\/([^/]+)\/preview\/(\d+)$/.exec(url.pathname);
 if(match){const a=seed.assets.find(a=>a.id===match[1]);const preview=a?.extraction?.previews.find(p=>p.page===Number(match[2]));if(preview){const runtime=path.join(lab,'.runtime/agent-review');const p=path.resolve(runtime,preview.file);if(p.startsWith(runtime+path.sep)){try{res.writeHead(200,{'Content-Type':preview.mime});res.end(readFileSync(p));return;}catch{}}}return json({error:'Fixture preview not available'},404);}
 if(['/unavailable','/failed','/stale','/'].includes(url.pathname)){
  const scenarioName=url.pathname.slice(1)||'unavailable';let html=readFileSync(path.join(lab,'public/index.html'),'utf8');html=html.replace('<main>','<main><p class="notice">Local visual fixture: '+scenarioName+'. No provider request is possible.</p>');res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;
 }
 if(['/app.js','/styles.css'].includes(url.pathname)){res.writeHead(200,{'Content-Type':url.pathname.endsWith('.js')?'text/javascript':'text/css'});res.end(readFileSync(path.join(lab,'public',url.pathname.slice(1))));return;}
 json({error:'Local fixture server does not accept writes or provider requests'},404);
}).listen(3214,'127.0.0.1',()=>console.log('Local visual fixture server3214; no outbound or provider requests.'));
