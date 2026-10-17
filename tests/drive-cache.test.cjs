const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('Drive scripts use the visible release version to bypass stale browser assets',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const version=html.match(/Protótipo pessoal · v([\d.]+)/)[1];
 for(const name of ['drive-config','drive-store','drive-api','drive-sync'])assert(html.includes(`src="${name}.js?v=${version}"`));
});
test('service worker never intercepts Google authorization or private Drive data',()=>{const events={},self={location:new URL('https://marciomarx.github.io/provascan/sw.js'),addEventListener:(name,fn)=>events[name]=fn,skipWaiting(){},clients:{claim(){}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),{self,URL,Response});for(const url of ['https://www.googleapis.com/drive/v3/files/private?alt=media','https://accounts.google.com/gsi/client','https://marciomarx.github.io/another-app/data.json']){let intercepted=false;events.fetch({request:{url,method:'GET'},respondWith(){intercepted=true}});assert.equal(intercepted,false)}});
