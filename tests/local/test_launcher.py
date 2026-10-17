import contextlib
import importlib.util
from pathlib import Path
import socket
import ssl
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock
import urllib.error

spec = importlib.util.spec_from_file_location('provascan_launcher', Path(__file__).resolve().parents[2]/'local'/'launcher.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class LauncherTests(unittest.TestCase):
    def test_probe_requires_personal_ca_and_rejects_unrelated_page_or_tls_error(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            self.assertFalse(launcher.available(root))
            (root/'certificates').mkdir();(root/'certificates'/'ProvaScan-CA.crt').write_text('test')
            response=Mock(status=200);response.read.return_value=b'<title>Unrelated server</title>'
            opener=Mock();opener.open.return_value.__enter__=Mock(return_value=response);opener.open.return_value.__exit__=Mock(return_value=False)
            with patch.object(launcher.ssl,'create_default_context') as tls, patch.object(launcher.urllib.request,'build_opener',return_value=opener):
                self.assertFalse(launcher.available(root))
                tls.assert_called_once_with(cafile=str(root/'certificates'/'ProvaScan-CA.crt'))
                response.read.return_value=b'<title>Conectar ao ProvaScan</title>'
                self.assertTrue(launcher.available(root))
                opener.open.side_effect=urllib.error.URLError(ssl.SSLError('bad certificate'))
                self.assertFalse(launcher.available(root))

    def test_ready_server_is_reused_without_spawning(self):
        with patch.object(launcher,'startup_lock',return_value=contextlib.nullcontext()), patch.object(launcher,'available',return_value=True), patch.object(launcher.subprocess,'Popen') as spawn:
            launcher.ensure_server()
            spawn.assert_not_called()

    def test_busy_untrusted_port_never_starts_second_server(self):
        with patch.object(launcher,'startup_lock',return_value=contextlib.nullcontext()), patch.object(launcher,'available',return_value=False), patch.object(launcher.socket,'socket') as sock, patch.object(launcher.subprocess,'Popen') as spawn:
            sock.return_value.__enter__.return_value.connect_ex.return_value=0
            with self.assertRaisesRegex(RuntimeError,'porta 8765'):
                launcher.ensure_server()
            spawn.assert_not_called()

    def test_start_is_hidden_uses_existing_environment_and_waits_for_readiness(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);python=root/'.venv-lan'/'Scripts'/'python.exe';python.parent.mkdir(parents=True);python.touch()
            data=root/'data'
            with patch.object(launcher,'ROOT',root), patch.object(launcher,'startup_lock',return_value=contextlib.nullcontext()), patch.object(launcher,'available',side_effect=[False,True]), patch.object(launcher.socket,'socket') as sock, patch.object(launcher.subprocess,'Popen') as spawn, patch.object(launcher.subprocess,'CREATE_NO_WINDOW',0x08000000,create=True):
                sock.return_value.__enter__.return_value.connect_ex.return_value=1
                launcher.ensure_server(data)
                args,kw=spawn.call_args
                self.assertEqual(args[0][0],str(python));self.assertIn('--no-browser',args[0]);self.assertIn('-u',args[0]);self.assertEqual(kw['creationflags'],0x08000000)
                self.assertEqual(kw['cwd'],root);self.assertTrue((data/'servidor.log').exists())

    def test_install_uses_windows_known_folders_and_fixed_shortcut_names(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'Área de trabalho';root.mkdir();data=root/'dados';(root/'icon-192.png').write_bytes(b'PNG fixture')
            python=root/'.venv-lan'/'Scripts'/'pythonw.exe';python.parent.mkdir(parents=True);python.touch()
            (data/'certificates').mkdir(parents=True);(data/'certificates'/'ProvaScan-CA.crt').touch()
            captured=[]
            def run(args,**kwargs):
                captured.append(Path(args[-1]).read_text(encoding='utf-16'))
            with patch.object(launcher,'ROOT',root),patch.object(launcher,'DATA',data),patch.object(launcher,'os',SimpleNamespace(name='nt')),patch.object(launcher.subprocess,'run',side_effect=run),patch.object(launcher.subprocess,'CREATE_NO_WINDOW',0x08000000,create=True):
                launcher.install();launcher.install();launcher.uninstall()
            self.assertEqual(captured[0],captured[1])
            self.assertIn('SpecialFolders("Desktop")',captured[0]);self.assertIn('SpecialFolders("Startup")',captured[0]);self.assertIn('--background',captured[0]);self.assertIn('--open',captured[0]);self.assertIn('--status',captured[0]);self.assertIn(str(python),captured[0])
            self.assertNotIn('provascan.sqlite3',captured[2]);self.assertNotIn('SpecialFolders("Desktop")',captured[2]);self.assertFalse((data/'instalar-atalhos.vbs').exists())

    @unittest.skipUnless(__import__('os').name=='nt','Kernel Windows indisponível neste ambiente')
    def test_windows_lock_releases_after_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            with launcher.startup_lock(folder):
                pass
            with launcher.startup_lock(folder):
                pass
