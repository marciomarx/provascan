"""Windows user-login startup and idempotent, console-free ProvaScan launcher."""
import argparse
import contextlib
import os
from pathlib import Path
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.getenv('LOCALAPPDATA', str(Path.home()))) / 'ProvaScan'
URL = 'https://localhost:8765'


def vbs_quote(value):
    return '"' + str(value).replace('"', '""') + '"'


def available(directory=DATA):
    """Trust only this notebook's CA; never bypass TLS or reuse another service."""
    ca = Path(directory) / 'certificates' / 'ProvaScan-CA.crt'
    if not ca.exists():
        return False
    try:
        context = ssl.create_default_context(cafile=str(ca))
        # Never send localhost through a configured HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context))
        with opener.open(URL + '/pair', timeout=2) as response:
            return response.status == 200 and b'<title>Conectar ao ProvaScan</title>' in response.read(16384)
    except (OSError, ValueError):
        return False


@contextlib.contextmanager
def startup_lock(directory=DATA):
    """A kernel-owned file lock survives neither crashes nor user logout."""
    import msvcrt
    Path(directory).mkdir(parents=True, exist_ok=True)
    with open(Path(directory) / 'launcher.lock', 'a+b') as handle:
        handle.seek(0)
        if not handle.read(1):
            handle.write(b'0'); handle.flush()
        deadline = time.monotonic() + 45
        while True:
            try:
                handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Outra inicialização está em andamento. Aguarde e tente novamente.')
                time.sleep(.2)
        try:
            yield
        finally:
            handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def ensure_server(directory=DATA, background=False):
    directory = Path(directory)
    with startup_lock(directory):
        if available(directory):
            return
        # Wait briefly for the user's Wi-Fi during Windows login.
        if background:
            from server import addresses
            deadline = time.monotonic() + 30
            while not addresses() and time.monotonic() < deadline:
                time.sleep(1)
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', 8765)) == 0:
                raise RuntimeError('A porta 8765 está ocupada, mas o servidor não respondeu com o certificado esperado. Confira a conexão antes de iniciar outra instância.')
        python = ROOT / '.venv-lan' / 'Scripts' / 'python.exe'
        if not python.exists():
            raise RuntimeError('Prepare primeiro o ProvaScan com Iniciar-ProvaScan-WiFi.bat.')
        directory.mkdir(parents=True, exist_ok=True)
        log = directory / 'servidor.log'
        # A bounded previous-run log is sufficient for local support and pairing.
        if log.exists():
            previous = directory / 'servidor-anterior.log'
            previous.write_bytes(log.read_bytes()[-256000:])
        with open(log, 'w', encoding='utf-8') as output:
            process = subprocess.Popen([str(python), '-u', str(ROOT/'local'/'server.py'), '--data', str(directory), '--no-browser'],
                                       cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if available(directory):
                return
            if process.poll() is not None:
                raise RuntimeError('O servidor não iniciou. Consulte o atalho Conexão ProvaScan ou o arquivo servidor.log.')
            time.sleep(.3)
        raise RuntimeError('O servidor demorou para responder. Consulte Conexão ProvaScan antes de tentar novamente.')


def install():
    if os.name != 'nt':
        raise RuntimeError('Esta instalação é exclusiva do Windows.')
    python = ROOT/'.venv-lan'/'Scripts'/'pythonw.exe'
    if not python.exists() or not (DATA/'certificates'/'ProvaScan-CA.crt').exists():
        raise RuntimeError('Conclua a instalação inicial com Iniciar-ProvaScan-WiFi.bat antes de ativar o início automático.')
    # Windows shell resolves redirected/OneDrive Desktop and localized Startup paths.
    program = '\r\n'.join([
        'Option Explicit', 'Dim shell, fso, link, start, desktop',
        'Set shell = CreateObject("WScript.Shell")', 'Set fso = CreateObject("Scripting.FileSystemObject")',
        'start = shell.SpecialFolders("Startup")', 'desktop = shell.SpecialFolders("Desktop")',
    ]) + '\r\n'
    for folder, name, argument, description in [
        ('start','ProvaScan automático.lnk','--background','Iniciar o servidor ProvaScan ao entrar no Windows'),
        ('desktop','ProvaScan.lnk','--open','Abrir o ProvaScan e iniciar a conexão se necessário'),
        ('desktop','Conexão ProvaScan.lnk','--status','Ver endereços e códigos locais do ProvaScan'),
    ]:
        program += '\r\n'.join([
            'Set link = shell.CreateShortcut(fso.BuildPath('+folder+', '+vbs_quote(name)+'))',
            'link.TargetPath = '+vbs_quote(python),
            'link.Arguments = '+vbs_quote(subprocess.list2cmdline([str(Path(__file__).resolve()), argument])),
            'link.WorkingDirectory = '+vbs_quote(ROOT),
            'link.Description = '+vbs_quote(description),
            'link.IconLocation = '+vbs_quote(str(DATA/'provascan.ico')+',0'),
            'link.WindowStyle = 7', 'link.Save',
        ]) + '\r\n'
    DATA.mkdir(parents=True, exist_ok=True)
    png = (ROOT/'icon-192.png').read_bytes()
    (DATA/'provascan.ico').write_bytes(struct.pack('<HHH',0,1,1)+struct.pack('<BBBBHHII',192,192,0,0,1,32,len(png),22)+png)
    installer = DATA/'instalar-atalhos.vbs'
    installer.write_bytes(b'\xff\xfe'+program.encode('utf-16le'))
    try:
        subprocess.run(['cscript.exe','//nologo',str(installer)], check=True, timeout=20,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    finally:
        installer.unlink(missing_ok=True)


def uninstall():
    # Remove only our startup shortcut; preserve app, data and desktop shortcuts.
    text = ('Set s = CreateObject("WScript.Shell")\r\nSet f = CreateObject("Scripting.FileSystemObject")\r\n'
            'p = f.BuildPath(s.SpecialFolders("Startup"), "ProvaScan automático.lnk")\r\n'
            'If f.FileExists(p) Then f.DeleteFile p, True\r\n')
    DATA.mkdir(parents=True, exist_ok=True)
    path = DATA/'desativar-inicio.vbs'
    path.write_bytes(b'\xff\xfe'+text.encode('utf-16le'))
    try:
        subprocess.run(['cscript.exe','//nologo',str(path)], check=True, timeout=20,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    finally:
        path.unlink(missing_ok=True)


def notify(message, error=False):
    import ctypes
    ctypes.windll.user32.MessageBoxW(None, str(message), 'ProvaScan', 0x10 if error else 0x40)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--background', action='store_true')
    parser.add_argument('--open', action='store_true')
    parser.add_argument('--status', action='store_true')
    args = parser.parse_args()
    try:
        if os.name != 'nt':
            raise RuntimeError('Use este iniciador no Windows.')
        if args.uninstall:
            uninstall()
            notify('Início automático desativado. O servidor atual continuará até sair do Windows. Seus dados foram preservados.')
            return
        if args.install:
            install()
        ensure_server(background=args.background)
        if args.status:
            subprocess.Popen(['notepad.exe', str(DATA/'servidor.log')])
        elif args.open or args.install:
            webbrowser.open(URL)
        if args.install:
            notify('Pronto! O ProvaScan iniciará em segundo plano ao entrar no Windows. Use o ícone ProvaScan na área de trabalho. Não mova nem exclua a pasta do programa. Não é necessário manter uma janela preta aberta.')
    except Exception as error:
        if args.background:
            DATA.mkdir(parents=True, exist_ok=True)
            (DATA/'inicializacao-erro.txt').write_text(str(error), encoding='utf-8')
        else:
            notify(str(error), error=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
