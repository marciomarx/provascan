/* Persistent LAN operation queue. One owner tab per browser origin. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./drive-store.js'):root.ProvaScanDriveStore);if(typeof module==='object'&&module.exports)module.exports=api;else root.ProvaScanLocalModel=api})(typeof globalThis!=='undefined'?globalThis:this,function(store){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x)),{flatten,stable}=store;
class Model{
 constructor(state={},id=()=>crypto.randomUUID()){this.id=id;this.serverId=state.serverId||null;this.snapshot=state.snapshot||null;this.pending=state.pending||[];this.baseline=state.baseline||{};this.blocked=state.blocked||null;this.ackSeq=state.ackSeq||0}
 versions(){const v={...(this.snapshot?.versions||{})};for(const op of this.pending)for(const c of op.changes)v[c.key]=op.id;return v}
 capture(db){if(!this.serverId||this.blocked)throw Error('Conecte ao notebook e resolva os conflitos antes de editar.');const next=flatten(db),versions=this.versions(),changes=[];for(const key of new Set([...Object.keys(this.baseline),...Object.keys(next)]))if(stable(this.baseline[key]??null)!==stable(next[key]??null))changes.push({key,base:versions[key]??null,value:copy(next[key]??null)});if(changes.length){const depends={};for(const c of changes)if(c.key.startsWith('result/')){const key='exam/'+c.key.split('/')[1];depends[key]=versions[key]??null}this.pending.push({protocol:1,serverId:this.serverId,id:this.id(),changes,depends})}this.baseline=copy(next)}
 receive(snapshot){if(snapshot.protocol!==1)throw Error('Versão do servidor incompatível.');if(this.serverId&&snapshot.serverId!==this.serverId)throw Error('Outro banco de dados foi encontrado. Preserve um backup antes de trocar de notebook.');if(this.snapshot&&snapshot.seq<this.snapshot.seq)return;this.serverId=snapshot.serverId;this.snapshot=copy(snapshot)}
 acknowledge(id,seq){this.pending=this.pending.filter(op=>op.id!==id);this.ackSeq=Math.max(this.ackSeq,seq)}
 view(){if(!this.snapshot)return null;const records=flatten(this.snapshot.db);for(const op of this.pending)for(const c of op.changes)records[c.key]=copy(c.value);const classes=[],exams=[];for(const [key,v] of Object.entries(records)){if(v===null)continue;if(key.startsWith('class/'))classes.push({...copy(v),students:[]});if(key.startsWith('exam/'))exams.push({...copy(v),results:{}})}for(const [key,v] of Object.entries(records)){if(v===null)continue;const [kind,parent,child]=key.split('/');if(kind==='student')classes.find(c=>c.id===parent)?.students.push(copy(v));if(kind==='result'){const e=exams.find(e=>e.id===parent);if(e)e.results[child]=copy(v)}}return{classes,exams}}
 accept(db){this.baseline=copy(flatten(db))}
 conflict(message){this.blocked=copy(message);if(message.snapshot)this.receive(message.snapshot)}
 resolve(keepLocal,localData){if(!this.snapshot)throw Error('Conecte ao notebook antes de resolver.');const desired=copy(localData);this.pending=[];this.blocked=null;this.accept(this.snapshot.db);if(keepLocal)this.capture(desired);return this.view()}
 serialize(){return{serverId:this.serverId,snapshot:this.snapshot,pending:this.pending,baseline:this.baseline,blocked:this.blocked,ackSeq:this.ackSeq}}
}
return{Model};
});
