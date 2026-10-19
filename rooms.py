"""Separate local study rooms (vaults); the registry belongs to the installation, not Git."""
import base64
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import threading
import time
import unicodedata
import uuid
import zipfile

LOCK = threading.RLock()
TUTORIAL_ID = 'primer-trazo'
LOCAL_ID = 'local'
# Hidden marker written by the migration script when the local library is moved
# into a visible vault. It keeps the stable id 'local' while the physical home
# changes; without it, 'local' keeps using the application data directory.
LOCAL_ALIAS_FILE = 'local-migrated.json'
# Per-installation switch: while this file exists (regular file, no symlink) the
# local library is retired. It lives in the data directory, never in Git, so each
# installation decides: `{"retired": false}` pauses the retirement without
# deleting the file. With the flag, 'local' resolves to the tutorial and neither
# the legacy library nor its marker warnings are surfaced.
LOCAL_RETIRED_FILE = 'local-retired.json'
# Legacy default used before vaults became visible: <data>/margen. It is still
# scanned so pre-migration vaults never disappear from discovery.
LEGACY_MARGEN = 'margen'
DEFAULT_MARGEN_NAME = 'Margen'
# Windows-reserved device names, refused so a vault folder can travel safely.
RESERVED_NAMES = frozenset(
    ['CON', 'PRN', 'AUX', 'NUL'] + [f'COM{n}' for n in range(1, 10)] + [f'LPT{n}' for n in range(1, 10)])
CONTENTS_QUERIES = (('courses', 'SELECT count(*) FROM courses'),
                    ('documents', 'SELECT count(*) FROM documents'),
                    ('notes', 'SELECT count(*) FROM notes'),
                    ('events', 'SELECT count(*) FROM events'),
                    ('conversation', "SELECT count(*) FROM events WHERE kind IN ('chat_message','tutor_reply')"))


def margen(data, create=True):
    """Resolve the visible Margen folder: environment > saved setting > ~/Margen.

    Tests must set GLOSA_MARGEN_DIR to a temporary folder (or patch HOME), so
    the default never writes into a real HOME. When the default is chosen the
    folder is created (`create=True`); read-only callers (a dry-run plan) pass
    `create=False` so describing the migration never touches the disk.
    """
    config = Path(data)/'margen.json'
    saved = json.loads(config.read_text()).get('path') if config.exists() else None
    configured = os.environ.get('GLOSA_MARGEN_DIR')
    if configured:
        source, path = 'environment', Path(configured)
    elif saved:
        source, path = 'settings', Path(saved)
    else:
        source, path = 'default', Path.home()/DEFAULT_MARGEN_NAME
    path = path.expanduser().resolve()
    if source == 'default' and create:
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
    return {'path': str(path), 'source': source}


def set_margen(data, folder):
    if os.environ.get('GLOSA_MARGEN_DIR'):
        raise ValueError('El Margen está definido por GLOSA_MARGEN_DIR; cambiá esa variable para elegir otro.')
    if not isinstance(folder, str) or not folder.strip() or not Path(folder).expanduser().is_absolute():
        raise ValueError('Indicá la ruta absoluta de una carpeta existente.')
    path = Path(folder).expanduser().resolve()
    if not path.is_dir():
        raise ValueError('La carpeta del Margen no existe.')
    with LOCK:
        pending = Path(data)/'margen.json.tmp'
        pending.write_text(json.dumps({'path': str(path)}, ensure_ascii=False)+'\n')
        pending.replace(Path(data)/'margen.json')
    return margen(data)


