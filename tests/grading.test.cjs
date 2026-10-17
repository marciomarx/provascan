const {test}=require('node:test'),assert=require('node:assert/strict');
const grading=require('../grading.js');
const {Store}=require('../drive-store.js');
function exam(){const e={id:'e',classId:'c',n:20,alt:5,name:'Prova',points:10,key:Object.fromEntries(Array.from({length:20},(_,i)=>[i,'A'])),results:{}};
 const answers=Object.fromEntries(Array.from({length:20},(_,i)=>[i,i<16?'A':'B']));
 e.results.s={...grading.grade(e,answers),answers,keySnapshot:{...e.key},savedAt:'original',markedAlternatives:[['A']]};return e;
}
test('changing 10 to 100 rescales all saved grades, leaves pending students absent, and does not mutate the preview source',()=>{
 const e=exam(),original=JSON.stringify(e),p=grading.preview(e,100,[]);
 assert.equal(p.rows[0].before,8);assert.equal(p.rows[0].after,80);assert.equal(JSON.stringify(e),original);
 const changed=grading.apply(e,100,[],'change-1');assert.equal(changed.points,100);assert.equal(changed.results.s.score,80);assert.equal(changed.results.s.pointsSnapshot,100);assert.equal(changed.results.s.savedAt,'original');assert.deepEqual(changed.results.s.answers,e.results.s.answers);assert.equal(Object.keys(changed.results).length,1);assert.equal(changed.results.s.gradingHistory[0].score,8);
});
test('annulling a correct answer removes it from numerator and denominator; annulling an error removes only its denominator',()=>{
 const e=exam(),correct=grading.apply(e,10,[0]),wrong=grading.apply(e,10,[19]);
 assert.equal(correct.results.s.correct,15);assert.equal(correct.results.s.score,15/19*10);
 assert.equal(wrong.results.s.correct,16);assert.equal(wrong.results.s.wrong,3);assert.equal(wrong.results.s.score,16/19*10);
 assert.equal(wrong.results.s.correct+wrong.results.s.wrong+wrong.results.s.blank+wrong.results.s.annulledSnapshot.length,20);
});
test('blank, multiple, and doubtful marks on annulled questions are excluded; valid doubts still block scoring',()=>{
 const e=exam(),answers={...e.results.s.answers,0:'MULTI',1:'',2:'?'};
 const result=grading.grade({...e,annulled:[0,1,2]},answers);assert.equal(result.correct,13);assert.equal(result.wrong,4);assert.equal(result.blank,0);assert.equal(result.score,13/17*10);
 assert.throws(()=>grading.grade({...e,annulled:[0,1]},answers),/dúvidas/);
});
test('restoring questions recovers their original answers and key snapshot even after the current key changes',()=>{
 const e=exam(),changed=grading.apply(e,100,[0,19],'first');changed.key[0]='B';
 const restored=grading.apply(changed,10,[],'second');assert.equal(restored.results.s.score,8);assert.equal(restored.results.s.correct,16);assert.equal(restored.results.s.keySnapshot[0],'A');assert.equal(restored.gradingHistory.length,2);assert.equal(restored.results.s.gradingHistory.length,2);
});
test('invalid totals and annulling every question are rejected before any change',()=>{
 const e=exam(),original=JSON.stringify(e);
 for(const value of [0,-1,NaN,Infinity,1.001])assert.throws(()=>grading.apply(e,value,[]),/valor/);
 assert.throws(()=>grading.apply(e,10,Array.from({length:20},(_,i)=>i)),/pelo menos uma/);
 assert.throws(()=>grading.apply(e,10,[20]),/inválida/);assert.equal(JSON.stringify(e),original);
 assert.equal(grading.grade({...e,annulled:Array.from({length:19},(_,i)=>i)},e.results.s.answers).score,0);
});
test('changing only value preserves old recorded counts when there is no per-question snapshot',()=>{
 const e=exam();e.key[0]='B';delete e.results.s.keySnapshot;
 const changed=grading.apply(e,100,[]);assert.equal(changed.results.s.correct,16);assert.equal(changed.results.s.score,80);
 assert.equal(grading.preview(e,10,[0]).rows[0].legacyKey,true);
 delete e.results.s.answers;assert.equal(grading.apply(e,100,[]).results.s.score,80);assert.throws(()=>grading.apply(e,10,[0]),/sem respostas/);
});
test('no rounding drift after repeated rescaling and the same settings are a no-op',()=>{
 let e=exam();e=grading.apply(e,100,[19]);const original=e.results.s.score;
 for(let i=0;i<5;i++){e=grading.apply(e,4.3,[19]);e=grading.apply(e,100,[19])}
 assert.equal(e.results.s.score,original);assert.equal(grading.apply(e,100,[19]),e);
});
test('annulled questions do not require key entries; restored questions do',()=>{
 const e=exam();delete e.key[0];e.annulled=[0];assert.equal(grading.keyReady(e),true);e.annulled=[];assert.equal(grading.keyReady(e),false);
});
test('amended exam and result snapshots survive Drive revision round trip without dropping responses or history',()=>{
 const e=exam(),initial={classes:[{id:'c',name:'Turma',students:[{id:'s',name:'Teste'},{id:'pending',name:'Pendente'}]}],exams:[e]},a=new Store();a.capture(initial);const b=new Store();b.ingest(a.outbox());a.ack(a.outbox().map(x=>x.id));
 const next={...initial,exams:[grading.apply(e,100,[19],'amended')]};a.capture(next);b.ingest(a.outbox());
 const synced=b.view().db.exams[0];assert.equal(synced.points,100);assert.equal(synced.results.s.score,16/19*100);assert.deepEqual(synced.results.s.answers,e.results.s.answers);assert.equal(synced.results.s.gradingHistory.length,1);assert.equal(synced.results.pending,undefined);assert.equal(b.view().conflicts.length,0);
});
