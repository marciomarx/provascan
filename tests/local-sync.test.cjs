const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Model}=require('../local-model.js');
const tick=()=>new Promise(r=>setImmediate(r));
async function setup(saved){
 const nodes={},storage=new Map(saved?Object.entries(saved):[]),intervals=[],requests=[],sockets=[];let open=false,data={classes:[],exams:[]};
 const state={type:'snapshot',protocol:1,seq:1,serverId:'notebook-1',release:'release-1',role:'notebook',versions:{'class/c':'remote-1'},db:{classes:[{id:'c',name:'Original',students:[]}],exams:[]}};
 function node(){return{children:[{}],style:{},setAttribute(){},before(){},querySelector:()=>node(),addEventListener(){},click(){}}}
 const document={getElementById:id=>nodes[id]||(nodes[id]=node()),querySelector:()=>nodes.shell||(nodes.shell=node()),createElement:()=>node()};
 class Socket{constructor(){sockets.push(this)}send(raw){requests.push(JSON.parse(raw))}close(){this.onclose?.()}}
 const app={escape:x=>String(x),getData:()=>data,replaceData:next=>{data=JSON.parse(JSON.stringify(next))},reviewOpen:()=>open};
 const sandbox={window:{provascanApp:app,ProvaScanLocalModel:{Model},PROVASCAN_LOCAL_RELEASE:'release-1',addEventListener(){}},navigator:{locks:{request:(key,opts,fn)=>{fn({})}}},document,location:{origin:'https://localhost:8765',href:'',reload(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},WebSocket:Socket,setInterval:fn=>intervals.push(fn),setTimeout(){},clearTimeout(){},URL,Blob,crypto:{randomUUID:()=> 'operation-local-1'},alert(){},confirm:()=>true,fetch:async url=>({status:200,ok:true,json:async()=>state})};
 vm.runInNewContext(fs.readFileSync('local-sync.js','utf8'),sandbox);await tick();
 const socket=sockets[0];socket.onopen();
 return{sandbox,app,state,storage,socket,requests,intervals,setOpen:v=>open=v,setData:v=>data=v};
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
