const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('local-sw.js','utf8').replaceAll('__RELEASE_ID__','test-release');
const origin='https://192.168.0.20:8765';
const assets=['/',...['grading.js','drive-store.js','local-model.js','local-sync.js','manifest.webmanifest','icon-192.png','icon-512.png'].map(n=>'/r/test-release/'+n)];
const tick=()=>new Promise(r=>setImmediate(r));
function setup({cached=true,failInstall=false,network=()=>new Promise(()=>{})}={}){
 const handlers={},saved=new Map(cached?assets.map(p=>[p,new Response('installed '+p)]):[]),timers=[];let fetches=0,activated=0;
 const cache={match:async p=>saved.get(p)?.clone(),put:async(p,r)=>saved.set(p,r),addAll:async paths=>{if(failInstall)throw Error('missing asset');for(const p of paths)saved.set(p,new Response('installed '+p))}};
 const self={location:{origin},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>activated++,clients:{claim:async()=>{}}};
 vm.runInNewContext(source,{self,caches:{open:async()=>cache},URL,Response,AbortController,fetch:(...args)=>{fetches++;return network(...args)},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){}});
 const request=(path,method='GET')=>{let response;handlers.fetch({request:{url:origin+path,method},respondWith:p=>response=p});return response};
 return{handlers,request,timers,saved,get fetches(){return fetches},get activated(){return activated}};
}
test('installed shell and every pinned asset open without any network attempt even when network hangs',async()=>{
 const h=setup();for(const path of assets){const r=await h.request(path);assert.equal(r.status,200);assert.equal(await r.text(),'installed '+path)}assert.equal(h.fetches,0);assert.equal(h.timers.length,0);
});
test('uncached unavailable shell has a bounded response and leaves stored content intact',async()=>{
 const h=setup({cached:false}),pending=h.request('/');await tick();assert.equal(h.fetches,1);h.timers[0]();const response=await pending;assert.equal(response.status,503);assert.match(await response.text(),/dados locais foram preservados/);assert.equal(h.saved.size,0);
});
test('private endpoints, pairing, POST and other release assets never enter the shell cache',()=>{
 const h=setup();for(const path of ['/api/state','/api/backup','/pair','/ws','/maintenance','/r/other-release/grading.js'])assert.equal(h.request(path),undefined);assert.equal(h.request('/','POST'),undefined);assert.equal(h.fetches,0);
});
test('successful cache-miss recovery stores only public asset and the next open avoids network',async()=>{
 const h=setup({cached:false,network:async()=>new Response('recovered')});assert.equal(await(await h.request('/')).text(),'recovered');assert.equal(await(await h.request('/')).text(),'recovered');assert.equal(h.fetches,1);
});
test('a partial precache cannot activate, leaving the earlier worker available',async()=>{
 const h=setup({cached:false,failInstall:true});let promise;h.handlers.install({waitUntil:p=>promise=p});await assert.rejects(promise,/missing asset/);assert.equal(h.activated,0);
 const complete=setup({cached:false});complete.handlers.install({waitUntil:p=>promise=p});await promise;assert.equal(complete.activated,1);assert.equal(complete.saved.size,assets.length);
});
