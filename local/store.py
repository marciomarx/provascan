"""Transactional, authoritative notebook database. No network/cloud dependencies."""
import copy
import datetime as dt
import json
import math
import re
import sqlite3

PROTOCOL = 1
EMPTY = {'classes': [], 'exams': []}
KEY = re.compile(r'^(class|exam)/[^/]{1,150}$|^(student|result)/[^/]{1,150}/[^/]{1,150}$')

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def flatten(db):
    records = {}
    for c in db['classes']:
        records['class/' + c['id']] = {k: v for k, v in c.items() if k != 'students'}
        for s in c.get('students', []):
            records['student/' + c['id'] + '/' + s['id']] = s
    for e in db['exams']:
        records['exam/' + e['id']] = {k: v for k, v in e.items() if k != 'results'}
        for sid, r in e.get('results', {}).items():
            records['result/' + e['id'] + '/' + sid] = r
    return records

def inflate(records):
    db = copy.deepcopy(EMPTY)
    for key, value in sorted(records.items()):
        if value is None:
            continue
        kind, *parts = key.split('/')
        if kind == 'class':
            db['classes'].append({**copy.deepcopy(value), 'students': []})
        elif kind == 'exam':
            db['exams'].append({**copy.deepcopy(value), 'results': {}})
    classes = {c['id']: c for c in db['classes']}
    exams = {e['id']: e for e in db['exams']}
    for key, value in sorted(records.items()):
        if value is None:
            continue
        kind, *parts = key.split('/')
        if kind == 'student':
            if parts[0] not in classes:
                raise ValueError('Aluno sem turma. Confira a exclusão feita no outro aparelho.')
            classes[parts[0]]['students'].append(copy.deepcopy(value))
        elif kind == 'result':
            if parts[0] not in exams:
                raise ValueError('Correção sem avaliação.')
            exams[parts[0]]['results'][parts[1]] = copy.deepcopy(value)
    for e in db['exams']:
        if e['classId'] not in classes:
            raise ValueError('Avaliação sem turma.')
        students = {s['id'] for s in classes[e['classId']]['students']}
        if any(sid not in students for sid in e['results']):
            raise ValueError('Correção vinculada a aluno excluído ou de outra turma.')
    return db

def settings(e):
    n, alt, points = e.get('n'), e.get('alt'), e.get('points')
    annulled = e.get('annulled', [])
    if type(n) is not int or not 1 <= n <= 30 or alt not in (4, 5):
        raise ValueError('Quantidade de questões ou alternativas inválida.')
    if type(points) not in (int, float) or not math.isfinite(points) or points < .01 or abs(points * 100 - round(points * 100)) > .00001:
        raise ValueError('Valor da avaliação inválido.')
    if not isinstance(annulled, list) or any(type(i) is not int or not 0 <= i < n for i in annulled):
        raise ValueError('Anulação inválida.')
    if len(set(annulled)) >= n:
        raise ValueError('Mantenha pelo menos uma questão válida.')
    return sorted(set(annulled))

def grade(e, r):
    annulled = settings(e)
    if not isinstance(r.get('answers'), dict):
        raise ValueError('Correção antiga sem respostas: registre as respostas antes de recalcular.')
    if r.get('questionCount', e['n']) != e['n']:
        raise ValueError('A quantidade de questões mudou. Confira novamente essa correção.')
    correct = wrong = blank = 0
    for i in range(e['n']):
        if i in annulled:
            continue
        key, answer = e.get('key', {}).get(str(i)), r['answers'].get(str(i), '')
        if key not in list('ABCDE'[:e['alt']]):
            raise ValueError('Preencha todo o gabarito válido antes de registrar ou recalcular notas.')
        if answer == '':
            blank += 1
        elif answer == 'MULTI':
            wrong += 1
        elif answer not in list('ABCDE'[:e['alt']]):
            raise ValueError('Resolva as respostas duvidosas antes de salvar.')
        elif answer == key:
            correct += 1
        else:
            wrong += 1
    return {**r, 'correct': correct, 'wrong': wrong, 'blank': blank,
            'score': correct / (e['n'] - len(annulled)) * e['points'],
            'pointsSnapshot': e['points'], 'annulledSnapshot': annulled,
            'questionCount': e['n'], 'keySnapshot': copy.deepcopy(e['key'])}

