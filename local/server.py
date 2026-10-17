"""ProvaScan LAN: HTTPS + authenticated WebSocket + durable SQLite authority."""
import argparse
import asyncio
import contextlib
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import time
import webbrowser
from aiohttp import web, WSMsgType
from store import Database, PROTOCOL
from releases import Releases
from certificates import create

COOKIE = 'provascan_session'
PAIR_HTML = '''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Conectar ao ProvaScan</title><body style="font:18px system-ui;max-width:600px;margin:40px auto;padding:20px"><h1>Conectar ao notebook</h1><p>Digite o código exibido na janela do ProvaScan no notebook. Não informe senha do Google.</p><form><label>Código de pareamento <input id="code" autocomplete="off" required></label><button>Conectar</button></form><p id="status" role="status"></p><script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();let r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:document.getElementById('code').value.trim()})});if(r.ok)location.replace('/');else document.getElementById('status').textContent=(await r.json()).error};</script></body></html>'''

class Server:
    def __init__(self, source, directory, addresses=('127.0.0.1',), port=8765):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.db = Database(self.directory/'provascan.sqlite3')
        self.releases = Releases(source, directory)
        self.addresses, self.port = set(addresses)|{'127.0.0.1', 'localhost'}, port
        self.peers = set()
        self.pair_code, self.admin_code = secrets.token_hex(4), secrets.token_urlsafe(18)
        self.pair_until = time.monotonic()+600
        self.attempts = {}
        self.last_backup = 0
        server_id = self.db.sql.execute("SELECT value FROM meta WHERE key='server_id'").fetchone()
        self.id = server_id[0] if server_id else secrets.token_hex(16)
        with self.db.sql:
            self.db.sql.execute("INSERT OR IGNORE INTO meta VALUES ('server_id',?)", (self.id,))

    def role(self, request):
        token = request.cookies.get(COOKIE, '')
        row = self.db.sql.execute('SELECT role FROM sessions WHERE hash=?', (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        return row[0] if row else None

    def state(self):
        return {**self.db.snapshot(), 'serverId': self.id, 'release': self.releases.state['active']}

    async def broadcast(self):
        state = self.state()
        for ws in list(self.peers):
            try:
                await asyncio.wait_for(ws.send_json(state), timeout=5)
            except (ConnectionError, asyncio.TimeoutError, RuntimeError):
                self.peers.discard(ws)
                await ws.close()

    async def pair(self, request):
        remote = request.remote or ''
        now = time.monotonic()
        count, since = self.attempts.get(remote, (0, now))
        if now-since>600:
            count, since = 0, now
        self.attempts[remote] = (count+1, since)
        if count>=10:
            raise web.HTTPTooManyRequests(text='Muitas tentativas. Aguarde dez minutos.')
        code = (await request.json()).get('code', '')
        role = 'notebook' if secrets.compare_digest(str(code), self.admin_code) and ipaddress.ip_address(remote).is_loopback else 'phone' if now<self.pair_until and secrets.compare_digest(str(code), self.pair_code) else None
        if not role:
            return web.json_response({'error': 'Código inválido ou expirado. Reinicie o servidor para gerar novos códigos.'}, status=403)
        token = secrets.token_urlsafe(40)
        with self.db.sql:
            self.db.sql.execute('INSERT INTO sessions VALUES (?,?)', (hashlib.sha256(token.encode()).hexdigest(), role))
        response = web.json_response({'role': role})
        response.set_cookie(COOKIE, token, secure=True, httponly=True, samesite='Strict', max_age=31536000, path='/')
        return response

    async def websocket(self, request):
        ws = web.WebSocketResponse(heartbeat=15, max_msg_size=2*1024*1024)
        await ws.prepare(request)
        self.peers.add(ws)
        await ws.send_json(self.state())
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    op = {}
                    try:
                        op = json.loads(msg.data)
                        if op.get('type') == 'hello':
                            if op.get('protocol') != PROTOCOL:
                                await ws.send_json({'type':'error','error':'Versão incompatível. Atualize o aplicativo autorizado pelo notebook.'})
                                await ws.close()
                            else:
                                await ws.send_json(self.state())
                            continue
                        if op.get('serverId') != self.id:
                            raise ValueError('Este dispositivo está vinculado a outro banco. Preserve o backup antes de trocar de notebook.')
                        # Regular backups preserve prior state without copying an open SQLite file.
                        if time.monotonic()-self.last_backup>300:
                            backup = self.directory/'backups'
                            backup.mkdir(exist_ok=True)
                            self.db.backup(backup/(time.strftime('%Y%m%d-%H%M%S')+'.sqlite3'))
                            self.last_backup = time.monotonic()
                        result = self.db.apply(op)
                        if result['type'] == 'conflict':
                            result['snapshot'] = self.state()
                        await ws.send_json(result)
                        if result['type'] == 'ack':
                            await self.broadcast()
                    except (ValueError, TypeError, KeyError) as exc:
                        await ws.send_json({'type':'error','id':op.get('id') if isinstance(op,dict) else None,'error':str(exc),'snapshot':self.state()})
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            self.peers.discard(ws)
        return ws

    async def api(self, request):
        action = request.match_info['action']
        role = self.role(request)
        if action == 'state' and request.method == 'GET':
            return web.json_response({**self.state(), 'role':role})
        if action == 'healthy' and request.method == 'POST':
            self.releases.healthy((await request.json()).get('release'))
            return web.json_response({'ok': True})
        if action == 'backup' and request.method == 'GET':
            return web.json_response(self.state()['db'], headers={'Content-Disposition':'attachment; filename="ProvaScan_backup.json"'})
        if action == 'logout' and request.method == 'POST':
            with self.db.sql:
                self.db.sql.execute('DELETE FROM sessions WHERE hash=?', (hashlib.sha256(request.cookies[COOKIE].encode()).hexdigest(),))
            response = web.json_response({'ok':True})
            response.del_cookie(COOKIE)
            return response
        if role != 'notebook':
            raise web.HTTPForbidden(text='Somente o notebook pode autorizar atualizações.')
        if action == 'check-update' and request.method == 'POST':
            staged = await asyncio.to_thread(self.releases.check_online)
            return web.json_response(staged)
        if action == 'activate-update' and request.method == 'POST':
            self.releases.activate((await request.json())['id'])
            await self.broadcast()
            return web.json_response({'ok': True})
        if action == 'rollback' and request.method == 'POST':
            self.releases.rollback()
            await self.broadcast()
            return web.json_response({'ok': True})
        raise web.HTTPNotFound()

    async def asset(self, request):
        name = request.match_info.get('name') or 'index.html'
        if name == 'pair':
            return web.Response(text=PAIR_HTML, content_type='text/html')
        try:
            data = self.releases.asset(name, request.match_info.get('release'))
        except ValueError:
            raise web.HTTPNotFound()
        import mimetypes
        mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        return web.Response(body=data, headers={'Content-Type':mime, 'Cache-Control':'no-cache', 'Service-Worker-Allowed':'/'})

    async def maintenance(self, request):
        if self.role(request) != 'notebook':
            raise web.HTTPForbidden()
        return web.Response(text='''<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Recuperação ProvaScan</title><h1>Recuperação do aplicativo</h1><p>Voltar a versão do aplicativo preserva o banco de dados.</p><button id="rollback">Voltar à versão anterior</button><a href="/api/backup">Baixar backup dos dados</a><script>document.getElementById('rollback').onclick=async()=>{if(confirm('Voltar à versão anterior?')){let r=await fetch('/api/rollback',{method:'POST'});if(r.ok)location.href='/';else alert(await r.text())}}</script></html>''', content_type='text/html')

    def application(self, secure=True):
        @web.middleware
        async def guard(request, handler):
            try:
                if secure:
                    address = ipaddress.ip_address(request.remote)
                    if not (address.is_private or address.is_loopback):
                        raise web.HTTPForbidden(text='Somente rede local.')
                    if request.host.split(':')[0] not in self.addresses:
                        raise web.HTTPForbidden(text='Endereço do notebook não autorizado.')
                    if not request.secure:
                        raise web.HTTPForbidden(text='Use HTTPS.')
                origin = request.headers.get('Origin')
                if (request.method not in ('GET','HEAD') or request.path == '/ws') and origin != f'{request.scheme}://{request.host}':
                    raise web.HTTPForbidden(text='Origem não autorizada.')
                if (request.path.startswith('/api/') and request.path != '/api/pair' or request.path == '/ws') and not self.role(request):
                    raise web.HTTPUnauthorized(text='Pareie este aparelho primeiro.')
                response = await handler(request)
            except web.HTTPException as exc:
                response = web.json_response({'error':exc.text}, status=exc.status)
            except (ValueError, KeyError, json.JSONDecodeError) as exc:
                response = web.json_response({'error':str(exc)}, status=400)
            response.headers['X-Content-Type-Options'] = 'nosniff'
            response.headers['Referrer-Policy'] = 'no-referrer'
            response.headers['X-Frame-Options'] = 'DENY'
            if request.path.startswith('/api/'):
                response.headers['Cache-Control'] = 'no-store'
            return response
        app = web.Application(middlewares=[guard], client_max_size=2*1024*1024)
        app.router.add_post('/api/pair', self.pair)
        app.router.add_route('*', '/api/{action}', self.api)
        app.router.add_get('/ws', self.websocket)
        app.router.add_get('/maintenance', self.maintenance)
        app.router.add_get('/', self.asset)
        app.router.add_get('/r/{release}/{name}', self.asset)
        app.router.add_get('/{name}', self.asset)
        async def monitor(app):
            async def run():
                while True:
                    await asyncio.sleep(5)
                    if self.releases.deadline and time.monotonic()>self.releases.deadline:
                        self.releases.rollback()
                        await self.broadcast()
            task = asyncio.create_task(run())
            yield
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            for ws in list(self.peers):
                await ws.close(code=1001)
            self.db.sql.close()
        app.cleanup_ctx.append(monitor)
        return app

def addresses():
    result = set()
    for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
        value = info[4][0]
        if ipaddress.ip_address(value).is_private and not value.startswith('127.'):
            result.add(value)
    return sorted(result)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', default=str(Path(os.getenv('LOCALAPPDATA', str(Path.home())))/'ProvaScan'))
    parser.add_argument('--ip', action='append', default=[])
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--cert-only', action='store_true')
    args = parser.parse_args()
    ips = sorted(set(args.ip or addresses()))
    folder = Path(args.data)
    fingerprint = create(folder/'certificates', ips)
    print('\nCertificado público:', folder/'certificates'/'ProvaScan-CA.crt')
    print('Impressão digital SHA-256:', fingerprint)
    if args.cert_only:
        raise SystemExit(0)
    server = Server(Path(__file__).resolve().parent.parent, folder, ips, args.port)
    print('\nNOTEBOOK: https://localhost:'+str(args.port))
    print('Código exclusivo do NOTEBOOK:', server.admin_code)
    for ip in ips:
        print('CELULAR (mesmo Wi-Fi): https://'+ip+':'+str(args.port))
    print('Código do CELULAR (válido por 10 minutos):', server.pair_code)
    print('Não feche esta janela enquanto estiver usando o ProvaScan. Ctrl+C encerra.\n')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(folder/'certificates'/'server.pem', folder/'certificates'/'server-key.pem')
    webbrowser.open('https://localhost:'+str(args.port))
    web.run_app(server.application(), host='0.0.0.0', port=args.port, ssl_context=context, access_log=None)
