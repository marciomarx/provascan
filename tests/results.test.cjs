const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function setup(){
 const exam={id:'e',classId:'c',n:20,alt:4,name:'Teste',points:10,key:Object.fromEntries(Array.from({length:20},(_,i)=>[i,'A'])),results:{}};
 const students=[{id:'s',name:'Aluno <teste>'},{id:'pending',name:'Pendente'}];
 const answers=['','C','B','C','','MULTI','C','','B','C','A','B','C','D','C','MULTI','C','B','D','C'];
 const saved={correct:1,wrong:16,blank:3,score:.5,answers:Object.fromEntries(answers.map((a,i)=>[i,a]).filter(([,a])=>a))};exam.results.s=saved;
 const s={db:{classes:[{id:'c',name:'Turma',students}],exams:[exam]},chosenStudent:'',ex:()=>exam,chosenExam:'e'};vm.createContext(s);
 vm.runInContext(html.slice(html.indexOf('function esc('),html.indexOf('function id(')),s);
 vm.runInContext(html.slice(html.indexOf('function option('),html.indexOf('function ensure(')),s);
 vm.runInContext(html.slice(html.indexOf('function picker('),html.indexOf('function makeSvg(')),s);
 vm.runInContext(html.slice(html.indexOf('function correction('),html.indexOf('function download(')),s);
 return {s,exam,saved,students};
}
test('legacy 1 correct + 16 errors + 3 blank separates the two multiple marks without changing the score',()=>{
 const {s,exam,saved}=setup(),b=s.resultBreakdown(exam,saved);
 assert.equal(b.correct,1);assert.equal(b.wrong,14);assert.equal(b.multiple,2);assert.equal(b.blank,3);
 assert.equal(b.correct+b.wrong+b.multiple+b.blank,20);assert.equal(saved.score,.5);assert.equal(saved.wrong,16);
});
test('saved correction rows identify blank and multiple questions and use stored snapshot keys',()=>{
 const {s,exam,saved}=setup();saved.keySnapshot={...exam.key};saved.questionCount=20;saved.markedAlternatives={5:['B','D'],15:['A','B']};exam.key[10]='C';
 const rows=s.resultQuestionRows(exam,saved);
 assert.equal(rows.length,20);assert.equal(rows[0].status,'Em branco — zero');assert.equal(rows[5].answer,'B + D');assert.equal(rows[5].status,'Duplicidade — zero');assert.equal(rows[10].official,'A');assert.equal(rows[10].status,'Acerto');
});
test('legacy details disclose current key fallback; missing answer details are not fabricated',()=>{
 const {s,exam,saved}=setup();assert.match(s.resultDetails(exam,saved),/Registro antigo/);assert.match(s.resultDetails(exam,saved),/nota salva foi preservada/);
 delete saved.answers;const details=s.resultDetails(exam,saved);assert.match(details,/não contém respostas por questão/);assert.doesNotMatch(details,/<table/);
});
test('result cards show a visible formatted score, separate counts, escaped names, and a pending action',()=>{
 const {s,exam,saved}=setup();saved.pointsSnapshot=10;exam.points=100;
 const markup=s.results();assert.match(markup,/0,50 <small>\/ 10,00/);assert.match(markup,/Duplicidades <b>2/);assert.match(markup,/Erros <b>14/);assert.match(markup,/Ver correção/);assert.match(markup,/Aluno &lt;teste&gt;/);assert.match(markup,/data-grade-student="pending"/);assert.doesNotMatch(markup,/<td>Aluno/);
});
test('CSV exports separate nonoverlapping categories and preserves the existing grade',()=>{
 const {s,exam,students}=setup(),csv=s.resultsCsv(exam,{students});assert.equal(csv.charCodeAt(0),0xfeff);
 assert.match(csv,/"Erros \(resposta única\)";"Duplicidades"/);assert.match(csv,/"1";"14";"2";"3";"0,50"/);assert.match(csv,/"Pendente";"";"";"";"";""/);
});
test('camera appears before the collapsed manual form; official key stays separate',()=>{
 const {s}=setup(),markup=s.correction();assert(markup.indexOf('id="openExamScanner"')<markup.indexOf('<details id="manualAnswers">'));
 assert.match(markup,/Correção manual — sem câmera/);assert.doesNotMatch(markup,/<details[^>]*\bopen\b/);
 assert.equal((markup.match(/<details/g)||[]).length,(markup.match(/<\/details>/g)||[]).length);
 const key=s.keyPage();assert.match(key,/respostas corretas da avaliação/);assert.doesNotMatch(key,/manualAnswers|studentq/);
});
test('student selection persists and existing correction receives a replacement notice',()=>{
 const {s}=setup();s.chosenStudent='pending';assert.match(s.correction(),/value="pending" selected/);
 s.chosenStudent='s';assert.match(s.correction(),/já tem uma correção salva/);s.chosenStudent='unrelated';assert.match(s.correction(),/value="s" selected/);
});
