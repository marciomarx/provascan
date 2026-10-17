const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),grading=require('../grading.js');
function setup(){
 const classes=[{id:'c',name:'Saúde',students:[{id:'s',name:'Ana'},{id:'t',name:'Beto'}]}];
 const make=id=>({id,name:id,classId:'c',n:2,alt:4,points:10,key:{0:'A',1:'B'},results:{s:{...grading.grade({n:2,alt:4,points:10,key:{0:'A',1:'B'}},{0:'A',1:'D'}),answers:{0:'A',1:'D'}},t:{score:3}}});
 const nodes={validateReview:{},reviewScreen:{style:{display:'block'}},closeReview:{}},saved=[],prompts=[],messages=[],routes=[];
 const ctx={db:{classes,exams:[make('first'),make('second')]},chosenExam:'first',chosenClass:'c',chosenStudent:'s',classContext:'c',ProvaScanGrading:grading,confirmed:true,failSave:false,render(){},save(){if(ctx.failSave)throw Error('Falha de armazenamento');saved.push(JSON.stringify(ctx.db))},confirm:m=>{prompts.push(m);return ctx.confirmed},alert:m=>messages.push(m),go:p=>routes.push(p),window:{openMobileScanner(){ctx.scanned=true}},el:id=>nodes[id],photo:{},photoValid:true,photoLocation:{},reviewExam:'first',reviewStudent:'s',reviewAnswers:['A','B'],reviewSelections:[['A'],['B']]};
 ctx.ex=()=>ctx.db.exams.find(e=>e.id===ctx.chosenExam);ctx.picker=()=>'';vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function esc('),html.indexOf('function id(')),ctx);vm.runInContext(html.slice(html.indexOf('function correction('),html.indexOf('function download(')),ctx);
 vm.runInContext(html.slice(html.indexOf(" el('validateReview').onclick="),html.indexOf("\n let panel=document.createElement",html.indexOf(" el('validateReview').onclick="))),ctx);
 vm.runInContext(html.match(/el\('closeReview'\)\.onclick=.*?;/)[0],ctx);
 return{ctx,nodes,saved,prompts,messages,routes};
}
test('delete requires confirmation and affects only one student in one assessment, returning pending',()=>{
 const h=setup(),before=JSON.stringify(h.ctx.db);h.ctx.confirmed=false;h.ctx.deleteCorrection('first','s');assert.equal(JSON.stringify(h.ctx.db),before);assert.equal(h.saved.length,0);
 h.ctx.confirmed=true;h.ctx.deleteCorrection('first','s');assert.equal(h.ctx.db.exams[0].results.s,undefined);assert.equal(h.ctx.db.exams[0].results.t.score,3);assert.equal(h.ctx.db.exams[1].results.s.score,5);assert.match(h.prompts[0],/Turma: Saúde\nProva: first\nAluno: Ana/);assert.match(h.ctx.results.call({...h.ctx}),/Pendente/);
});
test('storage failure restores the deleted result and an unknown target makes no write',()=>{
 const h=setup(),before=JSON.stringify(h.ctx.db);h.ctx.failSave=true;h.ctx.deleteCorrection('first','s');assert.equal(JSON.stringify(h.ctx.db),before);h.ctx.deleteCorrection('missing','s');assert.equal(h.saved.length,0);assert.match(h.messages[0],/Não foi possível excluir/);
});
test('rescan chooses exact exam and student without touching grades; close/cancel preserve the previous grade',()=>{
 const h=setup(),before=JSON.stringify(h.ctx.db);h.ctx.rescanCorrection('second','s');assert.equal(h.ctx.chosenExam,'second');assert.equal(h.ctx.chosenStudent,'s');assert.equal(h.ctx.scanned,true);assert.equal(h.routes[0],'correcao');assert.equal(JSON.stringify(h.ctx.db),before);
 h.nodes.closeReview.onclick();assert.equal(JSON.stringify(h.ctx.db),before);h.ctx.confirmed=false;h.nodes.validateReview.onclick();assert.equal(JSON.stringify(h.ctx.db),before);assert.equal(h.saved.length,0);
});
test('saving confirmed review replaces only the reviewed target and confirmation names the exam and student',()=>{
 const h=setup();h.ctx.chosenExam='second';h.nodes.validateReview.onclick();assert.equal(h.ctx.db.exams[0].results.s.score,10);assert.equal(h.ctx.db.exams[1].results.s.score,5);assert.equal(h.ctx.db.exams[0].results.t.score,3);assert.equal(h.ctx.chosenExam,'first');assert.match(h.prompts[0],/Prova: first\nAluno: Ana/);assert.match(h.prompts[0],/substituir a nota anterior somente nesta prova/);assert.equal(h.saved.length,1);assert.equal(h.nodes.reviewScreen.style.display,'none');
});
test('invalid readings, unresolved doubts and storage failure leave the old score and review intact',()=>{
 for(const mode of ['invalid','doubt','storage']){const h=setup(),before=JSON.stringify(h.ctx.db);if(mode==='invalid')h.ctx.photoValid=false;if(mode==='doubt')h.ctx.reviewAnswers=['?','B'];if(mode==='storage')h.ctx.failSave=true;h.nodes.validateReview.onclick();assert.equal(JSON.stringify(h.ctx.db),before);assert.equal(h.nodes.reviewScreen.style.display,'block');assert.equal(h.saved.length,0)}
 assert.match(html,/>✓ Salvar correção<\/button>/);
});