class Database:
    def __init__(self, path):
        self.sql = sqlite3.connect(path)
        self.sql.execute('PRAGMA journal_mode=WAL')
        self.sql.execute('PRAGMA synchronous=FULL')
        self.sql.executescript('''
        CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT, version TEXT);
        CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, body TEXT NOT NULL, seq INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, role TEXT NOT NULL);
        ''')
        self.sql.commit()

    def snapshot(self):
        records, versions = {}, {}
        for key, value, version in self.sql.execute('SELECT key,value,version FROM records'):
            records[key] = json.loads(value)
            versions[key] = version
        seq = self.sql.execute('SELECT COALESCE(MAX(seq),0) FROM operations').fetchone()[0]
        return {'type': 'snapshot', 'protocol': PROTOCOL, 'seq': seq,
                'db': inflate(records), 'versions': versions}

    def apply(self, op):
        if not isinstance(op, dict) or op.get('protocol') != PROTOCOL or not isinstance(op.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9-]{10,100}', op['id']):
            raise ValueError('Operação inválida ou versão incompatível.')
        body = encoded(op)
        prev = self.sql.execute('SELECT body,seq FROM operations WHERE id=?', (op['id'],)).fetchone()
        if prev:
            if body != prev[0]:
                raise ValueError('Operação repetida com conteúdo diferente.')
            return {'type': 'ack', 'id': op['id'], 'seq': prev[1], 'duplicate': True}
        changes = op.get('changes')
        if not isinstance(changes, list) or not changes or len(changes) > 10000:
            raise ValueError('Lote de alterações inválido.')
        state = self.snapshot()
        versions = state['versions']
        if any(not isinstance(c, dict) for c in changes) or not isinstance(op.get('depends', {}), dict):
            raise ValueError('Formato da operação inválido.')
        for c in changes:
            if isinstance(c.get('key'), str) and c['key'].startswith('result/'):
                exam_key = 'exam/' + c['key'].split('/')[1]
                if exam_key not in op.get('depends', {}):
                    raise ValueError('A correção precisa informar a versão da avaliação.')
        conflicts = [c.get('key') for c in changes if isinstance(c, dict) and versions.get(c.get('key')) != c.get('base')]
        for key, version in op.get('depends', {}).items():
            if versions.get(key) != version:
                conflicts.append(key)
        if conflicts:
            return {'type': 'conflict', 'id': op['id'], 'keys': sorted(set(conflicts)), 'snapshot': state}
        records = flatten(state['db'])
        seen = set()
        for c in changes:
            key, value = c.get('key'), c.get('value')
            if not isinstance(key, str) or not KEY.fullmatch(key) or key in seen or value is not None and not isinstance(value, dict):
                raise ValueError('Registro inválido ou repetido no lote.')
            seen.add(key)
            if value is not None:
                kind = key.split('/')[0]
                if kind != 'result' and value.get('id') != key.split('/')[-1]:
                    raise ValueError('Identificação inválida.')
                if kind in ('class', 'student', 'exam') and (not isinstance(value.get('name'), str) or not value['name'].strip()):
                    raise ValueError('Nome obrigatório.')
                if kind == 'exam':
                    settings(value)
            records[key] = copy.deepcopy(value)
        db = inflate(records)
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        for e in db['exams']:
            old = next((x for x in state['db']['exams'] if x['id'] == e['id']), None)
            changed_settings = old and any(encoded(old.get(k)) != encoded(e.get(k)) for k in ('key', 'points', 'annulled', 'n', 'alt'))
            for sid, result in list(e['results'].items()):
                if 'result/' + e['id'] + '/' + sid in seen or changed_settings:
                    if changed_settings and not result.get('answers') and result.get('answers') != {}:
                        # Legacy value-only corrections can be rescaled without inventing answers.
                        if any(encoded(old.get(k)) != encoded(e.get(k)) for k in ('key', 'annulled', 'n', 'alt')):
                            raise ValueError('Há nota antiga sem respostas. Registre as respostas antes de alterar o gabarito ou as anulações.')
                        revised = {**result, 'score': result['correct'] / (e['n'] - len(settings(e))) * e['points'], 'pointsSnapshot': e['points']}
                    else:
                        revised = grade(e, result)
                    if changed_settings:
                        prior = (old.get('results', {}).get(sid) or result)
                        revised['recalculatedAt'] = now
                        revised['gradingHistory'] = [*prior.get('gradingHistory', []), {'at': now, 'score': prior.get('score'), 'points': prior.get('pointsSnapshot', old['points']), 'annulled': prior.get('annulledSnapshot', [])}]
                    e['results'][sid] = revised
        next_records = flatten(db)
        touched = set(seen)
        for key in set(records) | set(next_records):
            if encoded(records.get(key)) != encoded(next_records.get(key)):
                touched.add(key)
        seq = state['seq'] + 1
        with self.sql:
            for key in touched:
                self.sql.execute('INSERT OR REPLACE INTO records VALUES (?,?,?)', (key, encoded(next_records.get(key)), op['id']))
            self.sql.execute('INSERT INTO operations VALUES (?,?,?)', (op['id'], body, seq))
        return {'type': 'ack', 'id': op['id'], 'seq': seq}

    def backup(self, path):
        target = sqlite3.connect(path)
        with target:
            self.sql.backup(target)
        target.close()
