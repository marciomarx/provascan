/* Notebook authority; all private traffic stays on this same HTTPS origin. */
(function(){
'use strict';
const app=window.provascanApp,{Model}=window.ProvaScanLocalModel,KEY='provascan-lan-v1',esc=app.escape;
let model,ws,connected=false,connecting=false,ready=false,owner=false,inflight=null,lastRelease=window.PROVASCAN_LOCAL_RELEASE||null,nextSnapshot=null,fault='',retry=500,reloadPending=false,role='phone',staged=null,offlinePrepared=false;
try{model=new Model(JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(error){alert('Não foi possível abrir a fila local. Exporte um backup antes de continuar.');return}
ready=!!model.snapshot;
const serverAddress=location.origin;
const panel=document.createElement('section');panel.className='drive-panel';panel.setAttribute('aria-label','Conexão Wi-Fi com notebook');document.querySelector('.shell').before(panel);
function persist(){localStorage.setItem(KEY,JSON.stringify(model.serialize()))}
function lock(){const locked=!owner||!ready||!!model.blocked;document.querySelector('.shell').inert=locked;document.getElementById('mobileRestore').disabled=locked;document.getElementById('mobileCamLaunch').disabled=locked}
function paint(){
 let state=!connected?(ready?(model.pending.length?'Pendente de sincronização':'Offline'):'Desconectado'):!ready?'Conectado':model.pending.length||inflight||model.ackSeq>(model.snapshot?.seq||0)?'Sincronizando':'Sincronizado';
 document.getElementById('status').textContent=state;
 panel.innerHTML=`<strong>ProvaScan pelo Wi-Fi · ${esc(state)}</strong><p role="status" aria-live="polite">${esc(fault||(model.blocked?'Uma alteração precisa de conferência. Nenhum dado foi descartado.':!owner?'Esta aba está em modo de espera. Use uma única aba para editar.':!ready?'Conectando ao notebook…':!connected?`Você pode continuar trabalhando neste aparelho. ${model.pending.length?model.pending.length+' operação(ões) salva(s) aguardando sincronização.':'Os dados já carregados estão disponíveis.'} A conexão com o notebook será tentada automaticamente.`:model.pending.length?`${model.pending.length} operação(ões) aguardando confirmação do notebook.`:'Dados confirmados pelo notebook.'))}</p>${model.blocked?`<div class="drive-conflicts"><p>Registros: ${esc((model.blocked.keys||[]).join(', ')||model.blocked.error||'alterações pendentes')}.</p><p>Escolha o que fazer com TODAS as alterações locais pendentes. Uma cópia de segurança será preservada.</p><button class="btn" id="keepNotebook">Usar dados do notebook</button><button class="btn secondary" id="keepLocal">Reenviar alterações locais após conferir</button></div>`:''}<p class="hint">Servidor configurado neste aparelho: <strong>${esc(serverAddress)}</strong>. Se mudou de rede, o endereço IP do notebook pode ter mudado. Nesse caso, reinicie o servidor no notebook e abra o novo endereço HTTPS no celular. A fila offline pertence a este endereço; não limpe os dados.</p><div class="drive-actions">${!connected?'<button class="btn secondary" id="lanRetry">Tentar reconectar</button>':''}<button class="btn secondary" id="lanLogout">Desconectar este aparelho</button><button class="btn secondary" id="lanBackup">Exportar backup deste aparelho</button><a class="btn secondary" href="/api/backup">Backup confirmado no notebook</a>${role==='notebook'?'<button class="btn secondary" id="checkUpdate">Procurar atualização</button><a class="btn secondary" href="/maintenance">Recuperação de versão</a>':''}${staged&&staged.id!==lastRelease?'<button class="btn" id="approveUpdate">Autorizar atualização nos aparelhos</button>':''}</div><p class="hint">${ready&&offlinePrepared?'Cópia do aplicativo pronta para uso offline. ':''}O aplicativo instalado pode ser usado sem acesso ao notebook após a primeira conexão e preparação offline. Para sincronizar, ligue o notebook e conecte os aparelhos à mesma rede; ao retornar ao app, ele reconecta. Nenhum serviço do Google é usado nesta versão.</p>`;
 panel.querySelector('#lanRetry')?.addEventListener('click',()=>{retry=500;fault='Tentando reconectar ao notebook…';paint();if(ws&&ws.readyState!==WebSocket.CLOSED){ws.close();}else if(!connecting){connect()}});
 panel.querySelector('#lanLogout').onclick=async()=>{if(model.pending.length||model.blocked)return alert('Sincronize ou resolva as alterações pendentes antes de desconectar.');try{await api('logout',{});location.href='/pair'}catch(e){fault=e.message;paint()}};
 panel.querySelector('#lanBackup').onclick=()=>backup(app.getData(),'ProvaScan_backup_local.json');
 for(const [id,keep] of [['keepNotebook',false],['keepLocal',true]])panel.querySelector('#'+id)?.addEventListener('click',()=>{if(!connected)return alert('Reconecte ao notebook para conferir a versão atual.');if(!confirm(keep?'Reenviar todas as alterações locais pendentes sobre a versão atual do notebook?':'Usar os dados do notebook e retirar todas as alterações locais da fila?'))return;backup({data:app.getData(),queue:model.serialize()},'ProvaScan_conflito_backup.json');localStorage.setItem('provascan-lan-before-resolution-'+Date.now(),JSON.stringify({data:app.getData(),queue:model.serialize()}));const data=model.resolve(keep,app.getData());model.accept(data);persist();app.replaceData(data);fault='';paint();send()});
 panel.querySelector('#checkUpdate')?.addEventListener('click',async()=>{try{fault='Conferindo arquivos da atualização…';paint();staged=await api('check-update',{});fault=staged.id===lastRelease?'O aplicativo já está atualizado.':'Atualização preparada. A aplicação depende da sua autorização.';paint()}catch(e){fault=e.message;paint()}});
 panel.querySelector('#approveUpdate')?.addEventListener('click',async()=>{if(model.pending.length||app.reviewOpen())return alert('Conclua as alterações e aguarde a sincronização antes de atualizar.');if(!confirm('Autorizar esta versão nos aparelhos? Cada aparelho aguardará terminar sua edição e sincronizar antes de recarregar. A versão anterior será preservada.'))return;try{await api('activate-update',{id:staged.id})}catch(e){fault=e.message;paint()}});
 lock();
}
function backup(data,name){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function api(action,data){
 const controller=new AbortController();
 // Only connection probes have a short deadline; downloading approved releases may take longer.
 const timer=['state','healthy'].includes(action)?setTimeout(()=>controller.abort(),8000):null;
 try{const response=await fetch('/api/'+action,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined,cache:'no-store',signal:controller.signal});if(response.status===401){location.href='/pair';throw Error('Pareamento necessário.')}const body=await response.json();if(!response.ok)throw Error(body.error||'Não foi possível acessar o notebook.');return body}finally{if(timer!==null)clearTimeout(timer)}
}
function apply(){if(!nextSnapshot||app.reviewOpen())return;model.receive(nextSnapshot);nextSnapshot=null;const view=model.view();model.accept(view);persist();app.replaceData(view);ready=true;paint();maybeReload()}
function send(){if(!connected||inflight||model.blocked||!model.pending.length)return;inflight=model.pending[0].id;ws.send(JSON.stringify(model.pending[0]));paint()}
function maybeReload(){if(!reloadPending||model.pending.length||inflight||model.blocked||app.reviewOpen())return;reloadPending=false;navigator.serviceWorker?.getRegistration().then(reg=>reg?.unregister()).finally(()=>location.reload())||location.reload()}
async function connect(){
 if(!owner||connected||connecting)return;
 connecting=true;
 try{const state=await api('state');role=state.role;nextSnapshot=state;apply();if(lastRelease&&lastRelease!==state.release)reloadPending=true;lastRelease=lastRelease||state.release;
 ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws');const socket=ws,handshake=setTimeout(()=>socket.close(),8000);
 ws.onopen=()=>{if(ws!==socket)return;clearTimeout(handshake);connecting=false;connected=true;retry=500;fault='';ws.send(JSON.stringify({type:'hello',protocol:1}));paint()};
 ws.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.type==='snapshot'){nextSnapshot=message;if(lastRelease!==message.release)reloadPending=true;apply();send()}else if(message.type==='ack'){model.acknowledge(message.id,message.seq);inflight=null;persist();paint();send()}else if(message.type==='conflict'||message.type==='error'){inflight=null;model.conflict(message);persist();fault=message.error||'';paint()}}catch(e){fault=e.message;connected=false;ws.close();paint()}};
 ws.onclose=()=>{if(ws!==socket)return;clearTimeout(handshake);connecting=false;connected=false;inflight=null;paint();setTimeout(connect,retry);retry=Math.min(retry*2,10000)};
 ws.onerror=()=>ws.close();
 }catch(e){connecting=false;fault=ready?'':(e.name==='AbortError'?'O notebook não respondeu. A conexão será tentada novamente.':e.message);connected=false;paint();setTimeout(connect,retry);retry=Math.min(retry*2,10000)}
}
window.provascanLocal={changed(data){try{if(!owner||!ready)throw Error('Use a aba principal conectada ao notebook.');model.capture(data);persist();paint();send()}catch(e){fault=e.message;paint();alert(e.message);throw e}}};
// A lifetime Web Lock prevents two tabs from overwriting the same persistent queue.
if(!navigator.locks){fault='Este navegador precisa de suporte a Web Locks. Use Chrome ou Edge atualizado.';paint();return}
navigator.locks.request('provascan-lan-owner',{ifAvailable:true},async acquired=>{if(!acquired){paint();return}owner=true;if(model.snapshot){const recovered=model.view();model.accept(recovered);persist();app.replaceData(recovered)}paint();await connect();await new Promise(()=>{})});
window.addEventListener('online',()=>{if(owner&&!connected)connect()});
window.addEventListener('focus',()=>{if(owner&&!connected)connect()});
document.addEventListener('visibilitychange',()=>{if(owner&&!document.hidden&&!connected)connect()});
window.addEventListener('pageshow',()=>{if(owner&&!connected)connect()});
setInterval(()=>{if(!owner)return;try{apply();maybeReload();if(ready&&connected&&lastRelease&&!model.blocked&&document.querySelector('#main')?.children.length)api('healthy',{release:lastRelease}).catch(()=>{})}catch(e){fault=e.message;paint()}},2000);
navigator.serviceWorker?.ready?.then(()=>{offlinePrepared=true;paint()}).catch(()=>{});
paint();
})();
