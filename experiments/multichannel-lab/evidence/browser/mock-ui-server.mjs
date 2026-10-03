// LOCAL-ONLY BROWSER FIXTURE. It imports no provider or application service.
// This verifies frontend request/clarification payloads, not agent behavior.
import {createServer} from 'node:http';
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../../',import.meta.url);
const seed=JSON.parse(readFileSync(new URL('observed-existing-agent-state.json',import.meta.url)));
seed.agentTasks=[];seed.agent={available:true,model:'local-browser-fixture-no-provider'};
let submissions=[];
createServer(async(req,res)=>{
 const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url==='/api/state')return send(seed);
 if(req.url==='/api/agent'&&req.method==='POST'){
  let body='';for await(const c of req)body+=c;const input=JSON.parse(body);submissions.push(input);writeFileSync(new URL('mock-ui-submissions.json',import.meta.url),JSON.stringify(submissions,null,2)+'\n');
  const followup=!!input.previousTaskId;
  const task={id:followup?'task_fixture_complete':'task_fixture_question',status:followup?'complete':'needs_input',message:input.message,reply:followup?'Fixture only: the reply was received. Review the linked synthetic report.':'Fixture only: What monthly Starter price should I use?',events:[{at:new Date().toISOString(),title:'Local fixture response',detail:'No provider was contacted.'}],runId:followup?seed.runs[0].id:null,error:null,model:'local-browser-fixture-no-provider',createdAt:new Date().toISOString(),completedAt:new Date().toISOString(),usage:{inputTokens:0,outputTokens:0},previousTaskId:input.previousTaskId??null};
  seed.agentTasks.unshift(task);return send(task,202);
 }
 if(['/','/app.js','/styles.css'].includes(req.url)){const name=req.url==='/'?'index.html':req.url.slice(1);res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'text/css'});res.end(readFileSync(new URL('public/'+name,root)));return;}
 send({error:'Local fixture endpoint only'},404);
}).listen(3214,'127.0.0.1',()=>console.log('Local fixture UI server 3214; no provider access.'));
