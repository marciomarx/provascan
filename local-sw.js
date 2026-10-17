/* Local release cache. Private APIs, websocket and pairing responses are never cached. */
const CACHE='provascan-lan-__RELEASE_ID__';
const PREFIX='/r/__RELEASE_ID__/';
const ASSETS=['/',...['grading.js','drive-store.js','local-model.js','local-sync.js','manifest.webmanifest','icon-192.png','icon-512.png'].map(name=>PREFIX+name)];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin||!ASSETS.includes(u.pathname))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok)event.waitUntil(caches.open(CACHE).then(cache=>cache.put(u.pathname,response.clone())));return response}).catch(async()=>await(await caches.open(CACHE)).match(u.pathname)||new Response('Abra o aplicativo conectado ao notebook ao menos uma vez.',{status:503}))) });
