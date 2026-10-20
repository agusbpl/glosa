"""Explicit, local tutor context assembly. Never calls a model or follows URLs."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import re
import unicodedata
from tutor_output import unpack_reply

MAX_CHARS = 3_000_000
FLAGS = ('includeLesson', 'includeBaseNote', 'includeBaseSources', 'includeHistory', 'includePlan')


def target_key(target):
    if not isinstance(target, dict) or target.get('kind') not in ('study', 'note'):
        raise ValueError('Destino del contexto inválido.')
    required = ('courseId', 'lessonId') if target['kind'] == 'study' else ('noteId',)
    if any(not isinstance(target.get(k), str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', target[k]) for k in required):
        raise ValueError('Destino del contexto inválido.')
    identity = {k: target[k] for k in ('kind',) + required}
    return hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()


def defaults(state, target):
    target_key(target)
    if target['kind'] == 'study':
        course = next((c for c in state['courses'] if c['id'] == target['courseId']), None)
        if not course or not any(l['id'] == target['lessonId'] for l in course['lessons']):
            raise ValueError('Lección inexistente.')
        # A highlight the student retired (data.removed) is kept in the exportable
        # history but never enters the automatic tutor context.
        ids = [e['id'] for e in state['events'] if e['kind'] == 'annotation' and e['courseId'] == course['id'] and e['data'].get('courseVersion', course['version']) == course['version'] and e['data'].get('shareWithTutor', True) and not e['data'].get('removed')]
    else:
        if not any(n['id'] == target['noteId'] for n in state['library']['notes']):
            raise ValueError('Nota inexistente.')
        ids = []
    return {**{k: True for k in FLAGS}, 'annotationIds': ids, 'noteItems': [], 'documents': [], 'texts': []}


def validate(selection):
    if not isinstance(selection, dict) or any(type(selection.get(k)) is not bool for k in FLAGS):
        raise ValueError('Selección de contexto inválida.')
    for k in ('annotationIds', 'noteItems', 'documents', 'texts'):
        if not isinstance(selection.get(k), list) or len(selection[k]) > 1000:
            raise ValueError('Lista de contexto inválida: ' + k)
    for identifier in selection['annotationIds']:
        if not isinstance(identifier, str) or len(identifier) > 100:
            raise ValueError('Anotación de contexto inválida.')
    for item in selection['noteItems']:
        if not isinstance(item, dict) or not isinstance(item.get('noteId'), str) or item.get('part') not in ('general', 'page', 'anchor'):
            raise ValueError('Parte del apunte inválida.')
        if item['part'] == 'anchor':
            if item.get('anchorId') is not None:
                if not isinstance(item['anchorId'],str) or not 1<=len(item['anchorId'])<=100:raise ValueError('Anotación del apunte inválida.')
            elif not isinstance(item.get('legacyAnchor'),dict) or len(json.dumps(item['legacyAnchor']))>100000:
                raise ValueError('Anotación del apunte inválida.')
        if item['part'] == 'page' and (not isinstance(item.get('documentId'), str) or type(item.get('page')) is not int or item['page'] < 1):
            raise ValueError('Página del apunte inválida.')
    for doc in selection['documents']:
        if not isinstance(doc, dict) or not isinstance(doc.get('documentId'), str) or doc.get('mode') not in ('all', 'pages', 'search'):
            raise ValueError('Fuente de contexto inválida.')
        if doc['mode'] == 'pages':
            if not isinstance(doc.get('pages'), list) or not doc['pages'] or len(doc['pages']) > 2000 or any(type(p) is not int or p < 1 for p in doc['pages']):
                raise ValueError('Elegí páginas válidas de la fuente.')
    for source in selection['texts']:
        if not isinstance(source, dict) or not isinstance(source.get('title'), str) or not 1 <= len(source['title'].strip()) <= 200 or not isinstance(source.get('text'), str) or not 1 <= len(source['text'].strip()) <= 200000:
            raise ValueError('Agregá título y contenido de la fuente de texto.')
        url = source.get('url', '')
        if not isinstance(url, str) or len(url) > 2000 or (url and not re.match(r'^https://[^\s]+$', url)):
            raise ValueError('El enlace de la fuente requiere HTTPS.')
    return json.loads(json.dumps(selection))


def chosen(state, target, expected_revision=None):
    key = target_key(target)
    default = defaults(state, target)
    record = next((r for r in state['library'].get('tutorContexts', []) if r['id'] == key), None)
    revision = record['revision'] if record else 0
    if expected_revision is not None and (type(expected_revision) is not int or expected_revision != revision):
        raise ValueError('El contexto cambió en otra ventana. Abrí Contexto y revisá la selección antes de enviar.')
    return (validate(record['selection']) if record else default), revision


def save(lib, state, target, selection, expected_revision):
    defaults(state, target)
    key = target_key(target); selection = validate(selection)
    with lib.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT body FROM tutor_contexts WHERE id=?', (key,)).fetchone()
        old = json.loads(row['body']) if row else None
        if type(expected_revision) is not int or expected_revision != (old['revision'] if old else 0):
            raise ValueError('El contexto cambió en otra ventana. Cerrá y volvé a abrir el gestor.')
        record = {'id': key, 'target': {k: target[k] for k in (('kind','courseId','lessonId') if target['kind']=='study' else ('kind','noteId'))}, 'revision': (old['revision'] if old else 0)+1, 'selection': selection, 'updatedAt': datetime.now(timezone.utc).isoformat()}
        conn.execute('INSERT OR REPLACE INTO tutor_contexts VALUES(?,?)', (key, json.dumps(record, ensure_ascii=False)))
    return record


def all_pages(lib, document_id):
    doc = lib.document(document_id)
    cache = lib.root / '.md_cache' / (document_id+'.json') if doc['storage']=='source' else lib.data / 'documents' / (document_id+'.json')
    if not cache.is_file(): return doc, []
    contents = json.loads(cache.read_text())
    pages = contents.get('pages', []) if isinstance(contents, dict) else []
    return doc, [p for p in pages if isinstance(p,dict) and type(p.get('page')) is int and isinstance(p.get('text'),str)]


STOP = set('a al algo ante bajo con como contra cual cuando de del desde donde el ella en entre era es esta este esto fue ha hay la las le lo los más me mi no o para pero por porque que qué se si sin sobre su sus te tiene tu un una uno unos y ya'.split())
def words(text):
    clean = ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if not unicodedata.combining(c))
    return [w for w in re.findall(r'\w+', clean) if len(w)>2 and w not in STOP]


def retrieve(pages, query, count=6):
    terms = set(words(query))
    if not terms: return []
    bags = [Counter(words(p['text'])) for p in pages]
    frequency = Counter(w for bag in bags for w in set(bag) & terms)
    avg = sum(sum(b.values()) for b in bags)/max(1,len(bags)) or 1
    scores = []
    for page, bag in zip(pages, bags):
        length = sum(bag.values()); score = 0
        for word in terms:
            tf = bag.get(word,0)
            if tf:
                idf = math.log(1+(len(bags)-frequency[word]+.5)/(frequency[word]+.5))
                score += idf*tf*2.2/(tf+1.2*(.25+.75*length/avg))
        if score: scores.append((score,page))
    return sorted([p for _,p in sorted(scores,key=lambda pair:(-pair[0],pair[1]['page']))[:count]],key=lambda p:p['page'])


def sanitized_event(ev):
    body={k:v for k,v in ev['data'].items() if k not in ('rawResponse','tutorContext','courseSha256','usage')}
    if ev['kind']=='tutor_reply' and isinstance(body.get('reply'),str):
        body['reply']=unpack_reply(body['reply'],structured=body.get('structured') is False)[0]
    return {'lessonId':ev['lessonId'],'kind':ev['kind'],'data':body}


def build(lib, state, target, selection=None, message='', base_note=None):
    selection = validate(selection) if selection is not None else chosen(state,target)[0]
    defaults(state,target)
    payload={'lesson':None, 'sourcePages':[], 'annotations':[], 'notes':[], 'textSources':selection['texts'], 'recentHistory':[], 'latestAssessmentsByLesson':{}, 'openDoubts':[]}
    manifest={'items':[], 'warnings':[], 'characters':0, 'limit':MAX_CHARS}
    seen=set()
    def add_pages(document_id, requested=None, mode='pages', source_id=None):
        try: doc, pages=all_pages(lib,document_id)
        except ValueError:
            manifest['warnings'].append('La fuente '+document_id+' ya no está disponible.');return
        if requested is not None:
            if doc.get('pages') and any(p>doc['pages'] for p in requested): raise ValueError('Una página solicitada excede el PDF '+doc['title']+'.')
            pages=[p for p in pages if p['page'] in set(requested)]
        elif mode=='search': pages=retrieve(pages,message)
        included=[]
        for p in pages:
            if (document_id,p['page']) in seen: continue
            seen.add((document_id,p['page']));included.append(p['page'])
            payload['sourcePages'].append({'documentId':doc['id'],'sourceId':source_id or doc['id'],'title':doc['title'],'sha256':doc['sha256'],**p})
        manifest['items'].append({'kind':'document','id':doc['id'],'title':doc['title'],'mode':mode,'pages':included,'characters':sum(len(p['text']) for p in pages),'sha256':doc['sha256']})
        if not pages or not any(p['text'].strip() for p in pages):
            manifest['warnings'].append(doc['title']+(': no hubo páginas coincidentes con la consulta. Escribí palabras del tema o elegí páginas.' if mode=='search' else ': no hay texto extraído en esas páginas. Puede necesitar OCR.'))
        elif requested and not set(requested)<={p['page'] for p in pages}:
            manifest['warnings'].append(doc['title']+': algunas páginas solicitadas no tienen texto extraído.')
        elif mode=='all' and doc.get('pages') and len({p['page'] for p in pages})!=doc['pages']:
            manifest['warnings'].append(doc['title']+': el texto extraído no cubre todas las páginas del PDF.')
    if target['kind']=='study':
        course=next(c for c in state['courses'] if c['id']==target['courseId']);lesson=next(l for l in course['lessons'] if l['id']==target['lessonId'])
        payload['courseTitle']=course['title']
        if selection['includeLesson']:
            payload['lesson']=lesson
            manifest['items'].append({'kind':'lesson','id':lesson['id'],'title':lesson['title']})
        if selection['includeBaseSources']:
            references={}
            for block in lesson['blocks']:
                for ref in block.get('references',[]): references.setdefault(ref['sourceId'],set()).add(ref['page'])
            for source_id,pages in references.items():
                source=next((s for s in course.get('sources',[]) if s['id']==source_id),{})
                document_id=source.get('url','').removeprefix('/documents/') if source.get('url','').startswith('/documents/') else source_id
                add_pages(document_id,list(pages),source_id=source_id)
        history=[e for e in state['events'] if e['courseId']==course['id'] and e['data'].get('courseVersion',course['version'])==course['version']]
        if selection['includeHistory']:
            shared=[e for e in history if e['kind'] not in ('annotation','annotation_resolved','visit','study_time','study_session','course_version')]
            payload['recentHistory']=[sanitized_event(e) for e in shared[-70:]]
            for ev in shared:
                if ev['kind']=='assessment':payload['latestAssessmentsByLesson'][ev['lessonId']]=sanitized_event(ev)['data']
        annotation_ids=set(selection['annotationIds'])
        resolved={e['data'].get('annotationId') for e in history if e['kind']=='annotation_resolved'}
        retired=set()
        for ev in history:
            if ev['kind']=='annotation' and ev['id'] in annotation_ids:
                # Removed highlights stay in the full record but are not offered to
                # the tutor, even if an older explicit selection still names them.
                if ev['data'].get('removed'):
                    retired.add(ev['id'])
                    continue
                payload['annotations'].append({'id':ev['id'],**sanitized_event(ev)})
                manifest['items'].append({'kind':'annotation','id':ev['id'],'revision':ev['data'].get('annotationRevision',0),'title':ev['data'].get('comment','')[:100]})
                if ev['id'] not in resolved:payload['openDoubts'].append(ev)
        if annotation_ids-{e['id'] for e in payload['annotations']}-retired:manifest['warnings'].append('Hay anotaciones elegidas que fueron borradas o pertenecen a otra versión o materia.')
        if retired:manifest['warnings'].append('Algunas anotaciones elegidas fueron quitadas del resaltado y no se enviaron. Su historial completo sigue en tu registro.')
    elif base_note is not None:
        payload['noteContext']={k:v for k,v in base_note.items() if k not in ('studentText','quote','sourcePages','sourceWarning')}
        note=next(n for n in state['library']['notes'] if n['id']==target['noteId'])
        if selection['includeBaseNote']:
            anchor=next((a for a in note['anchors'] if a.get('id')==base_note.get('anchorId')),None)
            text=anchor.get('comment','') if anchor else (note.get('pageNotes',{}).get(base_note.get('documentId'),{}).get(str(base_note.get('page')),'') if base_note['scope']=='page' else note['content'])
            payload['noteContext'].update({'studentText':text,'quote':base_note.get('quote','')})
            manifest['items'].append({'kind':'note','id':note['id'],'title':note['title'],'revision':note['revision'],'part':'actual'})
        if selection['includeBaseSources'] and base_note.get('documentId'):add_pages(base_note['documentId'],[base_note['page']])
        if selection['includeHistory']:
            payload['recentHistory']=[{'question':q['message'],'reply':q['reply']} for q in state['library']['noteTutor'] if q['noteId']==note['id'] and q['status']=='answered' and all(q['context'].get(k)==base_note.get(k) for k in ('anchorId','scope','documentId','page'))][-6:]
    for spec in selection['documents']:add_pages(spec['documentId'],spec.get('pages') if spec['mode']=='pages' else None,spec['mode'])
    for item in selection['noteItems']:
        note=next((n for n in state['library']['notes'] if n['id']==item['noteId']),None)
        if not note:manifest['warnings'].append('Un apunte elegido ya no existe.');continue
        content=None
        if item['part']=='general':content=note['content']
        if item['part']=='page':content=note.get('pageNotes',{}).get(item['documentId'],{}).get(str(item['page']))
        if item['part']=='anchor':content=next((a for a in note['anchors'] if (a.get('id')==item['anchorId'] if item.get('anchorId') else a==item.get('legacyAnchor'))),None)
        if content is None:manifest['warnings'].append('Una parte elegida de '+note['title']+' ya no existe.');continue
        payload['notes'].append({**item,'title':note['title'],'revision':note['revision'],'content':content})
        manifest['items'].append({'kind':'note',**item,'title':note['title'],'revision':note['revision']})
    if selection['includePlan']:payload['schedule']={k:state['settings'].get(k) for k in ('examDate','weekdayMinutes','weekendMinutes','dailyOverrides')}
    payload['studentMessage']=message
    manifest['historyCount']=len(payload['recentHistory']);manifest['historyIncluded']=selection['includeHistory']
    payload['contextScope']={'materials':manifest['items'],'historyCount':manifest['historyCount'],'warnings':list(manifest['warnings'])}
    manifest['characters']=len(json.dumps(payload,ensure_ascii=False))
    manifest['tooLarge']=manifest['characters']>MAX_CHARS
    if manifest['characters']>200000:manifest['warnings'].append('Contexto grande: el modelo gratuito puede rechazarlo. Podés elegir páginas o buscar en todo el documento.')
    digest=hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
    return {'selection':selection,'payload':payload,'manifest':manifest,'contextHash':digest}
