"""Explicit, read-only public projection for portable lesson documents.

Never use a course, note or snapshot directly as an export payload.
"""
import re
import ipaddress
from urllib.parse import unquote, urlsplit

NOTE_LINK = re.compile(r'#note(?:=|-)([A-Za-z0-9_.-]{1,100})(?![A-Za-z0-9_.-])')


def _state(ctx):
    state = ctx if isinstance(ctx, dict) else ctx.snapshot()
    scope = {} if isinstance(ctx, dict) else ctx.active_workspace()
    title = state.get('room', {}).get('title') or scope.get('title') or 'Lecciones de Glosa'
    return state, title


def _pick(obj, keys):
    return {key: obj[key] for key in keys if key in obj}


def _links(text):
    return set(NOTE_LINK.findall(unquote(text or '')))


def _is_exam(lesson):
    return lesson.get('mode') == 'exam' or ('mode' not in lesson and bool(re.search('simulacro', lesson.get('title', ''), re.I)))


def _reachable(lesson, notes):
    if _is_exam(lesson):
        return set()
    found = set()
    pending = set().union(*(_links(b.get('text', '')) for b in lesson.get('blocks', [])))
    while pending:
        nid = pending.pop()
        if nid in found or nid not in notes:
            continue
        found.add(nid)
        pending.update(_links(notes[nid].get('content', '')) - found)
    return found


def _notes(state):
    return {n['id']: n for n in state.get('library', {}).get('notes', []) if not n.get('deletedAt')}


def inventory(ctx):
    state, title = _state(ctx)
    notes = _notes(state)
    refs = {}
    courses = []
    for course in state.get('courses', []):
        courses.append({'id': course['id'], 'title': course['title'], 'lessons': [
            _pick(l, ('id', 'title', 'unit', 'minutes')) for l in course.get('lessons', [])]})
        for lesson in course.get('lessons', []):
            for nid in _reachable(lesson, notes):
                refs.setdefault(nid, []).append({'courseId': course['id'], 'lessonId': lesson['id']})
    return {'title': title, 'courses': courses, 'notes': [
        {'id': nid, 'title': notes[nid]['title'], 'shared': notes[nid].get('shared') is True,
         'referencedBy': refs[nid]} for nid in sorted(refs)]}


def _unique_strings(value, label):
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value) or len(set(value)) != len(value):
        raise ValueError(label + ': lista de IDs inválida o repetida.')
    return value


