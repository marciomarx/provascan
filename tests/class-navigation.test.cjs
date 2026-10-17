const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(){
 const data={classes:[{id:'a',name:'Saúde <A>',term:'2026/2',students:[{id:'s',name:'Aluno A'}]},{id:'b',name:'Turma B',students:[{id:'t',name:'Aluno B'}]},{id:'empty',name:'Sem provas',students:[]}],exams:[{id:'ea',classId:'a',name:'Prova A',n:2,alt:4,points:10,key:{0:'A',1:'B'},results:{s:{score:10}}},{id:'eb',classId:'b',name:'Prova B',n:2,alt:4,points:10,key:{},results:{t:{score:5}}}]};
 const nodes={main:{innerHTML:''},nav:{innerHTML:''}},selectors={},saved=[];
 const document={getElementById:id=>nodes[id]||null,querySelectorAll:q=>selectors[q]||[]};
 const context={document,localStorage:{getItem:()=>JSON.stringify(data),setItem:(k,v)=>saved.push(v)},window:{},navigator:{},location:{protocol:'file:'},ProvaScanGrading:require('../grading.js'),confirm:()=>true,alert(){},console};vm.createContext(context);
 const script=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m=>!m[1].includes('src='))[2];vm.runInContext(script,context);
 return{context,nodes,selectors,saved,run:code=>vm.runInContext(code,context)};
}
test('class dashboard and every exam selector stay within the selected class, including a class with no exams',()=>{
 const h=setup();h.run("openClass('a')");assert.match(h.nodes.main.innerHTML,/Saúde &lt;A&gt;/);assert.match(h.nodes.main.innerHTML,/Prova A/);assert.doesNotMatch(h.nodes.main.innerHTML,/Prova B/);
 for(const p of ['alunos','avaliacoes','gabarito','cartao','correcao','resultados']){h.run(`go('${p}')`);assert.match(h.nodes.main.innerHTML,/data-go="inicio"/);assert.match(h.nodes.main.innerHTML,/data-go="turma"/);assert.doesNotMatch(h.nodes.main.innerHTML,/Prova B|Aluno B|value="b"/)}
 h.run("openClass('empty');go('gabarito')");assert.equal(h.run('chosenExam'),'');assert.match(h.nodes.main.innerHTML,/Crie uma avaliação primeiro/);assert.doesNotMatch(h.nodes.main.innerHTML,/Prova A|Prova B/);
 h.run("go('inicio');go('avaliacoes')");assert.match(h.nodes.main.innerHTML,/Prova A/);assert.match(h.nodes.main.innerHTML,/Prova B/);assert.equal(h.saved.length,0);
});
test('dashboard action opens the exact assessment and the creation form is restricted to that class',()=>{
 const h=setup(),button={dataset:{classExam:'eb',target:'resultados'}};h.selectors['[data-class-exam]']=[button];h.run("openClass('b')");button.onclick();assert.equal(h.run('chosenExam'),'eb');assert.match(h.nodes.main.innerHTML,/Aluno B/);assert.doesNotMatch(h.nodes.main.innerHTML,/Aluno A/);
 h.run("go('avaliacoes')");assert.match(h.nodes.main.innerHTML,/<option value="b" selected/);assert.doesNotMatch(h.nodes.main.innerHTML,/<option value="a"/);
 h.run("db.classes=db.classes.filter(c=>c.id!=='b');db.exams=db.exams.filter(e=>e.classId!=='b');render()");assert.equal(h.run('classContext'),'');assert.equal(h.saved.length,0);
});
test('removing a student removes only linked class results, leaving other classes intact',()=>{
 const h=setup(),button={dataset:{removeStudent:'s'}};h.selectors['[data-remove-student]']=[button];h.run("openClass('a');go('alunos')");button.onclick();const data=JSON.parse(h.saved.at(-1));assert.deepEqual(data.classes[0].students,[]);assert.deepEqual(data.exams[0].results,{});assert.equal(data.classes[1].students[0].id,'t');assert.equal(data.exams[1].results.t.score,5);
});
