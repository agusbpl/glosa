"""Local class notes, optional documents and course drafts shared by UI and MCP."""
from datetime import datetime, timezone
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import uuid

import note_files

# Identidad portable de apuntes externos sin `glosa_id`.
# Un Markdown ajeno (sin frontmatter de Glosa) nunca se reescribe, pero su ID
# igual debe sobrevivir a un renombre/movimiento físico hecho por fuera. El
# sidecar asocia la RUTA RELATIVA (portable, viaja en el respaldo) y una clave
# física (dispositivo:inodo, útil para un rename en el mismo volumen) con el ID
# de la nota. Así dos archivos con el mismo contenido no se colapsan (rutas e
# inodos distintos) y el ID sobrevive a copiar/restaurar aunque cambie el inodo.
# Se versiona: v1 guardaba solo la clave física; v2 agrega la ruta relativa.
IDENTITY_FILE = '.glosa-identidad.json'
IDENTITY_VERSION = 2


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def study_markdown(study):
    """Readable study card for the Markdown export. Returns '' when there is
    nothing to show, so notes without study metadata keep their exact output."""
    if not isinstance(study, dict):
        return ''
    materia = str(study.get('materia') or '').strip()
    unidad = str(study.get('unidad') or '').strip()
    parcial = study.get('parcialDate')
    needs = study.get('needsPractice') is True
    errors = study.get('errors') if isinstance(study.get('errors'), list) else []
    properties = []
    if materia: properties.append('- Materia: ' + materia)
    if unidad: properties.append('- Unidad: ' + unidad)
    if parcial: properties.append('- Fecha del parcial: ' + str(parcial))
    if needs: properties.append('- Necesito practicar: sí')
    if not properties and not errors:
        return ''
    sections = ['## Ficha de estudio']
    if properties:
        sections.append('\n'.join(properties))
    if errors:
        blocks = ['### Errores de parcial']
        for error in errors:
            if not isinstance(error, dict):
                continue
            concept = str(error.get('concept') or '').strip() or 'Error'
            kind = str(error.get('errorType') or '').strip()
            lines = ['- **' + concept + '**' + (' · ' + kind if kind else '')]
            description = str(error.get('description') or '').strip()
            if description: lines.append('  ' + description.replace('\n', '\n  '))
            correction = str(error.get('correction') or '').strip()
            if correction: lines.append('  Corrección: ' + correction.replace('\n', '\n  '))
            created = str(error.get('createdAt') or '').strip()
            if created: lines.append('  ' + created)
            blocks.append('\n'.join(lines))
        sections.append('\n\n'.join(blocks))
    return '\n\n'.join(sections)


def note_markdown(note, documents):
    """One readable Markdown document; pageNotes remains the lossless page index."""
    titles={d['id']:d['title'] for d in documents}
    sections=[note['content']] if note.get('contentFormat') == 'markdown' else ['# '+note['title'],note['content']]
    for doc_id,pages in note.get('pageNotes',{}).items():
        sections.append('## Fuente: '+titles.get(doc_id,doc_id))
        pages={'1':'',**pages}
        for page,text in sorted(pages.items(),key=lambda pair:int(pair[0])):
            sections.append('#'+page+'\n\n'+text)
    for anchor in note.get('anchors',[]):
        sections.append('## '+('Anotación independiente' if anchor.get('scope')=='general' else 'Anotación · pag'+str(anchor['page']))+'\n\n'+('> '+anchor['quote'].replace('\n','\n> ')+'\n\n' if anchor.get('quote') else '')+anchor.get('comment',''))
    study=study_markdown(note.get('study'))
    if study:
        sections.append(study)
    return '\n\n'.join(s for s in sections if s)+'\n'