def _https(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
    except ValueError:
        return None
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        return None
    host = parsed.hostname.lower()
    if host == 'localhost' or host.endswith(('.localhost', '.local', '.internal')) or '.' not in host:
        return None
    try:
        if not ipaddress.ip_address(host).is_global:
            return None
    except ValueError:
        pass
    return value


def _scrub_markdown(text):
    """Remove unsupported link destinations before serializing the document."""
    if not isinstance(text, str):
        return text
    def allowed(url):
        url = url.strip().strip('<>')
        return bool(NOTE_LINK.fullmatch(url)) or bool(_https(url))
    def inline(match):
        return match.group(0) if allowed(match.group(2)) else match.group(1)
    # Destinations may contain balanced parentheses (e.g. javascript calls).
    text = re.sub(r'!?\[([^]\n]*)\]\(([^()\n]*(?:\([^()\n]*\)[^()\n]*)*)\)', inline, text)
    text = re.sub(r'^\s*\[([^]\n]+)\]:\s*(\S+)[^\n]*$', lambda m: m.group(0) if allowed(m.group(2)) else '', text, flags=re.M)
    text = re.sub(r'<((?:https?://|file:|javascript:)[^>\n]+)>', lambda m: m.group(0) if allowed(m.group(1)) else '', text, flags=re.I)
    return text


def _scrub_projection(value):
    if isinstance(value, dict):
        return {k: _scrub_projection(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_projection(v) for v in value]
    return _scrub_markdown(value)


def _visual(v):
    if v.get('kind') not in ('flow', 'plot'):
        return None
    out = _pick(v, ('id', 'kind', 'title', 'caption', 'blockId'))
    if v['kind'] == 'flow':
        out['nodes'] = [_pick(n, ('id', 'label', 'detail', 'col', 'row')) for n in v.get('nodes', [])]
        out['edges'] = [_pick(e, ('from', 'to', 'label')) for e in v.get('edges', [])]
    else:
        out.update(_pick(v, ('xLabel', 'yLabel')))
        out['series'] = [{'label': s.get('label', ''), 'points': [list(p[:2]) for p in s.get('points', [])]} for s in v.get('series', [])]
    return out


def _lesson(lesson, solutions):
    out = _pick(lesson, ('id', 'title', 'unit', 'intro', 'minutes', 'mode'))
    out['blocks'] = []
    for block in lesson.get('blocks', []):
        b = _pick(block, ('id', 'title', 'text'))
        b['references'] = [_pick(r, ('sourceId', 'page')) for r in block.get('references', [])]
        out['blocks'].append(b)
    keys = ('id', 'type', 'question', 'options', 'orderedOptions')
    if solutions:
        keys += ('correctIndex', 'explanation', 'acceptedAnswer')
    out['exercises'] = [_pick(e, keys) for e in lesson.get('exercises', [])]
    if _is_exam(lesson):
        out.pop('intro', None)
        out['mode'] = 'exam'
        out['blocks'] = []
        return out
    if 'sequence' in lesson:
        out['sequence'] = [_pick(s, ('type', 'id')) for s in lesson['sequence']]
    out['visuals'] = [result for v in lesson.get('visuals', []) if (result := _visual(v))]
    practice = lesson.get('interactive', {})
    if practice.get('kind') in ('classify', 'order'):
        out['interactive'] = _pick(practice, ('kind', 'title', 'prompt', 'categories'))
        out['interactive']['items'] = [_pick(i, ('id', 'text', 'answer') if solutions else ('id', 'text')) for i in practice.get('items', [])]
        if solutions:
            out['interactive'].update(_pick(practice, ('explanation',)))
    if lesson.get('simulation') in ('integration', 'dashboard'):
        out['simulation'] = lesson['simulation']
    resources = []
    for r in lesson.get('resources', []):
        resource = _pick(r, ('kind', 'title', 'task', 'startSeconds'))
        if r.get('kind') == 'youtube' and re.fullmatch(r'[A-Za-z0-9_-]{11}', r.get('videoId', '')):
            resource['url'] = 'https://www.youtube.com/watch?v=' + r['videoId']
        resources.append(resource)
    out['resources'] = resources
    return out


def build_payload(ctx, body):
    if not isinstance(body, dict) or type(body.get('includeSolutions', False)) is not bool:
        raise ValueError('Opciones de exportación inválidas.')
    state, title = _state(ctx)
    selection = body.get('selection')
    if not isinstance(selection, list) or not selection:
        raise ValueError('Elegí al menos una lección.')
    note_ids = _unique_strings(body.get('noteIds', []), 'Notas')
    available = {c['id']: c for c in state.get('courses', [])}
    notes = _notes(state)
    reachable = set()
    seen_courses = set()
    courses = []
    for entry in selection:
        if not isinstance(entry, dict) or entry.get('courseId') not in available or entry['courseId'] in seen_courses:
            raise ValueError('Curso inexistente o repetido.')
        seen_courses.add(entry['courseId'])
        ids = _unique_strings(entry.get('lessonIds'), 'Lecciones')
        if not ids:
            raise ValueError('Elegí al menos una lección por curso.')
        course = available[entry['courseId']]
        lessons = {l['id']: l for l in course.get('lessons', [])}
        if any(lid not in lessons for lid in ids):
            raise ValueError('Lección inexistente.')
        chosen = [l for l in course['lessons'] if l['id'] in ids]
        for lesson in chosen:
            reachable.update(_reachable(lesson, notes))
        projected = _pick(course, ('id', 'title', 'description'))
        projected['lessons'] = [_lesson(l, body.get('includeSolutions', False)) for l in chosen]
        used_sources = {r.get('sourceId') for l in chosen for b in l.get('blocks', []) for r in b.get('references', [])}
        projected['sources'] = []
        for source in course.get('sources', []):
            if source.get('id') not in used_sources:
                continue
            public = _pick(source, ('id', 'title'))
            if url := _https(source.get('url')):
                public['url'] = url
            projected['sources'].append(public)
        courses.append(projected)
    if any(nid not in reachable for nid in note_ids):
        raise ValueError('Nota inexistente o no referenciada por las lecciones elegidas.')
    return _scrub_projection({'title': title, 'courses': courses, 'notes': [_pick(notes[nid], ('id', 'title', 'content')) for nid in note_ids], 'includeSolutions': body.get('includeSolutions', False)})