def safe_folder_name(title):
    """Human, portable folder name derived from a title (never from content).

    Keeps letters, digits and spaces, drops path separators and control
    characters, normalises Unicode, trims dots/spaces and caps the length. It is
    only a folder name: the stable ID always lives inside `pliego.json`.
    """
    text = unicodedata.normalize('NFC', str(title or '')).replace('\u0000', '')
    text = re.sub(r'[\x00-\x1f\x7f]', '', text)
    text = re.sub(r'[\\/:*?"<>|]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip(' .')
    if not text:
        text = 'Materia'
    text = text[:80].strip(' .')
    if not text:
        text = 'Materia'
    if text.upper() in RESERVED_NAMES:
        text += ' (materia)'
    return text


def _unique_folder(directory, name, extra=()):
    """Return a free path inside `directory`; collisions get a numeric suffix."""
    directory = Path(directory)
    taken = {str(entry.name).casefold() for entry in (list(directory.iterdir()) if directory.is_dir() else [])}
    taken |= {str(value).casefold() for value in extra}
    candidate = name
    number = 2
    while candidate.casefold() in taken or (directory/candidate).exists():
        candidate = f'{name} ({number})'
        number += 1
        if number > 9999:
            raise ValueError('No se pudo encontrar un nombre libre en la carpeta del Margen.')
    return directory/candidate


def _scan_folder(folder, entries, backups, residents, warnings):
    """One Margen subfolder. Raises ValueError with a readable reason."""
    metadata = folder/'pliego.json'
    if metadata.is_file():
        if metadata.is_symlink() or metadata.stat().st_size > 16_000:
            raise ValueError('Metadatos inválidos.')
        item = json.loads(metadata.read_text())
        if item.get('format') != 'glosa-pliego' or item.get('version') != 1 or not isinstance(item.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', item['id']) or item['id'] == TUTORIAL_ID:
            raise ValueError('Identificador o formato inválido.')
        if not isinstance(item.get('title'), str) or not item['title'].strip() or len(item['title']) > 200:
            raise ValueError('Título inválido.')
        if any(p.is_symlink() for p in (folder/'learning', folder/'learning/learning.sqlite3', folder/'assets')) or not (folder/'learning/learning.sqlite3').is_file() or not (folder/'assets').is_dir():
            raise ValueError('Faltan los datos del pliego o contienen enlaces simbólicos.')
        entries.append({'id': item['id'], 'title': item['title'], 'path': str(folder)})
    elif (folder/'manifest.json').is_file() and (folder/'snapshot.json').is_file():
        backups.append({'title': folder.name, 'folder': str(folder)})
    elif (folder/'learning'/'learning.sqlite3').is_file():
        # A leftover of a moved vault or a hand-made folder: surfaced, never opened.
        residents.append(str(folder))


def _contents(database):
    """Read-only counts for one vault; a busy or older database yields None values."""
    if database.is_symlink() or not database.is_file():
        return None
    try:
        connection = sqlite3.connect(database.resolve().as_uri()+'?mode=ro', uri=True, timeout=2)
    except (sqlite3.Error, OSError):
        return None
    counts = {}
    try:
        for key, query in CONTENTS_QUERIES:
            try:
                counts[key] = connection.execute(query).fetchone()[0]
            except sqlite3.Error:
                counts[key] = None
        return counts if any(value is not None for value in counts.values()) else None
    finally:
        connection.close()


def _footprint(folder):
    """Count PDFs and bytes by walking the folder; symlinks are skipped, never followed."""
    pdfs, total, modified = 0, 0, 0.0
    for base, _dirs, files in os.walk(folder):
        for name in files:
            entry = Path(base)/name
            if entry.is_symlink():
                continue
            try:
                stat = entry.stat()
            except OSError:
                continue
            total += stat.st_size
            modified = max(modified, stat.st_mtime)
            if name.lower().endswith('.pdf'):
                pdfs += 1
    return pdfs, total, modified


def _describe(folder):
    contents = _contents(folder/'learning'/'learning.sqlite3')
    try:
        pdfs, total, modified = _footprint(folder)
    except OSError:
        pdfs, total, modified = 0, 0, 0.0
    return {'contents': contents, 'files': {'pdfs': pdfs, 'bytes': total},
            'modified': modified or None}


def _moved_leftovers(data, prune=True):
    """Paths reported by a rename that saw its old folder reappear (stragglers).

    Returned as warnings and pruned once the path is really gone, so a failed
    physical rename never hides writable leftovers silently. `prune=False` keeps
    read-only callers (a dry-run plan) from touching the disk.
    """
    path = Path(data)/'mover-restos.json'
    if not path.is_file():
        return []
    try:
        items = json.loads(path.read_text())
    except (OSError, ValueError):
        return []
    if not isinstance(items, list):
        return []
    pending, warnings = [], []
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('path'), str):
            continue
        folder = Path(item['path'])
        if folder.exists():
            pending.append(item)
            warnings.append('Quedaron archivos de un pliego movido en '+str(folder)+'. Revisá esa carpeta antes de volver a moverlo.')
    try:
        if not prune:
            pass
        elif pending:
            path.write_text(json.dumps(pending, ensure_ascii=False, indent=2)+'\n')
        else:
            path.unlink(missing_ok=True)
    except OSError:
        pass
    return warnings


def local_retired(data):
    """True when this installation retired the local library.

    The presence of a regular `<data>/local-retired.json` marks the retirement;
    a JSON object with `{"retired": false}` pauses it without deleting the file.
    Unreadable or unexpected content still retires (the file itself is the
    switch). A symlink is ignored so a stray link never hides the space by
    accident. This is deliberately per-installation: nothing changes elsewhere
    unless the file is created there.
    """
    marker = Path(data)/LOCAL_RETIRED_FILE
    try:
        if marker.is_symlink() or not marker.is_file():
            return False
    except OSError:
        return False
    try:
        info = json.loads(marker.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError):
        return True
    if isinstance(info, dict) and info.get('retired') is False:
        return False
    return True


def local_scope(data, warnings=None):
    """Scope of the local library once it has been moved into a visible vault.

    The marker keeps the stable id 'local' and the exact scope shape the app
    expects (`data=…/learning`, `root=…/assets`), so browser drafts, course and
    lesson selections that key on 'local' keep finding the same space. Returns
    None when there is no marker or it can no longer be trusted, in which case
    the original application data directory stays authoritative for 'local'.
    """
    note = warnings if warnings is not None else []
    marker = Path(data)/LOCAL_ALIAS_FILE
    if not marker.is_file():
        return None
    if marker.is_symlink():
        note.append('El registro de la biblioteca local trasladada es un enlace simbólico; se ignora.')
        return None
    try:
        info = json.loads(marker.read_text(encoding='utf-8'))
    except (OSError, UnicodeError, ValueError):
        note.append('El registro de la biblioteca local trasladada no se pudo leer; se usa la carpeta de datos original.')
        return None
    if not isinstance(info, dict) or info.get('format') != 'glosa-local-alias' or info.get('version') != 1 or info.get('id') != LOCAL_ID:
        note.append('El registro de la biblioteca local trasladada no tiene el formato esperado; se usa la carpeta de datos original.')
        return None
    folder = Path(str(info.get('path') or '')).expanduser()
    if not folder.is_absolute() or not folder.is_dir():
        note.append('El pliego de la biblioteca local no está disponible; se usa la carpeta de datos original.')
        return None
    metadata = folder/'pliego.json'
    try:
        meta = json.loads(metadata.read_text()) if metadata.is_file() and not metadata.is_symlink() else {}
    except (OSError, UnicodeError, ValueError):
        meta = {}
    if meta.get('format') != 'glosa-pliego' or meta.get('version') != 1 or meta.get('id') != LOCAL_ID or not isinstance(meta.get('title'), str):
        note.append('El pliego de la biblioteca local no tiene la identidad esperada; se usa la carpeta de datos original.')
        return None
    if metadata.is_symlink() or any(p.is_symlink() for p in (folder/'learning', folder/'learning/learning.sqlite3', folder/'assets')):
        note.append('El pliego de la biblioteca local contiene enlaces simbólicos; se usa la carpeta de datos original.')
        return None
    if not (folder/'learning/learning.sqlite3').is_file() or not (folder/'assets').is_dir():
        note.append('Faltan los datos del pliego de la biblioteca local; se usa la carpeta de datos original.')
        return None
    original = info.get('original')
    source_db = Path(data)/'learning.sqlite3'
    if isinstance(original, dict) and source_db.is_file() and not source_db.is_symlink():
        try:
            current = source_db.stat()
        except OSError:
            current = None
        if current is not None and (original.get('bytes') != current.st_size or original.get('mtimeNs') != current.st_mtime_ns):
            note.append('La biblioteca original cambió después del traslado; volvé a ejecutar la migración para no perder esos cambios.')
            return None
    return {'id': LOCAL_ID, 'title': meta['title'].strip() or 'Pliego local', 'kind': 'local-alias',
            'path': str(folder), 'data': folder/'learning', 'root': folder/'assets'}


def inventory(data, root, details=True, create=True):
    """Discover live folders without copying them or modifying their databases.

    The configured Margen is scanned together with the legacy `<data>/margen`
    folder (kept for pre-migration vaults) so no vault disappears when the
    visible default changes. Duplicate IDs found in two places are never opened.
    With details, each vault reports a read-only summary of its contents.
    `create=False` keeps a read-only discovery (dry-run) from creating folders.
    """
    location = margen(data, create=create)
    entries, backups, warnings, residents = [], [], [], []
    directories = [Path(location['path'])]
    legacy = Path(data)/LEGACY_MARGEN
    if legacy.resolve() != Path(location['path']).resolve():
        directories.append(legacy)
    for directory in directories:
        if not directory.is_dir():
            continue
        for folder in sorted(directory.iterdir()):
            if folder.is_symlink() or not folder.is_dir() or folder.name.startswith('.'):
                continue
            try:
                _scan_folder(folder, entries, backups, residents, warnings)
            except (ValueError, OSError, TypeError) as exc:
                warnings.append(folder.name+': '+str(exc))
    # The same physical folder must never be counted twice (e.g. Margen points
    # at the legacy folder).
    unique, seen = [], set()
    for item in entries:
        key = Path(item['path']).resolve()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    entries = unique
    found, ambiguous = {}, {}
    for item in entries:
        if item['id'] in found:
            ambiguous.setdefault(item['id'], {found[item['id']]['path']}).add(item['path'])
        found[item['id']] = item
    for item in registry(data):
        # Legacy registries keep working after the UI rename: a stored path may
        # be stale, so fall back to the historical <data>/rooms/<id> location.
        candidates = []
        if item.get('path'):
            candidates.append(Path(item['path']))
        candidates.append(Path(data)/'rooms'/item['id'])
        located = next((path for path in candidates if (path/'learning/learning.sqlite3').is_file()), None)
        if located is None:
            continue
        entry = {'id': item['id'], 'title': item.get('title') or item['id'], 'path': str(located)}
        if item['id'] in found and Path(entry['path']).resolve() != Path(found[item['id']]['path']).resolve():
            ambiguous.setdefault(item['id'], {found[item['id']]['path']}).add(entry['path'])
        elif item['id'] not in found:
            found[item['id']] = entry
        elif item['id'] in ambiguous:
            ambiguous[item['id']].add(entry['path'])
    for duplicate, paths in ambiguous.items():
        found.pop(duplicate, None)
        warnings.append('ID de pliego duplicado: '+duplicate+' en '+', '.join(sorted(paths))+'. No se abrirá ninguna de esas copias.')
    local = found.pop(LOCAL_ID, None)
    for path in residents:
        warnings.append('Carpeta sin metadatos dentro del Margen: '+path+'. Si es de un pliego, volvé a abrir su pliego.json antes de usarla.')
    warnings.extend(_moved_leftovers(data, prune=create))
    alias = None
    if local_retired(data):
        # Biblioteca local retirada en esta instalación: no se describe su
        # alias/legacy ni se avisa por un marcador que ya no interesa.
        pass
    else:
        local_warnings = []
        local_probe = local_scope(data, local_warnings)
        if local_probe is not None:
            alias = local_probe
            if local is not None and Path(local['path']).resolve() != Path(alias['path']).resolve():
                warnings.append('El pliego de la biblioteca local está duplicado; abrí Margen y verificá las carpetas.')
        else:
            warnings.extend(local_warnings)
    result = {'margen': location, 'pliegos': list(found.values()), 'backups': backups, 'warnings': warnings,
              'duplicates': {key: sorted(value) for key, value in ambiguous.items()}}
    if alias is not None:
        result['local'] = {'id': LOCAL_ID, 'title': alias['title'], 'path': alias['path']}
    if details:
        for entry in result['pliegos']:
            entry.update(_describe(Path(entry['path'])))
        if alias is not None:
            result['local'].update(_describe(Path(alias['path'])))
    return result


def initialize(scope):
    import server
    with LOCK:
        if not (scope['data']/'learning.sqlite3').exists():
            scope['data'].mkdir(parents=True, exist_ok=True)
            token = server.ACTIVE_WORKSPACE.set(scope)
            try:
                server.init_db()
            finally:
                server.ACTIVE_WORKSPACE.reset(token)
    return scope


def create(data, root, title):
    if not isinstance(title, str) or not title.strip() or len(title) > 200:
        raise ValueError('Indicá un nombre de pliego de hasta 200 caracteres.')
    title = title.strip()
    with LOCK:
        directory = Path(margen(data)['path'])
        if not directory.is_dir():
            raise ValueError('La carpeta del Margen no está disponible.')
        target = _unique_folder(directory, safe_folder_name(title))
        pliego_id = 'pliego-'+uuid.uuid4().hex
        with tempfile.TemporaryDirectory(prefix='.create-', dir=directory) as temp:
            stage = Path(temp)/'pliego'
            stage.mkdir(); (stage/'assets').mkdir()
            item = {'format': 'glosa-pliego', 'version': 1, 'id': pliego_id, 'title': title}
            initialize({**item, 'data': stage/'learning', 'root': stage/'assets'})
            (stage/'pliego.json').write_text(json.dumps(item, ensure_ascii=False, indent=2)+'\n')
            stage.rename(target)
    return {'id': pliego_id, 'title': title, 'path': str(target)}


def registry(data):
    path = Path(data)/'rooms.json'
    return json.loads(path.read_text()) if path.exists() else []


def _tutorial_scope(data, root):
    """Scope of the Primer trazo tutorial, initialising it only if it is missing.

    `initialize` sets ACTIVE_WORKSPACE while `server.init_db` runs, so the
    default 'local' resolve never recurses back into the workspace resolver.
    """
    return initialize({'id': TUTORIAL_ID, 'title': 'Primer trazo', 'kind': 'tutorial',
                       'data': Path(data)/'tutorial', 'root': Path(root)})


def room(data, root, room_id):
    if room_id == LOCAL_ID:
        if local_retired(data):
            # Biblioteca local retirada: los clientes viejos y las peticiones de
            # catálogo que usan 'local' se atienden con el tutorial, sin recrear
            # ni abrir la base local vieja.
            return _tutorial_scope(data, root)
        scope = local_scope(data)
        if scope is not None:
            return scope
        # Un marcador de traslado presente pero inválido NUNCA debe caer en
        # silencio a la base vieja: eso mostraría/editaría una biblioteca
        # distinta de la que el usuario cree abierta. Error recuperable que
        # conserva ambas copias.
        marker = Path(data)/LOCAL_ALIAS_FILE
        if marker.exists():
            raise ValueError('El registro de la biblioteca local trasladada existe pero no es válido ('
                             + str(marker)+'). No se abrió la carpeta de datos original para no mostrar otra base; '
                             'revisá esa carpeta o volvé a ejecutar la migración. Se conservan ambas copias.')
        return {'id': LOCAL_ID, 'title': 'Pliego local', 'data': Path(data), 'root': Path(root)}
    if room_id == TUTORIAL_ID:
        return _tutorial_scope(data, root)
    for item in inventory(data, root, details=False)['pliegos']:
        if item['id'] == room_id:
            base = Path(item['path'])
            return {**item, 'data': base/'learning', 'root': base/'assets'}
    raise ValueError('Pliego no disponible. Abrí Margen para elegir otro.')


def list_rooms(data, root):
    tutorial = {'id': TUTORIAL_ID, 'title': 'Primer trazo', 'kind': 'tutorial'}
    if local_retired(data):
        # Instalación con la biblioteca local retirada: no se ofrece esa tarjeta.
        return [{'id': item['id'], 'title': item['title']}
                for item in [tutorial, *inventory(data, root, details=False)['pliegos']]]
    # El listado no debe romperse por un marcador inválido: la entrada local se
    # describe con el mejor dato disponible y el error concreto aparece al abrir.
    scope = local_scope(data)
    local = {'id': LOCAL_ID, 'title': scope['title'] if scope is not None else 'Pliego local'}
    return [{'id': item['id'], 'title': item['title']}
            for item in [tutorial, local, *inventory(data, root, details=False)['pliegos']]]


def _record_settle(data, old_folder):
    """After a physical rename, surface the old path if a concurrent request recreated it."""
    deadline = time.monotonic()+0.6
    while time.monotonic() < deadline:
        if not old_folder.exists():
            return
        time.sleep(0.05)
    if not old_folder.exists():
        return
    path = Path(data)/'mover-restos.json'
    try:
        items = json.loads(path.read_text()) if path.is_file() else []
    except (OSError, ValueError):
        items = []
    items = [item for item in items if isinstance(item, dict) and item.get('path') != str(old_folder)]
    items.append({'path': str(old_folder), 'at': time.strftime('%Y-%m-%dT%H:%M:%S')})
    try:
        path.write_text(json.dumps(items, ensure_ascii=False, indent=2)+'\n')
    except OSError:
        pass


def rename(data, root, room_id, title):
    """Change a vault's display name AND its physical folder, preserving ID/history.

    The visible folder follows the title so the file explorer shows a human
    name; the stable ID in `pliego.json` and every course, page, note and
    evaluation keep pointing at the same data. Registered vaults get their
    stored path updated atomically. Callers flush note autosaves first (the
    browser does it); the move itself is a single atomic `rename` on the same
    filesystem, with the old title restored if the filesystem refuses it.
    """
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 200:
        raise ValueError('Indicá un nombre de pliego de hasta 200 caracteres.')
    title = title.strip()
    if not isinstance(room_id, str) or room_id in (LOCAL_ID, TUTORIAL_ID):
        raise ValueError('El pliego local y Primer trazo conservan su nombre.')
    with LOCK:
        target = next((item for item in inventory(data, root, details=False)['pliegos'] if item['id'] == room_id), None)
        if target is None:
            raise ValueError('Pliego no disponible. Abrí Margen para elegir otro.')
        folder = Path(target['path'])
        metadata = folder/'pliego.json'
        if metadata.is_symlink():
            raise ValueError('Metadatos inválidos.')
        items = registry(data)
        registered = any(entry.get('id') == room_id for entry in items)
        if not metadata.is_file() and not registered:
            raise ValueError('Los metadatos del pliego cambiaron; volvé a abrir Margen.')
        previous_title = target['title']
        moved = folder
        if metadata.is_file():
            stored = json.loads(metadata.read_text())
            if stored.get('title') != title:
                pending = folder/'.pliego.json.tmp'
                pending.write_text(json.dumps({**stored, 'title': title}, ensure_ascii=False, indent=2)+'\n')
                pending.replace(metadata)
            desired = safe_folder_name(title)
            if desired != folder.name:
                destination = _unique_folder(folder.parent, desired)
                try:
                    folder.rename(destination)
                except OSError:
                    try:
                        pending = folder/'.pliego.json.tmp'
                        pending.write_text(json.dumps({**stored, 'title': previous_title}, ensure_ascii=False, indent=2)+'\n')
                        pending.replace(metadata)
                    except OSError:
                        pass
                    raise ValueError('No se pudo renombrar la carpeta «'+folder.name+'». Cerrá el pliego en otras ventanas e intentá otra vez.') from None
                moved = destination
        if registered:
            try:
                pending = Path(data)/'rooms.json.tmp'
                pending.write_text(json.dumps([{**entry, 'title': title, 'path': str(moved)} if entry.get('id') == room_id else entry
                                               for entry in items], ensure_ascii=False, indent=2)+'\n')
                pending.replace(Path(data)/'rooms.json')
            except OSError:
                if moved != folder:
                    try:
                        moved.rename(folder)
                    except OSError:
                        pass
                raise
        if moved != folder:
            _record_settle(data, folder)
        return {'id': room_id, 'title': title, 'path': str(moved)}


def trash(data, root, room_id):
    """Remove a pliego from discovery by moving its complete folder to .papelera."""
    if not isinstance(room_id, str) or room_id in (LOCAL_ID, TUTORIAL_ID):
        raise ValueError('No se puede eliminar la biblioteca local ni el tutorial.')
    with LOCK:
        item = next((p for p in inventory(data, root, details=False, create=False)['pliegos']
                     if p['id'] == room_id), None)
        if item is None:
            raise ValueError('Pliego no disponible.')
        folder = Path(item['path'])
        bin_folder = folder.parent/'.papelera'
        if bin_folder.is_symlink():
            raise ValueError('La papelera no admite enlaces simbólicos.')
        bin_folder.mkdir(exist_ok=True)
        destination = _unique_folder(bin_folder, folder.name)
        entries = registry(data)
        remaining = [entry for entry in entries if entry.get('id') != room_id]
        folder.rename(destination)
        try:
            if remaining != entries:
                pending = Path(data)/'rooms.json.tmp'
                pending.write_text(json.dumps(remaining, ensure_ascii=False, indent=2)+'\n')
                pending.replace(Path(data)/'rooms.json')
        except OSError:
            destination.rename(folder)
            raise
        _record_settle(data, folder)
        return {'id': room_id, 'title': item['title'], 'trashPath': str(destination)}


def register(bundle, data, root, title=''):
    from scripts.room_backup import restore_room, verify_bundle
    if not isinstance(title, str):
        raise ValueError('Nombre de pliego inválido.')
    state, _ = verify_bundle(bundle)
    title = title.strip() or ' / '.join(c['title'] for c in state['courses'])
    if not title or len(title) > 200:
        raise ValueError('Nombre de pliego inválido.')
    with LOCK:
        room_id = 'room-'+uuid.uuid4().hex
        directory = Path(margen(data)['path'])
        if not directory.is_dir():
            raise ValueError('La carpeta del Margen no está disponible.')
        target = _unique_folder(directory, safe_folder_name(title))
        with tempfile.TemporaryDirectory(prefix='.import-', dir=directory) as temp:
            stage = Path(temp)/'room'
            stage.mkdir()
            (stage/'assets').mkdir()
            # Written before restoring so the visible notes root resolves to
            # `<vault>/Apuntes` (Library.notes_root sees the metadata).
            (stage/'pliego.json').write_text(json.dumps({'format': 'glosa-pliego', 'version': 1, 'id': room_id, 'title': title}, ensure_ascii=False, indent=2)+'\n')
            restore_room(bundle, stage/'learning', stage/'assets')
            stage.rename(target)
            items = registry(data)
            item = {'id': room_id, 'title': title, 'path': str(target)}
            items.append(item)
            pending = Path(data)/'rooms.json.tmp'
            try:
                pending.write_text(json.dumps(items, ensure_ascii=False, indent=2)+'\n')
                pending.replace(Path(data)/'rooms.json')
            except Exception:
                shutil.rmtree(target)
                raise
    return item


def import_zip(encoded, data, root, title=''):
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise ValueError('ZIP inválido.') from None
    if len(raw) > 60_000_000:
        raise ValueError('El paquete admite hasta 60 MB comprimidos.')
    with tempfile.TemporaryDirectory(prefix='glosa-zip-') as temp:
        directory = Path(temp)
        archive = directory/'room.zip'
        archive.write_bytes(raw)
        bundle = directory/'bundle'
        bundle.mkdir()
        try:
            with zipfile.ZipFile(archive) as z:
                entries = z.infolist()
                if len(entries) > 3000 or sum(i.file_size for i in entries) > 250_000_000:
                    raise ValueError('ZIP demasiado grande al descomprimir.')
                seen = set()
                for item in entries:
                    name = item.filename
                    path = Path(name)
                    if path.is_absolute() or '..' in path.parts or '\\' in name or name in seen or (item.external_attr >> 16) & 0o170000 == 0o120000:
                        raise ValueError('Ruta o enlace inválido en ZIP.')
                    seen.add(name)
                    if item.is_dir():
                        continue
                    destination = bundle/path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with z.open(item) as source, destination.open('wb') as target:
                        shutil.copyfileobj(source, target)
        except zipfile.BadZipFile:
            raise ValueError('ZIP inválido.') from None
        return register(bundle, data, root, title)


def export_zip(data, root):
    from scripts.room_backup import export_room
    with tempfile.TemporaryDirectory(prefix='glosa-download-') as temp:
        bundle = Path(temp)/'bundle'
        export_room(bundle, data, root)
        archive = Path(temp)/'sala.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
            for file in sorted(bundle.rglob('*')):
                if file.is_file():
                    z.write(file, file.relative_to(bundle).as_posix())
        if archive.stat().st_size > 60_000_000:
            raise ValueError('La sala supera 60 MB: exportala por carpeta con room_backup.py.')
        return archive.read_bytes()
