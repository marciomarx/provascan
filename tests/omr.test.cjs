const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const sandbox={document:{createElement:()=>createCanvas(1,1)}};
vm.createContext(sandbox);
vm.runInContext(html.slice(html.indexOf('function makeSvg('),html.indexOf('function cardPage(')),sandbox);
vm.runInContext(html.slice(html.indexOf(' function markers('),html.indexOf(' function updateZoom(')),sandbox);
const e={n:20,alt:5};
const single=Array.from({length:e.n},(_,i)=>'ABCDE'[i%e.alt]);
async function card(answers,{scale=1,paper=255,shadow=0,weak=15,offset=0,n=20,alt=5}={}){
 const exam={n,alt},rows=Math.ceil(n/2),height=136+rows*36;
 const image=await loadImage(Buffer.from(sandbox.makeSvg(exam)));
 const source=createCanvas(880,height),ctx=source.getContext('2d');ctx.drawImage(image,0,0);
 answers.forEach((answer,i)=>{for(const [j,letter] of [...'ABCDE'.slice(0,alt)].entries()){
  if(!answer.includes(letter))continue;
  const x=[35,465][i<rows?0:1]+94+j*51+offset,y=94+(i<rows?i:i-rows)*36;
  ctx.fillStyle=`rgb(${j===alt-1?weak:15},${j===alt-1?weak:15},${j===alt-1?weak:15})`;
  ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();
 }});
 const result=createCanvas(Math.round(880*scale),Math.round(height*scale));const out=result.getContext('2d');out.drawImage(source,0,0,result.width,result.height);
 const im=out.getImageData(0,0,result.width,result.height);
 for(let y=0;y<result.height;y++)for(let x=0;x<result.width;x++){
  const k=(y*result.width+x)*4,light=(paper-shadow*x/result.width)/255;
  for(let ch=0;ch<3;ch++)im.data[k+ch]*=light;
 }
 out.putImageData(im,0,0);return {canvas:result,exam};
}
function read(c){return sandbox.autoRead(c.canvas,c.exam)}
for(const alt of [4,5])for(const n of [19,20,30])for(const scale of [.65,1,2]){
 test(`single answers, ${n} questions, ${alt} choices, scale ${scale}`,async()=>{
  const answers=Array.from({length:n},(_,i)=>'ABCDE'[i%alt]);
  const r=read(await card(answers,{n,alt,scale,paper:195,shadow:50,offset:1.5}));
  assert.deepEqual(Array.from(r.answers),answers);
 });
}
for(const scale of [.65,1,2])test(`independent double/triple marks and blanks, scale ${scale}`,async()=>{
 const answers=[...single];answers[0]='AE';answers[1]='BC';answers[5]='ACE';answers[10]='';answers[19]='DE';
 const r=read(await card(answers,{scale,paper:190,shadow:55,weak:110,offset:1.5}));
 const expected=[...single];for(const i of [0,1,5,19])expected[i]='MULTI';expected[10]='';
 assert.deepEqual(Array.from(r.answers),expected);
 assert.equal(r.confidence[0],'multipla');assert.equal(r.confidence[10],'branco');assert.deepEqual(Array.from(r.selections[0]),['A','E']);
});
test('all empty outlines stay blank under a lighting gradient',async()=>{
 const r=read(await card(Array(20).fill(''),{paper:180,shadow:60}));
 assert.deepEqual(Array.from(r.answers),Array(20).fill(''));
});
test('faint second mark blocks grading instead of silently choosing the darker one',async()=>{
 const answers=[...single];answers[0]='AE';
 const r=read(await card(answers,{weak:195}));assert.equal(r.answers[0],'?');
});
test('unrecognized photograph returns only pending answers',()=>{
 const c=createCanvas(880,496);c.getContext('2d').fillRect(0,0,880,496);
 const r=read({canvas:c,exam:e});assert.deepEqual(Array.from(r.answers),Array(20).fill('?'));
});
function validation(answers,{valid=true,annulled=[]}={}){
 const exam={id:'exam',n:20,alt:5,annulled,points:10,key:Object.fromEntries(single.map((a,i)=>[i,a])),results:{}};
 const elements={validateReview:{},reviewScreen:{style:{}}};let saves=0,confirms=0;const confirmationMessages=[];
 const context={ProvaScanGrading:require('../grading.js'),el:id=>elements[id],db:{exams:[exam]},reviewExam:'exam',reviewStudent:'student',photo:{},photoValid:valid,photoLocation:valid?{}:null,reviewAnswers:answers,reviewSelections:answers.map(a=>/^[A-E]$/.test(a)?[a]:[]),
  alert:()=>{},confirm:message=>{confirms++;confirmationMessages.push(message);return true},save:()=>saves++,go:()=>{}};
 vm.createContext(context);
 vm.runInContext(html.slice(html.indexOf(" el('validateReview').onclick="),html.indexOf(' let panel=document.createElement')),context);
 elements.validateReview.onclick();return {result:exam.results.student,saves,confirms,confirmationMessages};
}
test('MULTI earns zero even if one of the two marks matches the key',()=>{
 const answers=[...single];answers[0]='MULTI';const r=validation(answers);
 assert.equal(r.saves,1);assert.equal(r.result.correct,19);assert.equal(r.result.wrong,1);assert.equal(r.result.score,9.5);assert.equal(r.result.answers[0],'MULTI');assert.equal(r.result.keySnapshot[1],single[1]);assert.equal(r.result.pointsSnapshot,10);assert.match(r.confirmationMessages[0],/ZERO: Q1 \(múltiplas marcações\)/);
});
test('pending answers and invalid geometry cannot be saved',()=>{
 const answers=[...single];answers[0]='?';assert.equal(validation(answers).saves,0);
 assert.equal(validation(single,{valid:false}).saves,0);
});
test('blank answer earns zero and remains counted separately',()=>{
 const answers=[...single];answers[0]='';const r=validation(answers);
 assert.equal(r.result.blank,1);assert.equal(r.result.correct,19);assert.equal(r.result.score,9.5);
});
test('camera validation excludes annulled doubts and uses the remaining valid questions for the grade',()=>{
 const answers=[...single];answers[0]='?';answers[1]='MULTI';
 const r=validation(answers,{annulled:[0,1]});assert.equal(r.saves,1);assert.equal(r.result.score,10);assert.equal(r.result.correct,18);assert.equal(r.result.wrong,0);assert.equal(r.result.blank,0);assert.deepEqual(Array.from(r.result.annulledSnapshot),[0,1]);assert.equal(r.result.answers[1],'MULTI');assert.doesNotMatch(r.confirmationMessages[0],/ZERO/);
});
// Optionally examine local screenshots without committing student photos to the repository.
// Colored review overlays and screenshot resizing affect these results; these are supporting evidence only.
if(process.env.PROVASCAN_CAPTURE_DIR){
 for(const [file,expected] of [['1000091174.jpg',['MULTI','B','B','C','C','D','D','B','C','D','A','A','B','C','D','B','C','D','B','C']]]){
  test(`supporting screenshot ${file}`,async()=>{
   const im=await loadImage(path.join(process.env.PROVASCAN_CAPTURE_DIR,file)),canvas=createCanvas(663,760);
   canvas.getContext('2d').drawImage(im,23,594,663,760,0,0,663,760);
   assert.deepEqual(Array.from(read({canvas,exam:{n:20,alt:4}}).answers),expected);
  });
 }
}
