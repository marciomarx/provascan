"""Complete immutable UI releases, approved switching and rollback, separate from data."""
import hashlib
import json
import re
import shutil
import time
import urllib.request
from pathlib import Path

ASSETS = ['index.html', 'grading.js', 'drive-store.js', 'local-model.js', 'local-sync.js', 'local-sw.js',
          'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'privacy.html']
BASE_URL = 'https://raw.githubusercontent.com/marciomarx/provascan/main/'

def digest(data):
    return hashlib.sha256(data).hexdigest()

class Releases:
    def __init__(self, source, data):
        self.source, self.root = Path(source), Path(data)/'releases'
        self.root.mkdir(parents=True, exist_ok=True)
        self.pointer = Path(data)/'release.json'
        self.state = json.loads(self.pointer.read_text()) if self.pointer.exists() else {}
        self.staged = None
        self.deadline = None
        if not self.state:
            self.staged = self.stage_local()
            self.activate(self.staged['id'])
            self.deadline = None
        elif self.state.get('pending'):
            # An unconfirmed release must never become the only bootable release.
            self.rollback()

    def persist(self):
        temp = self.pointer.with_suffix('.tmp')
        temp.write_text(json.dumps(self.state))
        temp.replace(self.pointer)

    def stage_local(self):
        files = {name: (self.source/name).read_bytes() for name in ASSETS}
        return self.stage(files)

    def stage(self, files):
        if set(files) != set(ASSETS):
            raise ValueError('Atualização incompleta.')
        release_id = digest(b''.join(name.encode()+files[name] for name in sorted(files)))[:20]
        target = self.root/release_id
        if not target.exists():
            temporary = self.root/(release_id+'.tmp')
            temporary.mkdir(exist_ok=True)
            for name, data in files.items():
                (temporary/name).write_bytes(data)
            temporary.rename(target)
        self.staged = {'id': release_id, 'version': '0.9.0-local', 'protocol': 1}
        return self.staged

    def check_online(self):
        def read(url):
            with urllib.request.urlopen(url, timeout=20) as response:
                data = response.read(4*1024*1024+1)
                if len(data)>4*1024*1024:
                    raise ValueError('Arquivo de atualização grande demais.')
                return data
        manifest = json.loads(read(BASE_URL+'local-release.json'))
        if manifest.get('protocol') != 1 or manifest.get('serverProtocol') != 1:
            raise ValueError('Esta versão exige atualização do servidor no Windows. A versão atual foi mantida.')
        if set(manifest.get('files', {})) != set(ASSETS):
            raise ValueError('Manifesto de atualização incompleto.')
        files = {}
        for name, expected in manifest['files'].items():
            data = read(BASE_URL+name)
            if digest(data) != expected:
                raise ValueError('Atualização inconsistente. Tente novamente após a publicação terminar.')
            files[name] = data
        return self.stage(files)

    def activate(self, release_id):
        if not self.staged or self.staged['id'] != release_id:
            raise ValueError('Confira a atualização antes de autorizar.')
        if self.state.get('active') == release_id:
            return
        self.state = {'active': release_id, 'previous': self.state.get('active'), 'pending': bool(self.state.get('active'))}
        self.persist()
        self.deadline = time.monotonic()+90 if self.state['pending'] else None

    def healthy(self, release_id):
        if release_id == self.state['active']:
            self.state['pending'] = False
            self.deadline = None
            self.persist()

    def rollback(self):
        if not self.state.get('previous'):
            raise ValueError('Não há versão anterior instalada.')
        self.state = {'active': self.state['previous'], 'previous': self.state['active'], 'pending': False}
        self.deadline = None
        self.persist()

    def asset(self, name, release_id=None):
        if name not in ASSETS:
            raise ValueError('Arquivo não permitido.')
        release_id = release_id or self.state['active']
        if not re.fullmatch(r'[a-f0-9]{20}', release_id) or not (self.root/release_id).is_dir():
            raise ValueError('Versão não encontrada.')
        data = (self.root/release_id/name).read_bytes()
        if name == 'local-sw.js':
            return data.replace(b'__RELEASE_ID__', release_id.encode())
        if name == 'manifest.webmanifest':
            manifest = json.loads(data)
            manifest.update(start_url='/', scope='/')
            for icon in manifest.get('icons', []):
                icon['src'] = '/r/' + release_id + '/' + icon['src'].removeprefix('./')
            return json.dumps(manifest).encode()
        if name == 'index.html':
            html = data.decode()
            html = re.sub(r'<script src="drive-(?:config|api|sync)\.js[^>]*></script>', '', html)
            html = re.sub(r'<script src="https://accounts.google.com/gsi/client"[^>]*></script>', '', html)
            html = re.sub(r'v\d+\.\d+\.\d+(?![\d.])', 'v0.9.0-local', html).replace("'sw.js'", "'local-sw.js'").replace("'./sw.js'", "'./local-sw.js'")
            html = html.replace('window.provascanDrive?.changed', 'window.provascanLocal?.changed')
            html = html.replace('localStorage.setItem(KEY,JSON.stringify(db));window.provascanLocal?.changed(db)', 'window.provascanLocal?.changed(db);localStorage.setItem(KEY,JSON.stringify(db))')
            html = html.replace("localStorage.setItem('provascan-v01',JSON.stringify(data));window.provascanLocal?.changed(data)", "window.provascanLocal?.changed(data);localStorage.setItem('provascan-v01',JSON.stringify(data))")
            html = html.replace('aguarde a confirmação de sincronização com o Drive', 'aguarde a confirmação do notebook')
            html = html.replace('Conecte ao seu Google Drive para sincronizar turmas, avaliações e notas entre dispositivos.', 'Conecte os aparelhos ao notebook pelo Wi-Fi para sincronizar os dados.')
            html = html.replace('</body>', '<script src="local-model.js"></script><script src="local-sync.js"></script></body>')
            html = re.sub(r'(src|href)="(grading\.js|drive-store\.js|local-model\.js|local-sync\.js|manifest\.webmanifest|icon-192\.png)([^"]*)"', lambda m: m[1]+'="/r/'+release_id+'/'+m[2]+m[3]+'"', html)
            html = html.replace('<head>', '<head><script>window.PROVASCAN_LOCAL_RELEASE='+json.dumps(release_id)+';</script>')
            return html.encode()
        return data
