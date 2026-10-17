const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function review(answers=['A']){
 const s={reviewAnswers:[...answers],reviewConfidence:answers.map(()=> 'lida'),reviewSelections:answers.map(a=>/^[A-E]$/.test(a)?[a]:[])};
 vm.createContext(s);
 vm.runInContext(html.slice(html.indexOf('  function mapPoint('),html.indexOf(' function autoRead(')),s);
 vm.runInContext(html.slice(html.indexOf(' function reviewState('),html.indexOf(' function renderReview(')),s);
 return s;
}
test('adding a second manual alternative produces MULTI; removing it restores a single answer',()=>{
 const s=review();s.toggleReviewMark(0,'D');assert.equal(s.reviewAnswers[0],'MULTI');assert.deepEqual(Array.from(s.reviewSelections[0]),['A','D']);
 assert.equal(s.reviewState(s.reviewAnswers[0]).color,'#dc2626');
 s.toggleReviewMark(0,'D');assert.equal(s.reviewAnswers[0],'A');
 s.toggleReviewMark(0,'A');assert.equal(s.reviewAnswers[0],'');assert.equal(s.reviewState(s.reviewAnswers[0]).color,'#dc2626');
});
test('third manual mark remains MULTI, and the replacement mode clears earlier marks',()=>{
 const s=review();s.applyReviewTouch(0,'B','toggle');s.applyReviewTouch(0,'C','toggle');assert.equal(s.reviewAnswers[0],'MULTI');
 assert.equal(s.reviewSelections[0].length,3);s.applyReviewTouch(0,'D','replace');assert.equal(s.reviewAnswers[0],'D');assert.deepEqual(Array.from(s.reviewSelections[0]),['D']);
});
test('manual selection of MULTI or blank retains the zero-point warning',()=>{
 const s=review();for(const answer of ['MULTI','']){
  s.setReviewAnswer(0,answer);const markup=s.reviewQuestionHtml(answer,0,{alt:4});
  assert.match(markup,/review-question invalid/);assert.match(markup,/zero ponto/);assert.match(markup,/conferida manualmente/);
 }
 s.setReviewAnswer(0,'?');assert.equal(s.reviewState('?').color,'#eab308');assert.match(s.reviewQuestionHtml('?',0,{alt:4}),/validação bloqueada/);
});
test('question cards expose all selected letters and preserve explicit statuses',()=>{
 const s=review();s.toggleReviewMark(0,'D');const markup=s.reviewQuestionHtml('MULTI',0,{alt:4});
 assert.equal((markup.match(/type="checkbox"/g)||[]).length,4);assert.equal((markup.match(/checked/g)||[]).length,2);
 assert.match(markup,/Múltiplas marcações — zero ponto/);
});
test('photo overlays paint two selected marks red, blanks red, and doubts yellow',()=>{
 const s=review(['MULTI','','?','A']);s.reviewSelections=[['A','D'],[],[],['A']];s.reviewConfidence.fill('manual');
 const strokes=[],ctx={beginPath(){},arc(){},stroke(){strokes.push(this.strokeStyle)},fill(){}};
 const loc={svgH:208,top:[{x:33.5,y:23.5},...Array(6).fill({}),{x:859.5,y:23.5}],bottom:[{x:33.5,y:184.5},...Array(6).fill({}),{x:859.5,y:184.5}]};
 s.drawMarks(ctx,{n:4,alt:4},loc);
 assert.deepEqual(strokes,['#dc2626','#dc2626',...Array(4).fill('#dc2626'),...Array(4).fill('#eab308'),'#00bf58']);
});
