import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('package_builder',ROOT/'tools'/'build_test_package.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
sys.path.insert(0,str(ROOT/'local'))
from server import Server


class PackageTests(unittest.TestCase):
    def test_archive_is_reproducible_complete_and_excludes_every_runtime_file(self):
        with tempfile.TemporaryDirectory() as folder:
            a=builder.build(Path(folder)/'a.zip');b=builder.build(Path(folder)/'b.zip')
            self.assertEqual(a.read_bytes(),b.read_bytes())
            with zipfile.ZipFile(a) as archive:
                self.assertIsNone(archive.testzip())
                names=set(archive.namelist())
                self.assertEqual(names,{'ProvaScan/'+n for n in builder.FILES}|{'ProvaScan/VERIFICACAO-SHA256.txt'})
                self.assertFalse(any(n.endswith(('.sqlite3','.pem','.crt','.log')) or '.venv' in n or '__pycache__' in n or '/tests/' in n for n in names))
                self.assertIn('ProvaScan/Instalar-ProvaScan.bat',names)
                checksums=archive.read('ProvaScan/VERIFICACAO-SHA256.txt').decode().splitlines()
                for line in checksums:
                    digest,name=line.split('  ',1)
                    self.assertEqual(hashlib.sha256(archive.read('ProvaScan/'+name)).hexdigest(),digest)

    def test_extracted_package_starts_a_fresh_authority_with_no_professor_records(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);archive=builder.build(root/'package.zip')
            with zipfile.ZipFile(archive) as source:
                source.extractall(root/'extracted')
            app=Server(root/'extracted'/'ProvaScan',root/'new-user-data')
            try:
                self.assertEqual(app.db.snapshot()['db'],{'classes':[],'exams':[]})
                page=app.releases.asset('index.html').decode()
                self.assertIn('local-sync.js',page)
                self.assertNotIn('https://accounts.google.com/gsi/client',page)
                self.assertNotIn('<script src="drive-api.js',page)
                self.assertNotIn('<script src="drive-config.js',page)
            finally:
                app.db.sql.close()
