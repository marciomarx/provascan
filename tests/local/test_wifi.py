import asyncio
import copy
import hashlib
import json
import ssl
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'local'))
from aiohttp.test_utils import TestClient, TestServer
from aiohttp import ClientSession, TCPConnector
from store import Database, flatten
from server import Server
from releases import Releases, ASSETS
from certificates import create
from cryptography import x509
from cryptography.hazmat.primitives import hashes

ROOT = Path(__file__).resolve().parents[2]

def seed():
    return {'classes':[{'id':'c','name':'Turma','students':[{'id':'s','name':'Aluno'}]}], 'exams':[{'id':'e','name':'Prova','classId':'c','n':2,'alt':4,'points':10,'key':{'0':'A','1':'B'},'results':{}}]}

def operation(db, changes, name='operation-0001', depends=None):
    state=db.snapshot()
    return {'protocol':1,'id':name,'changes':[{'key':k,'value':v,'base':state['versions'].get(k)} for k,v in changes.items()], 'depends':depends or {}}

class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=Database(Path(self.temp.name)/'db.sqlite3')
        self.db.apply(operation(self.db,flatten(seed())))
    def tearDown(self):
        self.db.sql.close();self.temp.cleanup()
    def result(self, name='operation-0002'):
        return operation(self.db, {'result/e/s':{'answers':{'0':'A','1':'D'},'questionCount':2,'score':999,'markedAlternatives':[['A'],['D']]}}, name, {'exam/e':self.db.snapshot()['versions']['exam/e']})
    def test_authority_recalculates_and_duplicate_replay_is_idempotent(self):
        op=self.result();self.db.apply(op);self.db.apply(op)
        self.assertEqual(self.db.snapshot()['seq'],2)
        r=self.db.snapshot()['db']['exams'][0]['results']['s']
        self.assertEqual(r['score'],5);self.assertEqual(r['markedAlternatives'],[['A'],['D']])
        altered=copy.deepcopy(op);altered['changes'][0]['value']['score']=3
        with self.assertRaises(ValueError):self.db.apply(altered)
    def test_total_annulment_and_official_key_recalculate_existing_result(self):
        self.db.apply(self.result())
        exam=flatten(self.db.snapshot()['db'])['exam/e'];exam['points']=100
        self.db.apply(operation(self.db,{'exam/e':exam},'operation-0003'))
        self.assertEqual(self.db.snapshot()['db']['exams'][0]['results']['s']['score'],50)
        exam['annulled']=[1];self.db.apply(operation(self.db,{'exam/e':exam},'operation-0004'))
        self.assertEqual(self.db.snapshot()['db']['exams'][0]['results']['s']['score'],100)
        exam['annulled']=[];exam['key']['1']='D';self.db.apply(operation(self.db,{'exam/e':exam},'operation-0005'))
        result=self.db.snapshot()['db']['exams'][0]['results']['s'];self.assertEqual(result['score'],100);self.assertEqual(len(result['gradingHistory']),3)
    def test_delete_one_result_preserves_other_exams_and_survives_replay(self):
        self.db.apply(self.result())
        second=copy.deepcopy(self.db.snapshot()['db']['exams'][0])
        second['id']='second'
        values=flatten({'classes':[], 'exams':[second]})
        self.db.apply(operation(self.db,values,'operation-0003',{'exam/second':None}))
        old_result=self.db.snapshot()['db']['exams'][1]['results']['s']
        version=self.db.snapshot()['versions']['exam/e']
        removal=operation(self.db,{'result/e/s':None},'operation-0004',{'exam/e':version})
        self.db.apply(removal)
        self.db.apply(removal)
        state=self.db.snapshot()
        self.assertNotIn('s',state['db']['exams'][0]['results'])
        self.assertEqual(state['db']['exams'][1]['results']['s'],old_result)
        stale=self.result('operation-0005')
        stale['changes'][0]['base']='operation-0002'
        self.assertEqual(self.db.apply(stale)['type'],'conflict')
        self.db.apply(self.result('operation-0006'))
        self.assertEqual(self.db.snapshot()['db']['exams'][0]['results']['s']['score'],5)
    def test_stale_result_dependency_conflicts_even_when_result_does_not_exist(self):
        stale=self.result();exam=flatten(seed())['exam/e'];exam['points']=100
        self.db.apply(operation(self.db,{'exam/e':exam},'operation-0003'))
        self.assertEqual(self.db.apply(stale)['type'],'conflict')
        self.assertNotIn('s',self.db.snapshot()['db']['exams'][0]['results'])
    def test_concurrent_edits_and_delete_vs_child_are_atomic(self):
        first=operation(self.db,{'class/c':{'id':'c','name':'A'}},'operation-0002')
        second=operation(self.db,{'class/c':{'id':'c','name':'B'}},'operation-0003')
        self.db.apply(first);self.assertEqual(self.db.apply(second)['type'],'conflict')
        before=self.db.snapshot()
        with self.assertRaises(ValueError):self.db.apply(operation(self.db,{'class/c':None},'operation-0004'))
        self.assertEqual(before,self.db.snapshot())
    def test_persistent_history_survives_restart_and_backup(self):
        op=self.result();self.db.apply(op);self.db.backup(Path(self.temp.name)/'backup.sqlite3')
        reopened=Database(Path(self.temp.name)/'backup.sqlite3')
        self.assertEqual(self.db.snapshot(),reopened.snapshot());self.assertTrue(reopened.apply(op)['duplicate']);reopened.sql.close()
    def test_invalid_settings_cannot_partially_write(self):
        exam=flatten(seed())['exam/e'];exam['annulled']=[0,1];before=self.db.snapshot()
        with self.assertRaises(ValueError):self.db.apply(operation(self.db,{'exam/e':exam},'operation-0003'))
        self.assertEqual(before,self.db.snapshot())
    def test_multi_and_blank_receive_zero_with_valid_denominator(self):
        e=flatten(seed())['exam/e'];e['n']=4;e['key']={'0':'A','1':'B','2':'C','3':'D'}
        self.db.apply(operation(self.db,{'exam/e':e},'operation-0002'))
        op=operation(self.db,{'result/e/s':{'answers':{'0':'A','1':'MULTI','3':'D'},'questionCount':4}},'operation-0003',{'exam/e':'operation-0002'})
        self.db.apply(op);r=self.db.snapshot()['db']['exams'][0]['results']['s'];self.assertEqual((r['correct'],r['wrong'],r['blank'],r['score']),(2,1,1,5))

