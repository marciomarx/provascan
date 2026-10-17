"""Build an allowlisted, reproducible test ZIP; never include runtime data."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
FILES = [
    'Instalar-ProvaScan.bat', 'COMECE-AQUI.txt', 'WIFI_SETUP.md',
    'Instalar-ProvaScan-Automatico.bat', 'Desativar-Inicio-Automatico.bat',
    'Iniciar-ProvaScan-WiFi.bat', 'local-release.json',
    'index.html', 'grading.js', 'drive-store.js', 'local-model.js', 'local-sync.js',
    'local-sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'privacy.html',
    'local/requirements.txt', 'local/server.py', 'local/store.py',
    'local/releases.py', 'local/certificates.py', 'local/launcher.py',
]


def build(output, root=ROOT):
    output,root=Path(output),Path(root)
    data={name:(root/name).read_bytes() for name in FILES}
    manifest=json.loads(data['local-release.json'])
    for name,digest in manifest['files'].items():
        if hashlib.sha256(data[name]).hexdigest()!=digest:
            raise ValueError('Manifesto inconsistente: '+name)
    checksums=''.join(hashlib.sha256(value).hexdigest()+'  '+name+'\n' for name,value in sorted(data.items()))
    data['VERIFICACAO-SHA256.txt']=checksums.encode()
    output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,value in sorted(data.items()):
            info=zipfile.ZipInfo('ProvaScan/'+name,date_time=(2026,10,17,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o100644<<16
            archive.writestr(info,value)
    return output


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('output',type=Path)
    print(build(parser.parse_args().output))
