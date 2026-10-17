/* The installed public shell opens from cache; private data stays in local storage/API. */
const CACHE='provascan-lan-__RELEASE_ID__';
const PREFIX='/r/__RELEASE_ID__/';
const ASSETS=['/',...['grading.js','drive-store.js','local-model.js','local-sync.js','manifest.webmanifest','icon-192.png','icon-512.png'].map(name=>PREFIX+name)];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
async function installedAsset(request,path){
 const cache=await caches.open(CACHE),saved=await cache.match(path);
 // Never wait for an unreachable private IP when the installed shell is available.
 if(saved)return saved;
 const controller=new AbortController();let timer;
 const unavailable=()=>new Response('Conecte ao notebook e abra o aplicativo uma vez para preparar o uso offline. Seus dados locais foram preservados.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
 try{
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(unavailable())},5000)});
  const response=await Promise.race([fetch(request,{signal:controller.signal}),timeout]);
  if(response.ok)await cache.put(path,response.clone());
  return response;
 }catch{return unavailable()}finally{clearTimeout(timer)}
}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!ASSETS.includes(url.pathname))return;
 event.respondWith(installedAsset(event.request,url.pathname));
});
