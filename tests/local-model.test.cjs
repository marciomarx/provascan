const {test}=require('node:test'),assert=require('node:assert/strict');
const {Model}=require('../local-model.js');
const initial={protocol:1,serverId:'notebook-1',seq:0,versions:{},db:{classes:[],exams:[]}};
function setup(){let n=0;const m=new Model({},()=>`operation-${++n}`);m.receive(initial);m.accept(initial.db);return m}
test('persistent offline queue retains unique IDs, bases and dependency chains across reload',()=>{
 const m=setup(),db={classes:[{id:'c',name:'A',students:[]}],exams:[]};m.capture(db);db.classes[0].name='B';m.capture(db);
 const restored=new Model(JSON.parse(JSON.stringify(m.serialize())));assert.equal(restored.pending.length,2);assert.equal(restored.pending[1].changes[0].base,'operation-1');assert.equal(restored.view().classes[0].name,'B');
 restored.acknowledge('operation-1',1);assert.equal(restored.pending.length,1);assert.equal(restored.pending[0].id,'operation-2');
});
test('receiving another record merges around pending local edits and rejects wrong authorities',()=>{
 const m=setup();m.capture({classes:[{id:'c',name:'Local',students:[]}],exams:[]});
 m.receive({...initial,seq:1,versions:{'class/d':'other-op'},db:{classes:[{id:'d',name:'Remote',students:[]}],exams:[]}});
 assert.deepEqual(m.view().classes.map(c=>c.name).sort(),['Local','Remote']);assert.throws(()=>m.receive({...initial,serverId:'another-notebook'}),/Outro banco/);
});
test('result operations depend on the exact exam version used to grade and conflicts require a deliberate resolution',()=>{
 const m=setup(),db={classes:[{id:'c',name:'A',students:[{id:'s',name:'S'}]}],exams:[{id:'e',name:'E',classId:'c',n:2,alt:4,points:10,key:{0:'A',1:'B'},results:{}}]};m.capture(db);db.exams[0].results.s={answers:{0:'A'}};m.capture(db);
 assert.equal(m.pending[1].depends['exam/e'],'operation-1');
 m.conflict({type:'conflict',keys:['exam/e'],snapshot:{...initial,seq:2,db}});assert.throws(()=>m.capture(db),/resolva/);
 m.resolve(false,db);assert.equal(m.pending.length,0);assert.equal(m.blocked,null);
});
test('rebasing local pending data after explicit conflict choice retains desired values',()=>{
 const m=setup();const desired={classes:[{id:'c',name:'Mine',students:[]}],exams:[]};m.capture(desired);
 m.conflict({snapshot:{...initial,seq:2,versions:{'class/c':'remote-v2'},db:{classes:[{id:'c',name:'Theirs',students:[]}],exams:[]}}});m.resolve(true,desired);
 assert.equal(m.pending[0].changes[0].base,'remote-v2');assert.equal(m.view().classes[0].name,'Mine');
});