class ReleaseTests(unittest.TestCase):
    def test_release_no_google_algorithms_identical_and_rollback_after_unconfirmed_restart(self):
        with tempfile.TemporaryDirectory() as temp:
            r=Releases(ROOT,temp);old=r.state['active'];html=r.asset('index.html').decode();original=(ROOT/'index.html').read_text()
            self.assertNotIn('src="drive-sync.js',html);self.assertNotIn('accounts.google.com',html)
            for start,end in [('function makeSvg(', 'function cardPage('),(' function autoRead(', ' function updateZoom(')]:
                if start in original:self.assertEqual(html[html.index(start):html.index(end)],original[original.index(start):original.index(end)])
            files={name:(ROOT/name).read_bytes() for name in ASSETS};files['local-sync.js']+=b'\n// next release'
            staged=r.stage(files);self.assertEqual(r.state['active'],old);r.activate(staged['id']);self.assertNotEqual(r.state['active'],old)
            r=Releases(ROOT,temp);self.assertEqual(r.state['active'],old)
            r.stage(files);r.activate(staged['id']);r.healthy(staged['id']);r=Releases(ROOT,temp);self.assertEqual(r.state['active'],staged['id'])
    def test_partial_release_is_rejected_and_keys_are_not_in_served_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            r=Releases(ROOT,temp)
            with self.assertRaises(ValueError):r.stage({'index.html':b'partial'})
            with self.assertRaises(ValueError):r.asset('ca-key.pem')
            with self.assertRaises(ValueError):r.asset('../provascan.sqlite3')
    def test_private_ca_identity_persists_and_leaf_covers_lan_ip(self):
        with tempfile.TemporaryDirectory() as temp:
            first=create(temp,['192.168.1.10']);second=create(temp,['192.168.1.20']);self.assertEqual(first,second)
            cert=x509.load_pem_x509_certificate((Path(temp)/'server.pem').read_bytes())
            names=cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            self.assertIn('192.168.1.20',[str(x) for x in names.get_values_for_type(x509.IPAddress)])

class NetworkTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.s=Server(ROOT,self.temp.name);self.s.db.apply(operation(self.s.db,flatten(seed())))
        self.client=TestClient(TestServer(self.s.application(secure=False)));await self.client.start_server()
        self.origin=str(self.client.make_url('/')).rstrip('/')
        self.headers={'Origin':self.origin}
    async def asyncTearDown(self):
        await self.client.close();self.temp.cleanup()
    async def pair(self,code):
        r=await self.client.post('/api/pair',json={'code':code},headers=self.headers)
        self.assertEqual(r.status,200)
        return {'Cookie':'provascan_session='+r.cookies['provascan_session'].value,**self.headers}
    async def test_two_devices_broadcast_reconnect_and_idempotent_retry(self):
        phone=await self.pair(self.s.pair_code);notebook=await self.pair(self.s.admin_code)
        a=await self.client.ws_connect('/ws',headers=phone);b=await self.client.ws_connect('/ws',headers=notebook)
        state=await a.receive_json();await b.receive_json()
        op=operation(self.s.db,{'student/c/s':{'id':'s','name':'Novo nome'}},'network-op-0002');op['serverId']=self.s.id
        await a.send_json(op);self.assertEqual((await a.receive_json())['type'],'ack');self.assertEqual((await a.receive_json())['seq'],2)
        seen=await b.receive_json();self.assertEqual(seen['db']['classes'][0]['students'][0]['name'],'Novo nome')
        await a.close();a=await self.client.ws_connect('/ws',headers=phone);self.assertEqual((await a.receive_json())['seq'],2)
        await a.send_json(op);self.assertTrue((await a.receive_json())['duplicate']);self.assertEqual(self.s.db.snapshot()['seq'],2)
        await a.close();await b.close()
    async def test_auth_origin_and_role_boundaries(self):
        self.assertEqual((await self.client.get('/api/state')).status,401)
        self.assertEqual((await self.client.post('/api/pair',json={'code':self.s.pair_code},headers={'Origin':'https://evil.test'})).status,403)
        phone=await self.pair(self.s.pair_code)
        self.assertEqual((await self.client.post('/api/activate-update',json={'id':'bad'},headers=phone)).status,403)
        self.assertEqual((await self.client.get('/server-key.pem',headers=phone)).status,404)
    async def test_malformed_message_does_not_kill_connection(self):
        phone=await self.pair(self.s.pair_code);ws=await self.client.ws_connect('/ws',headers=phone);await ws.receive_json()
        await ws.send_str('{');self.assertEqual((await ws.receive_json())['type'],'error')
        await ws.send_json({'type':'hello','protocol':1});self.assertEqual((await ws.receive_json())['type'],'snapshot');await ws.close()
    async def test_wrong_notebook_and_protocol_are_rejected(self):
        phone=await self.pair(self.s.pair_code);ws=await self.client.ws_connect('/ws',headers=phone);await ws.receive_json()
        await ws.send_json({'id':'network-op-0003','serverId':'wrong','protocol':1});self.assertEqual((await ws.receive_json())['type'],'error');await ws.close()

class SecureNetworkTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_tls_authenticated_websocket_and_immutable_release_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            create(Path(temp)/'certificates', ['127.0.0.1'])
            server_context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(Path(temp)/'certificates/server.pem',Path(temp)/'certificates/server-key.pem')
            trust=ssl.create_default_context(cafile=str(Path(temp)/'certificates/ProvaScan-CA.crt'))
            service=Server(ROOT,temp)
            http=TestServer(service.application())
            await http.start_server(ssl=server_context)
            origin=str(http.make_url('/')).rstrip('/')
            try:
                async with ClientSession(connector=TCPConnector(ssl=trust)) as client:
                    response=await client.post(origin+'/api/pair',json={'code':service.admin_code},headers={'Origin':origin})
                    self.assertEqual(response.status,200)
                    cookie=response.cookies['provascan_session']
                    self.assertTrue(cookie['secure']);self.assertTrue(cookie['httponly'])
                    headers={'Origin':origin,'Cookie':'provascan_session='+cookie.value}
                    ws=await client.ws_connect(origin+'/ws',headers=headers)
                    state=await ws.receive_json();self.assertEqual(state['serverId'],service.id)
                    response=await client.get(origin+'/');html=await response.text()
                    self.assertIn('/r/'+state['release']+'/local-sync.js',html)
                    response=await client.get(origin+'/r/'+state['release']+'/local-sync.js')
                    self.assertEqual(response.status,200)
                    self.assertEqual(await response.read(),(ROOT/'local-sync.js').read_bytes())
                    response=await client.get(origin+'/local-sw.js');self.assertNotIn('__RELEASE_ID__',await response.text())
                    response=await client.get(origin+'/api/state',headers={**headers,'Host':'evil.test'})
                    self.assertEqual(response.status,403)
                    await ws.close()
            finally:
                await http.close()

if __name__ == '__main__':unittest.main()
