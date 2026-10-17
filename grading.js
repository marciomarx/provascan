(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProvaScanGrading=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function settings(exam,points=exam.points,annulled=exam.annulled||[]){
 if(!Number.isInteger(exam.n)||exam.n<1||exam.n>30)throw Error('Quantidade de questões inválida.');
 if(typeof points!=='number'||!Number.isFinite(points)||points<0.01||!Number.isFinite(points*100)||Math.abs(points*100-Math.round(points*100))>0.00001)throw Error('Informe um valor maior que zero, com até duas casas decimais.');
 if(!Array.isArray(annulled)||annulled.some(i=>!Number.isInteger(i)||i<0||i>=exam.n))throw Error('Questão anulada inválida.');
 const selected=[...new Set(annulled)].sort((a,b)=>a-b),validCount=exam.n-selected.length;
 if(!validCount)throw Error('Mantenha pelo menos uma questão válida.');
 return{points,annulled:selected,validCount,perQuestion:points/validCount};
}
function keyReady(exam){const s=settings(exam);return Array.from({length:exam.n},(_,i)=>i).every(i=>s.annulled.includes(i)||'ABCDE'.slice(0,exam.alt).includes(exam.key?.[i])&&!!exam.key?.[i])}
function grade(exam,answers,key=exam.key){
 const s=settings(exam);let correct=0,wrong=0,blank=0;
 for(let i=0;i<exam.n;i++){
  if(s.annulled.includes(i))continue;
  const a=answers?.[i]||'';
  if(a==='?')throw Error('Resolva as dúvidas nas questões válidas antes de salvar.');
  if(!a){blank++;continue}
  if(a==='MULTI'){wrong++;continue}
  if(!'ABCDE'.slice(0,exam.alt).includes(a))throw Error('Resposta inválida na questão '+(i+1)+'.');
  if(!key?.[i]||!'ABCDE'.slice(0,exam.alt).includes(key[i]))throw Error('Preencha o gabarito da questão válida '+(i+1)+'.');
  if(a===key[i])correct++;else wrong++;
 }
 return{correct,wrong,blank,score:correct/s.validCount*s.points,pointsSnapshot:s.points,annulledSnapshot:s.annulled,questionCount:exam.n};
}
function preview(exam,points,annulled){
 const next=settings(exam,points,annulled),results={},rows=[];
 for(const [sid,r] of Object.entries(exam.results||{})){
  if((r.questionCount??exam.n)!==exam.n)throw Error('Há uma correção com quantidade de questões diferente. Revise esse registro antes de alterar a avaliação.');
  const previous=settings(exam,r.pointsSnapshot??exam.points,r.annulledSnapshot||[]);
  const changed=JSON.stringify(previous.annulled)!==JSON.stringify(next.annulled);
  let revised,legacyKey=false;
  if(changed){
   if(!r.answers)throw Error('Há uma correção antiga sem respostas por questão. Registre as respostas desse aluno antes de alterar as anulações.');
   legacyKey=!r.keySnapshot;
   revised=grade({...exam,...next},r.answers,r.keySnapshot||exam.key);
  }else{
   if(!Number.isInteger(r.correct)||r.correct<0||r.correct>next.validCount)throw Error('Quantidade de acertos inválida em uma correção salva.');
   revised={correct:r.correct,wrong:r.wrong,blank:r.blank,score:r.correct/next.validCount*next.points,pointsSnapshot:next.points,annulledSnapshot:next.annulled,questionCount:exam.n};
  }
  results[sid]={...r,...revised,...legacyKey?{keySnapshot:{...exam.key}}:{}};
  rows.push({sid,before:r.score,after:revised.score,legacyKey});
 }
 return{...next,results,rows};
}
function apply(exam,points,annulled,at=new Date().toISOString()){
 const next=preview(exam,points,annulled),previous=settings(exam);
 if(previous.points===next.points&&JSON.stringify(previous.annulled)===JSON.stringify(next.annulled))return exam;
 const results={};for(const [sid,r] of Object.entries(next.results)){
  const old=exam.results[sid];results[sid]={...r,recalculatedAt:at,gradingHistory:[...(old.gradingHistory||[]),{at,score:old.score,points:old.pointsSnapshot??exam.points,annulled:old.annulledSnapshot||[],correct:old.correct,wrong:old.wrong,blank:old.blank}]};
 }
 return{...exam,points:next.points,annulled:next.annulled,results,gradingHistory:[...(exam.gradingHistory||[]),{at,from:{points:previous.points,annulled:previous.annulled},to:{points:next.points,annulled:next.annulled},results:next.rows.length}]};
}
return{settings,keyReady,grade,preview,apply};
});
