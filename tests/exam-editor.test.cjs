const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const grading=require('../grading.js'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function setup(){
 const e={id:'e',name:'Prova <teste>',classId:'c',n:20,alt:5,points:10,key:Object.fromEntries(Array.from({length:20},(_,i)=>[i,'A'])),results:{}};
 const answers=Object.fromEntries(Array.from({length:20},(_,i)=>[i,i<16?'A':'B']));e.results.s={...grading.grade(e,answers),answers,keySnapshot:{...e.key}};
 let selected=[],saved='',confirmed=true;const nodes={};
 for(const id of ['examEditForm','editExamPoints','examEditPreview','saveExamGrading','cancelExamEdit'])nodes[id]={dataset:{examId:'e'},value:'10',listeners:{},addEventListener(name,fn){this.listeners[name]=fn}};
 const s={ProvaScanGrading:grading,db:{classes:[{id:'c',students:[{id:'s',name:'Aluno'},{id:'p',name:'Pendente'}]}],exams:[e]},ex:()=>s.db.exams[0],chosenExam:'e',chosenClass:'c',editingExam:'e',document:{getElementById:id=>nodes[id],querySelectorAll:q=>q==='[data-annul-question]:checked'?selected.map(i=>({dataset:{annulQuestion:String(i)}})):[]},save:()=>saved=JSON.stringify(s.db),render(){},alert(){},confirm:()=>confirmed};vm.createContext(s);
 vm.runInContext(html.slice(html.indexOf('function esc('),html.indexOf('function id(')),s);
 vm.runInContext(html.slice(html.indexOf('function option('),html.indexOf('function ensure(')),s);
 vm.runInContext(html.slice(html.indexOf('function examEditor('),html.indexOf('function makeSvg(')),s);
 vm.runInContext(html.slice(html.indexOf('function resultContext('),html.indexOf('function pointsText(')),s);
 vm.runInContext(html.slice(html.indexOf('function pointsText('),html.indexOf('function download(')),s);
 return{s,nodes,setAnnulled:value=>selected=value,setConfirmation:value=>confirmed=value,get saved(){return saved}};
}
test('editing and cancelling previews never save changes; confirmation persists revised value, all grades and snapshots',()=>{
 const h=setup(),original=JSON.stringify(h.s.db);h.s.bindExamEditor();h.nodes.editExamPoints.value='100';h.setAnnulled([19]);h.nodes.examEditForm.listeners.input();assert.equal(JSON.stringify(h.s.db),original);assert.equal(h.saved,'');assert.match(h.nodes.examEditPreview.innerHTML,/19 questão/);assert.match(h.nodes.examEditPreview.innerHTML,/84,21/);
 h.setConfirmation(false);h.nodes.examEditForm.listeners.submit({preventDefault(){}});assert.equal(h.saved,'');assert.equal(JSON.stringify(h.s.db),original);
 h.setConfirmation(true);h.nodes.examEditForm.listeners.submit({preventDefault(){}});const e=JSON.parse(h.saved).exams[0];assert.equal(e.points,100);assert.deepEqual(e.annulled,[19]);assert.equal(e.results.s.score,16/19*100);assert.equal(e.results.s.pointsSnapshot,100);assert.equal(e.results.p,undefined);assert.equal(h.s.editingExam,'');assert.equal(e.results.s.answers[19],'B');
});
test('annulling all questions disables saving and leaves the stored assessment intact',()=>{
 const h=setup(),original=JSON.stringify(h.s.db);h.s.bindExamEditor();h.setAnnulled(Array.from({length:20},(_,i)=>i));h.s.updateExamPreview();assert.equal(h.nodes.saveExamGrading.disabled,true);assert.match(h.nodes.examEditPreview.innerHTML,/pelo menos uma/);h.nodes.examEditForm.listeners.submit({preventDefault(){}});assert.equal(JSON.stringify(h.s.db),original);assert.equal(h.saved,'');
});
test('official key uses one column with every question exactly once in order, preserving answers and annulments',()=>{
 const {s}=setup();s.db.exams[0].annulled=[5];const key=s.keyPage();
 assert.equal([...key.matchAll(/class="key-list"/g)].length,1);
 assert.doesNotMatch(key,/class="key-column/);
 assert.match(html,/\.key-list\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
 assert.match(key,/Anulada/);assert.match(key,/data-answer="5"[^>]*disabled/);
 assert.match(key,/name="q5" value="A"[^>]*checked[^>]*disabled/);
 for(const count of [1,7,20,30]){
  s.db.exams[0].n=count;
  const markup=s.keyPage(),numbers=[...markup.matchAll(/<strong>(\d+)\.<\/strong>/g)].map(m=>Number(m[1]));
  assert.deepEqual(numbers,Array.from({length:count},(_,i)=>i+1));
  for(let i=0;i<count;i++)assert.equal([...markup.matchAll(new RegExp('data-answer="'+i+'"','g'))].length,5);
 }
});
test('result cards, question details and CSV agree on the rescaled grade and annulled count',()=>{
 const {s}=setup();s.db.exams[0]=grading.apply(s.db.exams[0],100,[19]);const e=s.db.exams[0],r=e.results.s;
 assert.match(s.results(),/84,21 <small>\/ 100,00/);assert.match(s.results(),/Anuladas <b>1/);assert.equal(s.resultQuestionRows(e,r)[19].status,'Anulada — fora do cálculo');
 const b=s.resultBreakdown(e,r);assert.equal(b.correct+b.wrong+b.multiple+b.blank+b.annulled,20);
 assert.match(s.resultsCsv(e,s.db.classes[0]),/"84,21";"1";"100,00"/);
});
