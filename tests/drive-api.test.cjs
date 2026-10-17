const {test}=require('node:test'),assert=require('node:assert/strict');
const {DriveApi}=require('../drive-api.js');
test('default transport calls browser fetch with its global receiver',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');
 const context=vm.createContext({AbortController,setTimeout,clearTimeout});
 vm.runInContext(`'use strict';globalThis.fetch=async function(url,options){
  if(this!==globalThis)throw new TypeError('Illegal invocation');
  globalThis.observed={url,authorization:options.headers.Authorization};
  return {ok:true,status:200,json:async()=>({user:{permissionId:'browser-account'}})};
 };`,context);
 vm.runInContext(fs.readFileSync(require.resolve('../drive-api.js'),'utf8'),context);
 assert.equal(await vm.runInContext("new ProvaScanDriveApi.DriveApi({token:'test-token'}).account().then(user=>user.permissionId)",context),'browser-account');
 assert.equal(context.observed.authorization,'Bearer test-token');
 assert.match(context.observed.url,/drive\/v3\/about/);
});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('authorization is carried in a header, never in the URL',async()=>{let request;const api=new DriveApi({token:'private-test-token',fetcher:async(url,opts)=>{request={url,opts};return response({user:{permissionId:'account-a',emailAddress:'a@example.test'}})}});assert.equal((await api.account()).permissionId,'account-a');assert.equal(request.opts.headers.Authorization,'Bearer private-test-token');assert(!request.url.includes('private-test-token'))});
test('expired authorization requests reconnection instead of reporting sync success',async()=>{const api=new DriveApi({token:'t',fetcher:async()=>response({},401)});await assert.rejects(api.batches(),e=>e.code==='AUTH')});
test('file listing follows all pages',async()=>{const urls=[],api=new DriveApi({token:'t',fetcher:async url=>{urls.push(url);return urls.length===1?response({files:[{id:'a'}],nextPageToken:'next'}):response({files:[{id:'b'}]})}});assert.deepEqual(await api.list('trashed=false'),[{id:'a'},{id:'b'}]);assert.match(urls[1],/pageToken=next/)});
test('batch uploads are new immutable files containing the original revision IDs',async()=>{let request;const api=new DriveApi({token:'t',fetcher:async(url,opts)=>{request={url,opts};return response({id:'new-file'})}}),events=[{id:'revision-1',key:'class/c',parents:[],at:'now',value:{id:'c',name:'A'}}];await api.uploadBatch('folder','batch-1',events);assert.equal(request.opts.method,'POST');assert.match(request.url,/uploadType=multipart/);assert.match(request.opts.body,/revision-1/);assert.match(request.opts.body,/"parents":\["folder"\]/);assert.match(request.opts.body,/"schema":1/)});
test('an unknown file format is rejected',async()=>{const api=new DriveApi({token:'t',fetcher:async()=>response({classes:[]})});await assert.rejects(api.readBatch('bad'),/Arquivo desconhecido/)});
