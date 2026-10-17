const CACHE='provascan-v070';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./drive-config.js','./drive-store.js','./drive-api.js','./drive-sync.js','./privacy.html','./drive-setup.html','./DRIVE_SETUP.md'];
const urls=new Set(ASSETS.map(path=>new URL(path,self.location.href).href));
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('provascan-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);url.search='';if(url.origin!==self.location.origin||!urls.has(url.href))return;
 // Only public app assets are cached. Google authorization and private Drive responses bypass this worker.
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(url.href,copy)))}return response}).catch(async()=>await caches.match(url.href)||new Response('Aplicativo indisponível offline. Reconecte para atualizar.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}})))
});