class Library:
    def __init__(self, db, data, root, notes_dir=None):
        self.db, self.data, self.root = Path(db), Path(data), Path(root)
        # Adaptador configurable: permite fijar la raíz de apuntes sin depender
        # de HOME ni del nombre de la carpeta. Con None se deriva del scope.
        self.notes_dir = Path(notes_dir) if notes_dir is not None else None
        self.note_warnings = []
        self._reconcile_issues = {'invalid': {}, 'duplicate': {}, 'missing': {}}

    def connect(self):
        conn = sqlite3.connect(self.db, timeout=20)
        conn.row_factory = sqlite3.Row
        return conn

    def notes_root(self):
        """Carpeta visible de apuntes originales.

        En una bóveda (`data=…/learning` con `pliego.json` al lado) los apuntes
        viven en `<raíz del pliego>/Apuntes`, navegables desde el explorador de
        archivos. En la biblioteca local aún no trasladada se usa
        `<data>/Apuntes` como respaldo. El agente de bóvedas puede fijar otra
        raíz pasando `notes_dir` al construir la Library.
        """
        if self.notes_dir is not None:
            base = self.notes_dir
        elif self.data.name == 'learning' and (self.data.parent / 'pliego.json').is_file():
            base = self.data.parent / 'Apuntes'
        else:
            base = self.data / 'Apuntes'
        return Path(base)

    def note_file(self, note_id):
        """Ruta del archivo original de un apunte, o None si no está indexado."""
        with self.connect() as conn:
            self._ensure_note_tables(conn)
            row = self._note_index(conn, note_id)
        if not row or not row['path']:
            return None
        return self.notes_root()/row['path']

    def initialize(self, courses):
        with self.connect() as conn:
            conn.executescript('''
            CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS note_versions(id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,revision));
            CREATE TABLE IF NOT EXISTS course_drafts(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS note_tutor(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tutor_contexts(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS note_files(note_id TEXT PRIMARY KEY, path TEXT, sync TEXT, revision INTEGER, origin TEXT, present INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS note_files_meta(key TEXT PRIMARY KEY, value TEXT);
            ''')
            for course in courses:
                for source in course.get('sources', []):
                    if not source.get('url', '').startswith('/sources/'):
                        continue
                    filename = Path(source['url']).name
                    path = self.root / 'sources' / filename
                    if not path.is_file() or path.suffix.lower() != '.pdf':
                        continue
                    body = {'id': source['id'], 'title': source['title'], 'sha256': source.get('sha256') or hashlib.sha256(path.read_bytes()).hexdigest(), 'pages': source.get('pages'), 'storage': 'source', 'filename': filename, 'createdAt': timestamp()}
                    conn.execute('INSERT OR IGNORE INTO documents VALUES(?,?)', (body['id'], json.dumps(body, ensure_ascii=False)))
            # Migración idempotente: cada apunte de SQLite queda como archivo .md
            # original una sola vez (marcador `notes_exported`).
            self._ensure_exported(conn)

    def documents(self):
        with self.connect() as conn:
            return [json.loads(row['body']) for row in conn.execute('SELECT body FROM documents')]

    def snapshot(self):
        # Cambios externos del archivo se reflejan al leer el estado.
        warnings = self.reconcile_notes()
        with self.connect() as conn:
            data={key: [json.loads(row['body']) for row in conn.execute('SELECT body FROM '+table+' ORDER BY rowid')] for key, table in [('documents','documents'), ('notes','notes'), ('noteVersions','note_versions'), ('courseDrafts','course_drafts'), ('noteTutor','note_tutor'), ('tutorContexts','tutor_contexts')]}
        data['deletedNotes']=[n for n in data['notes'] if n.get('deletedAt')]
        data['notes']=[n for n in data['notes'] if not n.get('deletedAt')]
        # La UI no puede ocultar un archivo roto o duplicado: se informa.
        data['noteWarnings']=list(warnings)
        return data

    def document(self, document_id):
        with self.connect() as conn:
            row = conn.execute('SELECT body FROM documents WHERE id=?', (document_id,)).fetchone()
        if not row:
            raise ValueError('Documento inexistente.')
        return json.loads(row['body'])

    def document_path(self, document):
        directory = self.root/'sources' if document['storage']=='source' else self.data/'documents'
        filename = document['filename']
        if Path(filename).name != filename or not filename.endswith('.pdf'):
            raise ValueError('Referencia de documento inválida.')
        return directory/filename

    def pages(self, document_id, start=1, end=None):
        doc = self.document(document_id)
        end = start if end is None else end
        if type(start) is not int or type(end) is not int or start<1 or end<start or end-start>=20:
            raise ValueError('Pedí entre 1 y 20 páginas por consulta.')
        cache = (self.root/'.md_cache'/(document_id+'.json') if doc['storage']=='source' else self.data/'documents'/(document_id+'.json'))
        if not cache.is_file():
            return {'document': doc, 'pages': [], 'warning': 'No hay texto extraído. El agente puede leer el PDF original; un escaneo podría requerir OCR.'}
        data = json.loads(cache.read_text())
        return {'document': doc, 'pages': [p for p in data['pages'] if start<=p['page']<=end]}

    def upload(self, title, encoded):
        if not isinstance(title,str) or not title.strip() or len(title)>200:
            raise ValueError('Indicá un título de documento de hasta 200 caracteres.')
        if not isinstance(encoded,str): raise ValueError('Archivo inválido.')
        try: raw = base64.b64decode(encoded, validate=True)
        except ValueError: raise ValueError('Archivo inválido.') from None
        if not 1<=len(raw)<=20_000_000 or not raw.lstrip().startswith(b'%PDF-'):
            raise ValueError('Adjuntá un PDF de hasta 20 MB.')
        sha = hashlib.sha256(raw).hexdigest()
        with self.connect() as conn:
            for row in conn.execute('SELECT body FROM documents'):
                old=json.loads(row['body'])
                if old['sha256']==sha: return old
        document_id='doc-'+sha[:24]
        directory=self.data/'documents';directory.mkdir(parents=True,exist_ok=True)
        path=directory/(document_id+'.pdf');path.write_bytes(raw)
        cache=directory/(document_id+'.json')
        # self.root holds this pliego's assets, not application executables.
        application=Path(__file__).resolve().parent
        helper=application/'scripts'/'extract_document.py'
        runtime=application/'.venv-author'/'bin'/'python'
        try:
            result=subprocess.run([str(runtime),str(helper),str(path),str(cache)],capture_output=True,text=True,timeout=120)
            if result.returncode: raise ValueError('No se pudo leer el PDF. Probá un archivo sin contraseña y verificá que no esté dañado.')
            pages=json.loads(cache.read_text())['pages']
        except (OSError,subprocess.TimeoutExpired):
            raise ValueError('No se pudo preparar el PDF. Revisá el runtime de documentos en las instrucciones.') from None
        doc={'id':document_id,'title':title.strip(),'sha256':sha,'pages':len(pages),'storage':'upload','filename':path.name,'createdAt':timestamp()}
        with self.connect() as conn:
            conn.execute('INSERT OR IGNORE INTO documents VALUES(?,?)',(document_id,json.dumps(doc,ensure_ascii=False)))
        return self.document(document_id)

    def validate_note(self, note, document_ids=None):
        if not isinstance(note,dict): raise ValueError('Nota inválida.')
        for field,limit in [('title',200),('folder',120),('content',200000)]:
            if not isinstance(note.get(field),str) or len(note[field])>limit:
                raise ValueError('Campo de nota inválido: '+field)
        if not note['title'].strip(): raise ValueError('La nota necesita título.')
        if type(note.get('shared')) is not bool: raise ValueError('Indicá si la nota se comparte con el agente autor.')
        documents={d['id']:d for d in self.snapshot()['documents']} if document_ids is None else document_ids
        doc_id=note.get('documentId')
        if doc_id is not None and doc_id not in documents: raise ValueError('El documento adjunto no existe.')
        page=note.get('page')
        if page is not None and (doc_id is None or type(page) is not int or page<1 or (documents[doc_id].get('pages') and page>documents[doc_id]['pages'])):
            raise ValueError('Página de nota inválida.')
        writing_scope=note.get('writingScope','general')
        if writing_scope not in ('general','page') or (writing_scope=='page' and doc_id is None):
            raise ValueError('Elegí apunte general o por página con un PDF adjunto.')
        page_notes=note.get('pageNotes',{})
        if not isinstance(page_notes,dict): raise ValueError('Apuntes por página inválidos.')
        entries=0;characters=len(note['content'])
        for source_id,notes in page_notes.items():
            if source_id not in documents or not isinstance(notes,dict): raise ValueError('Documento de apuntes por página inválido.')
            for key,text in notes.items():
                if not isinstance(key,str) or not re.fullmatch(r'[1-9][0-9]{0,6}',key) or (documents[source_id].get('pages') and int(key)>documents[source_id]['pages']):
                    raise ValueError('Página de apunte inválida.')
                if not isinstance(text,str) or len(text)>200000: raise ValueError('Texto de apunte por página inválido.')
                entries+=1;characters+=len(text)
        if entries>1000 or characters>2000000: raise ValueError('El apunte supera el límite de páginas o texto.')
        if writing_scope=='page':
            page_notes={source_id:dict(pages) for source_id,pages in page_notes.items()}
            page_notes.setdefault(doc_id,{}).setdefault('1','')
        anchors=note.get('anchors',[])
        if not isinstance(anchors,list) or len(anchors)>1000: raise ValueError('Referencias de nota inválidas.')
        for a in anchors:
            if not isinstance(a,dict) or a.get('scope','page') not in ('page','general') or not isinstance(a.get('quote'),str) or len(a['quote'])>20000:
                raise ValueError('Fragmento de fuente inválido.')
            if a.get('documentId') is None:
                if a.get('scope','page')!='general' or a.get('page') is not None or a.get('sha256') is not None:
                    raise ValueError('Una anotación de página necesita una fuente válida.')
            else:
                if a.get('documentId') not in documents or type(a.get('page')) is not int or a['page']<1 or (documents[a['documentId']].get('pages') and a['page']>documents[a['documentId']]['pages']):
                    raise ValueError('Fragmento de fuente inválido.')
                if a.get('sha256')!=documents[a['documentId']]['sha256']: raise ValueError('La versión del documento no coincide.')
            if not isinstance(a.get('comment',''),str) or len(a.get('comment',''))>20000: raise ValueError('Comentario de fuente inválido.')
            if 'selector' in a:
                selector=a['selector']
                if not isinstance(selector,dict) or type(selector.get('start')) is not int or type(selector.get('end')) is not int or not 0<=selector['start']<selector['end']<=5000000:
                    raise ValueError('Posición de resaltado inválida.')
            if 'rects' in a:
                if not isinstance(a['rects'],list) or not 1<=len(a['rects'])<=1000: raise ValueError('Resaltado de PDF inválido.')
                for rect in a['rects']:
                    if not isinstance(rect,dict) or any(type(rect.get(k)) not in (int,float) or not math.isfinite(rect[k]) or not 0<=rect[k]<=1 for k in ('x','y','width','height')) or rect['width']<=0 or rect['height']<=0 or rect['x']+rect['width']>1.000001 or rect['y']+rect['height']>1.000001:
                        raise ValueError('Resaltado de PDF inválido.')
        normalized={k:note.get(k) for k in ('title','folder','content','shared','documentId','page')} | {'anchors':anchors,'writingScope':writing_scope,'pageNotes':page_notes}
        if 'contentFormat' in note:
            if note['contentFormat'] not in ('body','markdown'): raise ValueError('Formato de apunte inválido.')
            normalized['contentFormat']=note['contentFormat']
        if 'study' in note:
            normalized['study']=self.validate_study(note['study'])
        return normalized

    STUDY_FIELDS=('materia','unidad','parcialDate','needsPractice','errors')
    ERROR_FIELDS=('id','concept','errorType','description','correction','createdAt')
    ERROR_TYPES=('concepto','procedimiento','cálculo','interpretación','aplicación','otro')

    def validate_study(self, study):
        """Personal study metadata kept inside the note so it never invents a
        course, lesson or assessment. Self-reported properties are study help,
        not evidence of mastery."""
        if not isinstance(study,dict): raise ValueError('Metadatos de estudio inválidos.')
        unknown=set(study)-set(self.STUDY_FIELDS)
        if unknown: raise ValueError('Campo de estudio desconocido: '+sorted(unknown)[0])
        materia=study.get('materia','');unidad=study.get('unidad','')
        for value,name in ((materia,'materia'),(unidad,'unidad')):
            if not isinstance(value,str) or len(value)>120: raise ValueError('Campo de estudio inválido: '+name)
        parcial=study.get('parcialDate')
        if parcial is not None:
            if not isinstance(parcial,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',parcial):
                raise ValueError('Fecha de parcial inválida.')
            try: datetime.strptime(parcial,'%Y-%m-%d')
            except ValueError: raise ValueError('Fecha de parcial inválida.') from None
        needs=study.get('needsPractice',False)
        if type(needs) is not bool: raise ValueError('Marca de práctica inválida.')
        errors=study.get('errors',[])
        if not isinstance(errors,list) or len(errors)>500: raise ValueError('Registro de errores inválido.')
        clean=[]
        for error in errors:
            if not isinstance(error,dict): raise ValueError('Error de parcial inválido.')
            unknown=set(error)-set(self.ERROR_FIELDS)
            if unknown: raise ValueError('Campo de error desconocido: '+sorted(unknown)[0])
            values={}
            for field,limit in (('id',100),('concept',200),('errorType',40),('description',20000),('correction',20000),('createdAt',100)):
                value=error.get(field,'')
                if not isinstance(value,str) or len(value)>limit: raise ValueError('Error de parcial inválido: '+field)
                values[field]=value
            if not values['concept'].strip(): raise ValueError('El error de parcial necesita un concepto.')
            if values['errorType'] and values['errorType'] not in self.ERROR_TYPES: raise ValueError('Tipo de error de parcial inválido.')
            clean.append(values)
        return {'materia':materia,'unidad':unidad,'parcialDate':parcial,'needsPractice':needs,'errors':clean}

    # ------------------------------------------------------------------ #
    # Apuntes como archivos Markdown originales
    # ------------------------------------------------------------------ #

    def _ensure_note_tables(self, conn):
        conn.execute('CREATE TABLE IF NOT EXISTS note_files(note_id TEXT PRIMARY KEY, path TEXT, sync TEXT, revision INTEGER, origin TEXT, present INTEGER NOT NULL DEFAULT 1)')
        conn.execute('CREATE TABLE IF NOT EXISTS note_files_meta(key TEXT PRIMARY KEY, value TEXT)')

    def _ensure_exported(self, conn):
        """Exporta a Markdown los apuntes que aún viven solo en SQLite.

        Antes de crear un archivo respeta un original que ya exista en la raíz
        de apuntes y se identifique con la nota (glosa_id en el archivo o el
        sidecar portable). Así, al restaurar un respaldo, un Markdown crudo
        `Uno.md` no se duplica como `Título.md`.
        """
        self._ensure_note_tables(conn)
        row = conn.execute("SELECT value FROM note_files_meta WHERE key='notes_exported'").fetchone()
        if row:
            return
        self._export_missing(conn)
        conn.execute("INSERT OR REPLACE INTO note_files_meta VALUES('notes_exported','1')")

    def _export_missing(self, conn):
        """Escribe el archivo de cada apunte sin original, sin crear duplicados.

        Si ya existe un original que se identifica con la nota (glosa_id o
        sidecar portable), NO se escribe otro archivo con el nombre derivado del
        título: se indexa el original. Si su contenido difiere del respaldo, el
        disco manda (se importa), igual que en cualquier reconciliación.
        """
        root = self.notes_root()
        files = self._scan_files(root)
        by_rel, by_key = self._identity_entries()
        keys = {rel: self._stat_key(path) for rel, path in files.items()}
        parsed = {}
        for rel, path in files.items():
            try:
                parsed[rel] = note_files.read_note_file(path)
            except note_files.NoteFileError:
                parsed[rel] = None
        documents = {row['id']: json.loads(row['body']) for row in conn.execute('SELECT id,body FROM documents')}
        taken = {row['path'] for row in conn.execute('SELECT path FROM note_files WHERE path IS NOT NULL')}
        for item in conn.execute('SELECT body FROM notes ORDER BY rowid'):
            note = json.loads(item['body'])
            if note.get('deletedAt'):
                continue
            row = conn.execute('SELECT * FROM note_files WHERE note_id=?', (note['id'],)).fetchone()
            if row and row['path'] and (root/row['path']).is_file():
                continue
            rel = self._match_original(note['id'], files, keys, by_rel, by_key, parsed, taken)
            if rel and parsed.get(rel) is not None:
                taken.add(rel)
                info = parsed[rel]
                try:
                    candidate = self._note_from_file(info, note, rel, documents)
                except note_files.NoteFileError:
                    # El original tiene formato ilegible: no se duplica ni se
                    # reexporta encima; la reconciliación posterior lo avisa.
                    continue
                if all(note.get(k) == v for k, v in candidate.items() if k != 'revision'):
                    conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                                 (note['id'], rel, info['sync'], note.get('revision') or 1, 'external'))
                else:
                    conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',
                                 (note['id'], note['revision'], json.dumps(note, ensure_ascii=False)))
                    conn.execute('INSERT OR REPLACE INTO notes VALUES(?,?)',
                                 (note['id'], json.dumps(candidate, ensure_ascii=False)))
                    conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                                 (note['id'], rel, info['sync'], candidate['revision'], 'external'))
                continue
            self._write_note_file(conn, note)

    def _match_original(self, note_id, files, keys, by_rel, by_key, parsed, taken):
        """Ruta de un original ya presente que pertenece a `note_id`, o None."""
        for rel in sorted(files):
            if rel in taken:
                continue
            key = keys.get(rel)
            if by_rel.get(rel) == note_id or (key and by_key.get(key) == note_id):
                return rel
            info = parsed.get(rel)
            if info is not None and info['glosa_id'] == note_id:
                return rel
        return None

    def _note_index(self, conn, note_id=None):
        if note_id is None:
            return {row['note_id']: row for row in conn.execute('SELECT * FROM note_files')}
        return conn.execute('SELECT * FROM note_files WHERE note_id=?', (note_id,)).fetchone()

    def _within(self, path, root):
        try:
            resolved = Path(os.path.realpath(path))
            base = Path(os.path.realpath(root))
        except OSError:
            return False
        return resolved == base or base in resolved.parents

    def _stat_key(self, path):
        """Clave física estable frente a rename/move dentro del mismo volumen.

        Usa dispositivo+nodo (no la ruta). Si el sistema de archivos no expone
        un inodo útil, devuelve None y la identidad cae al ID del archivo.
        """
        try:
            stat = os.stat(path)
        except OSError:
            return None
        if not stat.st_ino:
            return None
        return str(stat.st_dev)+':'+str(stat.st_ino)

    def _identity_path(self):
        return self.notes_root()/IDENTITY_FILE

    def _identity_entries(self):
        """Carga el sidecar portable. Devuelve (por_ruta, por_clave).

        v2 guarda `{rel: {id, key}}`: la ruta relativa permite reencontrar el ID
        tras copiar/restaurar (el inodo cambia); la clave física permite
        reconocer un renombre en el mismo volumen. v1 (solo clave) se lee como
        respaldo por inodo para no perder IDs de instalaciones previas.
        """
        try:
            data = json.loads(self._identity_path().read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return {}, {}
        if not isinstance(data, dict) or not isinstance(data.get('files'), dict):
            return {}, {}
        version = data.get('version')
        if version not in (1, IDENTITY_VERSION):
            return {}, {}
        by_rel, by_key = {}, {}
        for name, value in data['files'].items():
            if not isinstance(name, str) or not isinstance(value, dict) or not isinstance(value.get('id'), str):
                continue
            if version == 1:
                by_key[name] = value['id']
                continue
            rel = value.get('rel') if isinstance(value.get('rel'), str) else name
            key = value.get('key')
            if rel:
                by_rel[rel] = value['id']
            if isinstance(key, str) and key:
                by_key[key] = value['id']
        return by_rel, by_key

    def _identity_save(self, entries):
        """Persiste el sidecar portable. `entries`: iterable de (rel, id, key)."""
        root = self.notes_root()
        if root.is_symlink() or not root.is_dir():
            return
        files = {}
        for rel, note_id, key in entries:
            if not isinstance(rel, str) or not rel or not isinstance(note_id, str):
                continue
            item = {'id': note_id}
            if isinstance(key, str) and key:
                item['key'] = key
            files[rel] = item
        payload = {'version': IDENTITY_VERSION, 'files': files}
        text = json.dumps(payload, ensure_ascii=False, sort_keys=True)+'\n'
        try:
            note_files.write_atomic(root/IDENTITY_FILE, text, root)
        except (OSError, note_files.NoteFileError):
            # El sidecar es una ayuda de estabilidad, no la fuente de verdad:
            # si no se puede escribir, no se pierde ni se pisa ningún apunte.
            pass

    def _unique_rel(self, conn, root, rel, note_id):
        taken = {row['path']: row['note_id'] for row in conn.execute('SELECT path,note_id FROM note_files')}

        def free(candidate):
            owner = taken.get(candidate)
            if owner not in (None, note_id):
                return False
            path = root/candidate
            if path.exists() and not path.is_symlink():
                try:
                    # Un archivo existente solo es libre si pertenece a esta nota.
                    # Un Markdown ajeno (sin glosa_id o con otro) NUNCA se pisa,
                    # aunque el título coincida: se usa sufijo ' (2)', ' (3)'…
                    return note_files.read_note_file(path)['glosa_id'] == note_id
                except note_files.NoteFileError:
                    return False
            return True

        if free(rel):
            return rel
        stem, _, ext = rel.rpartition('.')
        n = 2
        while n < 10000:
            candidate = stem+' ('+str(n)+')'+('.'+ext if ext else '')
            if free(candidate):
                return candidate
            n += 1
        raise note_files.NoteFileError('No se pudo asignar un nombre libre al apunte.')

    def _read_note_base(self, *candidates):
        for candidate in candidates:
            if candidate and candidate.is_file() and not candidate.is_symlink():
                try:
                    return note_files.read_note_file(candidate)
                except note_files.NoteFileError:
                    continue
        return None

    def _write_note_file(self, conn, note):
        root = self.notes_root()
        rel = note_files.relative_note_path(note.get('folder'), note.get('title'))
        row = self._note_index(conn, note['id'])
        old_rel = row['path'] if row else None
        old_path = root/old_rel if old_rel else None
        target_rel = self._unique_rel(conn, root, rel, note['id'])
        target = root/target_rel
        base = self._read_note_base(old_path, target)
        # Guarda optimista: los bytes que se van a reemplazar. Si un editor
        # externo cambia el archivo antes del reemplazo, se conserva el suyo.
        if target.is_file() and not target.is_symlink():
            expect = target.read_bytes()
        else:
            expect = note_files.NO_FILE
        text, sync = note_files.render_note_file(note, base)
        try:
            note_files.write_atomic(target, text, root, expect=expect)
        except note_files.NoteConflictError:
            self._preserve_conflict(root, target_rel, text)
            raise ValueError('El archivo del apunte cambió mientras guardaba. No se sobrescribió nada; tu borrador quedó en Apuntes/.glosa-conflictos.')
        if old_rel and old_rel != target_rel:
            self._remove_note_file(root, old_rel)
        origin = row['origin'] if row and row['origin'] else 'glosa'
        conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                     (note['id'], target_rel, sync, note.get('revision') or 1, origin))
        return sync

    def _preserve_conflict(self, root, rel, text):
        """Guarda el borrador que no se pudo escribir, fuera del discovery."""
        try:
            target = root/'.glosa-conflictos'/rel
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            stamp = timestamp().replace(':', '-')
            target = target.with_name(target.stem+' '+stamp+'.md')
            note_files.write_atomic(target, text, root)
        except (OSError, note_files.NoteFileError):
            pass

    def _remove_note_file(self, root, rel):
        path = root/rel
        if path.is_symlink() or not self._within(path, root):
            return
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass

    def _retire_note_file(self, conn, note_id, note=None):
        """Retira el archivo de un apunte eliminado a una papelera oculta.

        Nunca borra el texto sin rastro: lo mueve fuera del discovery para que
        no se reincorpore y quede disponible para recuperar.
        """
        row = self._note_index(conn, note_id)
        if not row or not row['path']:
            conn.execute('DELETE FROM note_files WHERE note_id=?', (note_id,))
            return
        root = self.notes_root()
        path = root/row['path']
        if path.is_file() and not path.is_symlink() and self._within(path, root):
            target = root/'.glosa-eliminados'/row['path']
            try:
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                if target.exists():
                    target = target.with_name(target.stem+' '+timestamp().replace(':', '-')+target.suffix)
                os.replace(path, target)
            except OSError:
                pass
        conn.execute('DELETE FROM note_files WHERE note_id=?', (note_id,))

    def _ensure_note_file(self, conn, note):
        if note.get('deletedAt'):
            return
        row = self._note_index(conn, note['id'])
        path = self.notes_root()/row['path'] if row and row['path'] else None
        if path and path.is_file() and not path.is_symlink():
            return
        self._write_note_file(conn, note)

    def _note_from_file(self, info, previous, rel, documents):
        """Convierte un archivo leído en una nota válida (o error recuperable)."""
        meta = info['meta']
        base = previous or {}
        glosa = info['glosa_id'] is not None
        title = str(meta.get('title') or base.get('title') or note_files.title_from_text(info['content']))[:200]
        if glosa:
            declared = str(meta.get('folder') or '')
            # Si el archivo no está donde su frontmatter dice (lo movieron a
            # mano), manda la ubicación real para no recrear un duplicado.
            folder = declared if note_files.relative_note_path(declared, title) == rel else note_files.folder_from_path(rel)
        else:
            folder = note_files.folder_from_path(rel)
        scope = meta.get('writingScope') if glosa else 'general'
        if scope not in note_files.WRITING_SCOPES:
            scope = 'general'
        candidate = {
            'title': title or 'Apunte',
            'folder': folder,
            'content': info['content'],
            'shared': bool(meta.get('shared', base.get('shared', False))),
            'documentId': meta.get('documentId') if glosa else None,
            'page': meta.get('page') if glosa else None,
            'writingScope': scope,
            'pageNotes': info.get('pageNotes') or {},
            'anchors': info['extras'].get('anchors') or [],
            'id': base.get('id'),
            'createdAt': meta.get('createdAt') or base.get('createdAt') or timestamp(),
            # El archivo guarda updatedAt: reindexar tras perder SQLite no cambia
            # la nota. Un cambio externo se registra por revisión, no por mtime.
            'updatedAt': meta.get('updatedAt') or base.get('updatedAt') or timestamp(),
        }
        if 'study' in info['extras']:
            candidate['study'] = info['extras']['study']
        fmt = meta.get('contentFormat') if glosa else 'markdown'
        # `contentFormat` solo se guarda cuando aporta algo: si fuera 'body' por
        # defecto, reindexar el archivo agregería un campo que la nota no tenía.
        if fmt in note_files.MODES and (fmt != 'body' or 'contentFormat' in base):
            candidate['contentFormat'] = fmt
        stored = info['revision']
        previous_revision = base.get('revision') or 0
        candidate['revision'] = stored if isinstance(stored, int) and stored > previous_revision else previous_revision+1
        try:
            clean = self.validate_note(candidate, documents)
        except ValueError as exc:
            raise note_files.NoteFileError('No se pudo interpretar el apunte: '+str(exc)) from None
        # validate_note normaliza el contenido; ID y revisiones viven en SQLite.
        clean.update({'id': candidate['id'], 'createdAt': candidate['createdAt'],
                      'updatedAt': candidate['updatedAt'], 'revision': candidate['revision']})
        return clean

    def _adopt_file(self, conn, note, path, row, documents, warnings):
        rel = path.relative_to(self.notes_root()).as_posix()
        info = note_files.read_note_file(path)
        if row['sync'] == info['sync'] and row['path'] == rel and row['present']:
            return
        if note.get('deletedAt'):
            warnings.append(rel+': hay un archivo para un apunte eliminado; no se resucita.')
            return
        candidate = self._note_from_file(info, note, rel, documents)
        conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',
                     (note['id'], note['revision'], json.dumps(note, ensure_ascii=False)))
        conn.execute('INSERT OR REPLACE INTO notes VALUES(?,?)',
                     (note['id'], json.dumps(candidate, ensure_ascii=False)))
        conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                     (note['id'], rel, info['sync'], candidate['revision'], row['origin'] or 'glosa'))

    def _adopt_new_file(self, conn, rel, path, documents, warnings, taken, info=None, stable_id=None):
        if rel in taken:
            return
        if info is None:
            info = note_files.read_note_file(path)
        note_id = info['glosa_id'] or stable_id or ('note-'+hashlib.sha256(rel.encode('utf-8')).hexdigest()[:24])
        existing = conn.execute('SELECT body FROM notes WHERE id=?', (note_id,)).fetchone()
        if existing:
            note = json.loads(existing['body'])
            if note.get('deletedAt'):
                warnings.append(rel+': apunte eliminado; el archivo no se reincorpora.')
                taken.add(rel)
                return
            # Índice perdido o archivo movido de una nota conocida: se reindexa
            # adoptando el contenido del archivo (la fuente es el .md).
            candidate = self._note_from_file(info, note, rel, documents)
            if candidate != note:
                conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',
                             (note_id, note['revision'], json.dumps(note, ensure_ascii=False)))
                conn.execute('INSERT OR REPLACE INTO notes VALUES(?,?)',
                             (note_id, json.dumps(candidate, ensure_ascii=False)))
            conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                         (note_id, rel, info['sync'], candidate['revision'], 'glosa'))
            taken.add(rel)
            return
        candidate = self._note_from_file(info, {'id': note_id}, rel, documents)
        conn.execute('INSERT INTO notes VALUES(?,?)', (note_id, json.dumps(candidate, ensure_ascii=False)))
        conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                     (note_id, rel, info['sync'], candidate['revision'], 'external'))
        taken.add(rel)
        warnings.append(rel+': apunte externo adoptado con ID '+note_id+'.')

    def _soft_delete_missing(self, conn, note, rel, warnings):
        conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',
                     (note['id'], note['revision'], json.dumps(note, ensure_ascii=False)))
        updated = {**note, 'deletedAt': timestamp(), 'deletedReason': 'archivo eliminado fuera de Glosa',
                   'revision': note['revision']+1}
        conn.execute('INSERT OR REPLACE INTO notes VALUES(?,?)',
                     (note['id'], json.dumps(updated, ensure_ascii=False)))
        conn.execute('UPDATE note_files SET present=0, path=? WHERE note_id=?', (rel, note['id']))
        warnings.append(rel+': el archivo se eliminó fuera de Glosa; la nota queda en eliminados y no se recrea.')

    def reconcile_notes(self):
        """Sincroniza SQLite con los archivos .md: cambios, altas y bajas externas."""
        with self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self._ensure_note_tables(conn)
            self._ensure_exported(conn)
            warnings = self._reconcile(conn)
        self.note_warnings = warnings
        return warnings

    def _scan_files(self, root):
        files = {}
        if root.is_symlink() or not root.is_dir():
            return files
        for base, dirs, names in os.walk(root, followlinks=False):
            dirs[:] = [d for d in dirs if not d.startswith('.') and not (Path(base)/d).is_symlink()]
            for name in names:
                if name.startswith('.') or not name.lower().endswith('.md'):
                    continue
                path = Path(base)/name
                if path.is_symlink():
                    continue
                files[path.relative_to(root).as_posix()] = path
        return files

    def _reconcile(self, conn):
        warnings = []
        issues = {'invalid': {}, 'duplicate': {}, 'missing': {}}
        self._reconcile_issues = issues
        root = self.notes_root()
        if root.is_symlink():
            warnings.append('La carpeta de apuntes es un enlace simbólico; no se siguen enlaces.')
            return warnings
        if not root.is_dir():
            return warnings
        documents = {row['id']: json.loads(row['body']) for row in conn.execute('SELECT id,body FROM documents')}
        notes = {row['id']: json.loads(row['body']) for row in conn.execute('SELECT id,body FROM notes')}
        rows = self._note_index(conn)
        files = self._scan_files(root)
        by_rel, by_key = self._identity_entries()
        keys = {rel: self._stat_key(path) for rel, path in files.items()}
        # Parsear cada archivo una vez y agrupar por glosa_id.
        parsed = {}
        by_id = {}
        for rel, path in files.items():
            try:
                info = note_files.read_note_file(path)
            except note_files.NoteFileError as exc:
                parsed[rel] = ('error', str(exc))
                continue
            parsed[rel] = ('ok', info)
            if info['glosa_id']:
                by_id.setdefault(info['glosa_id'], []).append(rel)
        # Un mismo glosa_id en dos archivos: no adoptar uno arbitrariamente.
        duplicate_ids = {gid: sorted(rels) for gid, rels in by_id.items() if len(rels) > 1}
        for gid, rels in duplicate_ids.items():
            warnings.append('Hay '+str(len(rels))+' archivos con el mismo ID ('+gid+'): '+', '.join(rels)+'. No se adoptó ninguno para no sobrescribir.')
        taken = set()
        missing = []
        for note_id, row in rows.items():
            note = notes.get(note_id)
            if note is None:
                conn.execute('DELETE FROM note_files WHERE note_id=?', (note_id,))
                continue
            if note_id in duplicate_ids:
                issues['duplicate'][note_id] = duplicate_ids[note_id]
                if row['path']:
                    taken.add(row['path'])
                continue
            rel = row['path']
            target = files.get(rel) if rel else None
            if target is None:
                rel = self._find_rel(files, taken, note_id, parsed, keys, by_rel, by_key)
                target = files.get(rel) if rel else None
            if target is None:
                missing.append((note, row['path'] or rel or note_id))
                continue
            taken.add(rel)
            kind, info = parsed[rel]
            if kind == 'error':
                issues['invalid'][note_id] = rel
                warnings.append(rel+': '+info)
                continue
            try:
                self._adopt_file(conn, note, target, row, documents, warnings)
            except note_files.NoteFileError as exc:
                issues['invalid'][note_id] = rel
                warnings.append(rel+': '+str(exc))
        for rel in sorted(files):
            if rel in taken:
                continue
            kind, info = parsed[rel]
            if kind == 'error':
                warnings.append(rel+': '+info)
                continue
            if info['glosa_id'] and info['glosa_id'] in duplicate_ids:
                continue
            stable_id = None
            if not info['glosa_id']:
                key = keys.get(rel)
                stable_id = by_rel.get(rel) or (by_key.get(key) if key else None)
            try:
                self._adopt_new_file(conn, rel, files[rel], documents, warnings, taken, info, stable_id)
            except note_files.NoteFileError as exc:
                warnings.append(rel+': '+str(exc))
        # Si la carpeta de apuntes no existe, ya se salió arriba sin borrar nada.
        # Si existe, la ausencia de un archivo es un borrado externo real.
        for note, rel in missing:
            if not note.get('deletedAt'):
                self._soft_delete_missing(conn, note, rel, warnings)
                issues['missing'][note['id']] = rel
        # Actualizar el sidecar de identidad con los apuntes externos vigentes:
        # conserva el ID frente a renombres/movimientos físicos y lo mantiene
        # portable en el respaldo (la ruta relativa viaja; el inodo cambia al
        # copiar). Los apuntes con `glosa_id` no lo necesitan (su identidad
        # viaja dentro del archivo).
        path_to_id = {}
        for row in conn.execute('SELECT note_id,path,present FROM note_files'):
            if row['present'] and row['path']:
                path_to_id.setdefault(row['path'], row['note_id'])
        entries = {}
        for rel, (kind, info) in parsed.items():
            if kind != 'ok' or info['glosa_id'] is not None:
                continue
            note_id = path_to_id.get(rel)
            if rel and note_id:
                entries[rel] = note_id
        if entries or by_rel:
            unchanged = (set(entries) == set(by_rel)
                         and all(entries[rel] == by_rel.get(rel) for rel in entries))
            if not unchanged:
                self._identity_save((rel, note_id, keys.get(rel)) for rel, note_id in entries.items())
        return warnings

    def _find_rel(self, files, taken, note_id, parsed=None, keys=None, by_rel=None, by_key=None):
        by_rel = by_rel or {}
        by_key = by_key or {}
        for rel in sorted(files):
            if rel in taken:
                continue
            info = None
            if parsed is not None:
                kind, info = parsed.get(rel, (None, None))
                if kind != 'ok':
                    info = None
            if info is None:
                try:
                    info = note_files.read_note_file(files[rel])
                except note_files.NoteFileError:
                    continue
            if info['glosa_id'] == note_id:
                return rel
            key = keys.get(rel) if keys else None
            if by_rel.get(rel) == note_id or (key and by_key.get(key) == note_id):
                return rel
        return None

    def migrate_notes_to_files(self, dry_run=False):
        """Migra SQLite → archivos .md de forma idempotente y sin pérdida.

        Método explícito para que el agente de bóvedas lo invoque sobre copias
        temporales antes de aplicar el traslado real. Con `dry_run=True` solo
        devuelve el plan (no escribe ni crea nada). El plan es read-only y no
        muta el esquema.
        """
        plan = self._migration_plan()
        if dry_run:
            return plan
        documents = {d['id']: d for d in self.documents()}
        warnings = []
        with self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self._ensure_note_tables(conn)
            # Reconciliar ANTES de decidir qué exportar: registra ediciones
            # externas y marca como eliminado un apunte cuyo archivo se borró
            # afuera. Sin esto, la migración resucitaría el borrado reexportando
            # desde SQLite (bug B2).
            warnings.extend(self._reconcile(conn))
            existing = self._note_index(conn)
            for item in conn.execute('SELECT body FROM notes ORDER BY rowid'):
                note = json.loads(item['body'])
                if note.get('deletedAt'):
                    if note['id'] in existing:
                        self._retire_note_file(conn, note['id'])
                    continue
                row = existing.get(note['id'])
                path = None
                if row and row['path']:
                    path = self.notes_root()/row['path']
                if path is not None and path.is_file() and not path.is_symlink():
                    try:
                        info = note_files.read_note_file(path)
                    except note_files.NoteFileError as exc:
                        # Formato roto: JAMÁS reexportar sobre el archivo.
                        warnings.append(row['path']+': '+str(exc)+' (no se reexportó)')
                        continue
                    if info['sync'] == row['sync']:
                        continue
                    # El archivo cambió externamente: importarlo, no pisarlo.
                    candidate = self._note_from_file(info, note, row['path'], documents)
                    conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',
                                 (note['id'], note['revision'], item['body']))
                    conn.execute('INSERT OR REPLACE INTO notes VALUES(?,?)',
                                 (note['id'], json.dumps(candidate, ensure_ascii=False)))
                    conn.execute('INSERT OR REPLACE INTO note_files VALUES(?,?,?,?,?,1)',
                                 (note['id'], row['path'], info['sync'], candidate['revision'], row['origin'] or 'glosa'))
                    warnings.append(row['path']+': se importó la edición externa.')
                    continue
                # Sin archivo: exportar desde SQLite.
                self._write_note_file(conn, note)
            conn.execute("INSERT OR REPLACE INTO note_files_meta VALUES('notes_exported','1')")
        self.note_warnings = warnings
        return plan

    def _migration_plan(self):
        """Plan read-only: no crea la DB, tablas ni directorios."""
        root = self.notes_root()
        plan = {'notes_root': str(root), 'notes': []}
        if not self.db.is_file():
            return plan
        conn = sqlite3.connect('file:'+str(self.db)+'?mode=ro', uri=True)
        conn.row_factory = sqlite3.Row
        try:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if 'notes' not in tables:
                return plan
            index = {}
            if 'note_files' in tables:
                index = {row['note_id']: row for row in conn.execute('SELECT * FROM note_files')}
            for item in conn.execute('SELECT body FROM notes ORDER BY rowid'):
                note = json.loads(item['body'])
                entry = {'id': note['id'], 'title': note.get('title'), 'folder': note.get('folder') or ''}
                if note.get('deletedAt'):
                    entry['action'] = 'skip-deleted'
                else:
                    row = index.get(note['id'])
                    if row and row['path']:
                        path = root/row['path']
                        if path.is_file() and not path.is_symlink():
                            try:
                                info = note_files.read_note_file(path)
                            except note_files.NoteFileError as exc:
                                entry.update({'action': 'conflict-invalid', 'path': row['path'], 'detail': str(exc)})
                            else:
                                if info['sync'] == row['sync']:
                                    entry.update({'action': 'present', 'path': row['path']})
                                else:
                                    entry.update({'action': 'import-external', 'path': row['path']})
                        else:
                            entry.update({'action': 'export',
                                          'path': note_files.relative_note_path(note.get('folder'), note.get('title'))})
                    else:
                        entry.update({'action': 'export',
                                      'path': note_files.relative_note_path(note.get('folder'), note.get('title'))})
                plan['notes'].append(entry)
        finally:
            conn.close()
        return plan

    def save_note(self, body):
        documents = {d['id']: d for d in self.documents()}
        note = self.validate_note(body, documents)
        note_id = body.get('id') or str(uuid.uuid4())
        if not isinstance(note_id, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', note_id):
            raise ValueError('ID de nota inválido.')
        # Reconciliar la identidad del archivo (movido, editado, borrado o roto)
        # antes de escribir, y persistir esa reconciliación aunque el guardado
        # luego falle: nunca se pisa texto externo ni se resucita una nota.
        self.reconcile_notes()
        issues = self._reconcile_issues
        with self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self._ensure_note_tables(conn)
            self._ensure_exported(conn)
            row = conn.execute('SELECT body FROM notes WHERE id=?', (note_id,)).fetchone()
            old = json.loads(row['body']) if row else None
            if note_id in issues['duplicate']:
                raise ValueError('Hay más de un archivo con el mismo ID de apunte; no se guardó para no sobrescribir ninguno. Revisá Apuntes/.')
            if note_id in issues['invalid']:
                raise ValueError('El archivo del apunte ('+issues['invalid'][note_id]+') tiene un formato que Glosa no puede interpretar. No se sobrescribió; corregí el archivo o copiá el texto a un apunte nuevo.')
            if old and old.get('deletedAt'):
                raise ValueError('El apunte fue eliminado. El borrador local está conservado; copiá su texto en un apunte nuevo.')
            if old and body.get('revision') != old['revision']:
                raise ValueError('La nota cambió en otra ventana o en el archivo. El borrador local está conservado; recargá antes de guardarlo.')
            if old and all(old.get(k) == v for k, v in note.items()):
                self._ensure_note_file(conn, old)
                return old
            if old:
                conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)', (note_id, old['revision'], row['body']))
            note.update({'id': note_id, 'createdAt': old['createdAt'] if old else timestamp(),
                         'updatedAt': timestamp(), 'revision': old['revision']+1 if old else 1})
            # El archivo se escribe antes de la fila: si el proceso cae en el
            # medio, la próxima lectura adopta el contenido del archivo sin perderlo.
            self._write_note_file(conn, note)
            conn.execute('INSERT OR REPLACE INTO notes VALUES(?,?)', (note_id, json.dumps(note, ensure_ascii=False)))
        return note

    def delete_note(self, body):
        note_id = body.get('id')
        if not isinstance(note_id, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', note_id):
            raise ValueError('ID de nota inválido.')
        # No retirar una edición externa reciente sin avisar: reconciliar antes
        # de validar la revisión del cliente.
        self.reconcile_notes()
        issues = self._reconcile_issues
        with self.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self._ensure_note_tables(conn)
            row = conn.execute('SELECT body FROM notes WHERE id=?', (note_id,)).fetchone()
            if not row:
                raise ValueError('Apunte inexistente.')
            note = json.loads(row['body'])
            if note_id in issues['duplicate']:
                raise ValueError('Hay más de un archivo con el mismo ID de apunte; no se eliminó nada. Revisá Apuntes/.')
            if note_id in issues['invalid']:
                raise ValueError('El archivo del apunte tiene un formato que Glosa no puede interpretar. No se eliminó; corregí el archivo primero.')
            if not note.get('deletedAt'):
                if type(body.get('revision')) is not int or body['revision'] != note['revision']:
                    raise ValueError('La nota cambió en otra ventana. Recargá antes de eliminarla.')
                # Preserve IDs, versions and tutor evidence; a stale autosave must
                # never bring a deleted note back into the active list.
                conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)', (note_id, note['revision'], row['body']))
                note = {**note, 'deletedAt': timestamp(), 'revision': note['revision']+1}
                conn.execute('UPDATE notes SET body=? WHERE id=?', (json.dumps(note, ensure_ascii=False), note_id))
            self._retire_note_file(conn, note_id)
        return {'id': note_id, 'deletedAt': note['deletedAt']}

    def save_draft(self, course, rationale, validate):
        validate(course)
        from assessment_rules import audit
        findings=audit(course)['findings']
        if findings:
            raise ValueError('Revisá las preguntas antes de guardar: '+json.dumps(findings,ensure_ascii=False))
        if not isinstance(rationale,str) or not rationale.strip() or len(rationale)>20000:
            raise ValueError('Explicá las fuentes, notas y criterios que motivan este curso.')
        draft={'id':str(uuid.uuid4()),'createdAt':timestamp(),'course':course,'rationale':rationale,'status':'draft'}
        with self.connect() as conn:
            conn.execute('INSERT INTO course_drafts VALUES(?,?)',(draft['id'],json.dumps(draft,ensure_ascii=False)))
        return {'id':draft['id'],'title':course['title'],'status':'draft','message':'Borrador legado conservado. Para una entrega nueva, creá un pliego completo con create_study_pliego y abrilo desde GLOSA → Margen.'}

    def draft(self, draft_id):
        with self.connect() as conn:
            row=conn.execute('SELECT body FROM course_drafts WHERE id=?',(draft_id,)).fetchone()
        if not row: raise ValueError('Borrador inexistente.')
        return json.loads(row['body'])

    def author_context(self, folder=''):
        data=self.snapshot()
        notes=[n for n in data['notes'] if n['shared'] and (not folder or n['folder']==folder)]
        ids={n['id'] for n in notes}
        return {'notes':notes,'noteTutor':[q for q in data['noteTutor'] if q['noteId'] in ids], 'documents':data['documents'],'scope':'Solo notas actuales compartidas y sus consultas al tutor. Las notas privadas y sus versiones no se incluyen. Las respuestas del tutor son ayudas, nunca evidencia de dominio independiente. Los PDFs se consultan por páginas o leyendo su archivo local. No hay llamadas a modelos.'}

    def validate_backup(self, data):
        if not isinstance(data,dict): raise ValueError('Biblioteca del respaldo inválida.')
        for key in ('documents','notes','deletedNotes','noteVersions','courseDrafts','noteTutor','tutorContexts'):
            if not isinstance(data.get(key,[]),list): raise ValueError('Biblioteca del respaldo inválida.')
        docs={d['id']:d for d in self.documents()}
        for d in data.get('documents',[]):
            if not isinstance(d,dict) or not isinstance(d.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',d['id']) or not isinstance(d.get('title'),str) or not isinstance(d.get('sha256'),str) or not re.fullmatch(r'[0-9a-f]{64}',d['sha256']) or d.get('storage') not in ('source','upload'):
                raise ValueError('Documento del respaldo inválido.')
            self.document_path(d)
            if d['id'] in docs and docs[d['id']]['sha256']!=d['sha256']: raise ValueError('Documento local distinto del respaldo.')
            docs[d['id']]=d
        for n in data.get('notes',[])+data.get('deletedNotes',[])+data.get('noteVersions',[]):
            self.validate_note(n,docs)
            if not isinstance(n.get('id'),str) or type(n.get('revision')) is not int or n['revision']<1: raise ValueError('Versión de nota inválida.')
        local=self.snapshot()
        notes={n['id'] for n in local['notes']+local['deletedNotes']+data.get('notes',[])+data.get('deletedNotes',[])}
        for q in data.get('noteTutor',[]):
            if not isinstance(q,dict) or not isinstance(q.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',q['id']) or q.get('noteId') not in notes or q.get('status') not in ('pending','answered','failed') or q.get('helpProvided') is not True:
                raise ValueError('Consulta al tutor del respaldo inválida.')
            for k,limit in [('message',20000),('reply',100000),('error',2000),('createdAt',100)]:
                if not isinstance(q.get(k,''),str) or len(q.get(k,''))>limit: raise ValueError('Texto de consulta inválido.')
            context=q.get('context')
            if not isinstance(context,dict) or context.get('scope') not in ('page','general') or type(context.get('noteRevision')) is not int or context['noteRevision']<1:
                raise ValueError('Contexto de consulta inválido.')
            if context.get('documentId') is not None:
                doc=docs.get(context['documentId'])
                if not doc or context.get('sha256')!=doc['sha256'] or type(context.get('page')) is not int or context['page']<1 or (doc.get('pages') and context['page']>doc['pages']): raise ValueError('Fuente de consulta inválida.')
            elif context.get('scope')=='page' or context.get('page') is not None: raise ValueError('Página de consulta inválida.')
        import tutor_context
        for record in data.get('tutorContexts',[]):
            if not isinstance(record,dict) or record.get('id')!=tutor_context.target_key(record.get('target')) or type(record.get('revision')) is not int or record['revision']<1:
                raise ValueError('Preferencia de contexto inválida.')
            tutor_context.validate(record.get('selection'))
        return data

    def restore(self, conn, data):
        def archive(note):
            existing=conn.execute('SELECT body FROM note_versions WHERE id=? AND revision=?',(note['id'],note['revision'])).fetchone()
            if existing and json.loads(existing['body'])!=note:
                raise ValueError('Una versión anterior local difiere de la misma revisión del respaldo.')
            conn.execute('INSERT OR IGNORE INTO note_versions VALUES(?,?,?)',(note['id'],note['revision'],json.dumps(note,ensure_ascii=False)))
        for key,table in [('documents','documents'),('notes','notes'),('courseDrafts','course_drafts')]:
            for item in data.get(key,[])+(data.get('deletedNotes',[]) if key=='notes' else []):
                row=conn.execute('SELECT body FROM '+table+' WHERE id=?',(item['id'],)).fetchone()
                if not row: conn.execute('INSERT INTO '+table+' VALUES(?,?)',(item['id'],json.dumps(item,ensure_ascii=False)))
                elif key=='notes' and json.loads(row['body'])!=item:
                    # Restore merges the archived revision, never overwrites newer local work.
                    existing=json.loads(row['body'])
                    if item['revision']==existing['revision']: raise ValueError('Una nota local difiere del respaldo con la misma revisión.')
                    archive(item)
        for n in data.get('noteVersions',[]):
            archive(n)
        for q in data.get('noteTutor',[]):
            row=conn.execute('SELECT body FROM note_tutor WHERE id=?',(q['id'],)).fetchone()
            if row and json.loads(row['body'])!=q: raise ValueError('Una consulta local al tutor difiere del respaldo.')
            conn.execute('INSERT OR IGNORE INTO note_tutor VALUES(?,?)',(q['id'],json.dumps(q,ensure_ascii=False)))
        for record in data.get('tutorContexts',[]):
            # A backup never silently replaces a newer local context selection.
            row=conn.execute('SELECT body FROM tutor_contexts WHERE id=?',(record['id'],)).fetchone()
            if row and json.loads(row['body'])['revision']==record['revision'] and json.loads(row['body'])!=record:
                raise ValueError('Una preferencia local de contexto difiere del respaldo con la misma revisión.')
            conn.execute('INSERT OR IGNORE INTO tutor_contexts VALUES(?,?)',(record['id'],json.dumps(record,ensure_ascii=False)))
        # Tras restaurar, cada apunte vuelve a existir como archivo Markdown
        # original (idempotente: solo escribe lo que falte).
        conn.execute("DELETE FROM note_files_meta WHERE key='notes_exported'")
        self._ensure_exported(conn)
