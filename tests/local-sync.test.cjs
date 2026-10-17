const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Model}=require('../local-model.js');
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(saved,{offline=false,stalled=false}={}){
 const nodes={},storage=new Map(saved?Object.entries(saved):[]),intervals=[],requests=[],sockets=[],listeners={},timers=[];let open=false,data={classes:[],exams:[]};
 const state={type:'snapshot',protocol:1,seq:1,serverId:'notebook-1',release:'release-1',role:'notebook',versions:{'class/c':'remote-1'},db:{classes:[{id:'c',name:'Original',students:[]}],exams:[]}};
 function node(){return{children:[{}],style:{},setAttribute(){},before(){},querySelector:()=>node(),addEventListener(){},click(){}}}
 const document={getElementById:id=>nodes[id]||(nodes[id]=node()),querySelector:()=>nodes.shell||(nodes.shell=node()),createElement:()=>node()};
 class Socket{constructor(){sockets.push(this)}send(raw){requests.push(JSON.parse(raw))}close(){this.onclose?.()}}
 const app={escape:x=>String(x),getData:()=>data,replaceData:next=>{data=JSON.parse(JSON.stringify(next))},reviewOpen:()=>open};
 const sandbox={window:{provascanApp:app,ProvaScanLocalModel:{Model},PROVASCAN_LOCAL_RELEASE:'release-1',addEventListener:(name,fn)=>listeners[name]=fn},navigator:{locks:{request:(key,opts,fn)=>{fn({})}}},document,location:{origin:'https://localhost:8765',href:'',reload(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},WebSocket:Socket,setInterval:fn=>intervals.push(fn),setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},URL,Blob,AbortController,crypto:{randomUUID:()=> 'operation-local-1'},alert(){},confirm:()=>true,fetch:async(url,options)=>{if(stalled&&url==='/api/state')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('timeout'),{name:'AbortError'}))));if(offline)throw new TypeError('Failed to fetch');return{status:200,ok:true,json:async()=>state}}};
 vm.runInNewContext(fs.readFileSync('local-sync.js','utf8'),sandbox);await tick();
 const socket=sockets[0];socket?.onopen();
 return{sandbox,app,state,storage,socket,sockets,listeners,requests,intervals,timers,setStalled:v=>stalled=v,setOffline:v=>offline=v,setOpen:v=>open=v,setData:v=>data=v};
}
test('remote snapshots do not rebase edits while a form is open; a stale local edit keeps its original base version',async()=>{
 const h=await setup();h.setOpen(true);
 const newer={...h.state,seq:2,versions:{'class/c':'remote-2'},db:{classes:[{id:'c',name:'Remote edited',students:[]}],exams:[]}};
 h.socket.onmessage({data:JSON.stringify(newer)});
 assert.equal(h.app.getData().classes[0].name,'Original');
 h.app.getData().classes[0].name='Local edited';h.sandbox.window.provascanLocal.changed(h.app.getData());
 const op=h.requests.find(r=>r.id);assert.equal(op.changes[0].base,'remote-1');assert.equal(op.changes[0].value.name,'Local edited');
 h.socket.onmessage({data:JSON.stringify({type:'conflict',id:op.id,keys:['class/c'],snapshot:newer})});
 assert.ok(JSON.parse(h.storage.get('provascan-lan-v1')).blocked);
});
test('an acknowledged operation is removed persistently and server snapshot updates visible data',async()=>{
 const h=await setup();h.app.getData().classes[0].name='Edited';h.sandbox.window.provascanLocal.changed(h.app.getData());
 const op=h.requests.find(r=>r.id);h.socket.onmessage({data:JSON.stringify({type:'ack',id:op.id,seq:2})});
 assert.equal(JSON.parse(h.storage.get('provascan-lan-v1')).pending.length,0);
 const updated={...h.state,seq:2,versions:{'class/c':op.id},db:{classes:[{id:'c',name:'Edited',students:[]}],exams:[]}};
 h.socket.onmessage({data:JSON.stringify(updated)});assert.equal(h.app.getData().classes[0].name,'Edited');
});
function offlineState(){
 const snapshot={type:'snapshot',protocol:1,seq:1,serverId:'notebook-1',release:'release-1',versions:{'class/c':'v1','student/c/s':'v1','exam/e':'v1'},db:{classes:[{id:'c',name:'Turma',students:[{id:'s',name:'Ana'}]}],exams:[{id:'e',classId:'c',name:'Prova',n:2,alt:4,points:10,key:{0:'A',1:'B'},results:{}}]}};
 const m=new Model();m.receive(snapshot);m.accept(snapshot.db);return{'provascan-lan-v1':JSON.stringify(m.serialize())};
}
test('cold offline start recovers data, allows saved edits and grades, and preserves the queue across a second start',async()=>{
 const h=await setup(offlineState(),{offline:true});assert.equal(h.sockets.length,0);assert.equal(h.app.getData().classes[0].name,'Turma');assert.equal(h.sandbox.document.querySelector('.shell').inert,false);
 const data=h.app.getData();data.classes[0].students.push({id:'new',name:'Beto'});data.exams[0].results.s={answers:{0:'A',1:'B'},score:10,questionCount:2};h.sandbox.window.provascanLocal.changed(data);
 const saved=JSON.parse(h.storage.get('provascan-lan-v1'));assert.equal(saved.pending.length,1);assert.equal(saved.pending[0].depends['exam/e'],'v1');assert.equal(saved.pending[0].changes.find(c=>c.key==='result/e/s').value.score,10);
 const reopened=await setup(Object.fromEntries(h.storage),{offline:true});assert.equal(reopened.app.getData().classes[0].students.length,2);assert.equal(reopened.app.getData().exams[0].results.s.score,10);assert.equal(JSON.parse(reopened.storage.get('provascan-lan-v1')).pending[0].id,saved.pending[0].id);
});
test('returning online reconnects and sends persisted offline operation with the original ID before removing it on ACK',async()=>{
 const h=await setup(offlineState(),{offline:true});h.app.getData().classes[0].name='Offline edit';h.sandbox.window.provascanLocal.changed(h.app.getData());const op=JSON.parse(h.storage.get('provascan-lan-v1')).pending[0];
 h.setOffline(false);h.listeners.online();await tick();const socket=h.sockets[0];socket.onopen();socket.onmessage({data:JSON.stringify(h.state)});assert.equal(h.requests.find(r=>r.id)?.id,op.id);assert.equal(JSON.parse(h.storage.get('provascan-lan-v1')).pending.length,1);
 socket.onmessage({data:JSON.stringify({type:'ack',id:op.id,seq:2})});assert.equal(JSON.parse(h.storage.get('provascan-lan-v1')).pending.length,0);
});
test('an uninitialized device stays locked offline rather than creating a competing authority',async()=>{
 const h=await setup(null,{offline:true});assert.equal(h.sandbox.document.querySelector('.shell').inert,true);assert.equal(h.sockets.length,0);assert.equal(h.storage.has('provascan-lan-v1'),false);
});

test('a hanging notebook probe does not block offline work and aborts so reconnection can retry',async()=>{
 const h=await setup(offlineState(),{stalled:true});assert.equal(h.sandbox.document.querySelector('.shell').inert,false);assert.equal(h.app.getData().classes[0].name,'Turma');
 const probe=h.timers.find(t=>t.ms===8000);assert.ok(probe);probe.fn();await tick();const retry=h.timers.find(t=>t.ms===500);assert.ok(retry);h.setStalled(false);retry.fn();await tick();assert.equal(h.sockets.length,1);
});
