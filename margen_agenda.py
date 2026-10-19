"""Read-only cross-pliego calendar and revisioned timetable kept in the Margen."""
from contextlib import closing
from datetime import date, datetime, timedelta, time
import json
from pathlib import Path
import sqlite3
import uuid
from zoneinfo import ZoneInfo
import rooms


def _file(data):
    return Path(rooms.margen(data, create=False)['path']) / '.glosa-agenda.json'


def load(data):
    path = _file(data)
    if path.is_symlink():
        raise ValueError('El horario no admite enlaces simbólicos.')
    if not path.exists():
        return {'revision': 0, 'timezone': 'America/Argentina/Buenos_Aires', 'events': []}
    return json.loads(path.read_text(encoding='utf-8'))


def save(data, root, body):
    with rooms.LOCK:
        current = load(data)
        if type(body.get('expectedRevision')) is not int or body['expectedRevision'] != current['revision']:
            raise ValueError('La agenda cambió. Recargá antes de guardar.')
        events = list(current['events'])
        event_id = body.get('id')
        if body.get('action') == 'delete':
            if not any(e['id'] == event_id for e in events):
                raise ValueError('Evento inexistente.')
            events = [e for e in events if e['id'] != event_id]
        else:
            raw = body.get('event')
            if not isinstance(raw, dict):
                raise ValueError('Evento inválido.')
            available = rooms.inventory(data, root, details=False, create=False)['pliegos']
            if raw.get('roomId') not in {p['id'] for p in available}:
                raise ValueError('Elegí un pliego disponible.')
            title = raw.get('title')
            if not isinstance(title, str) or not title.strip() or len(title) > 200:
                raise ValueError('Indicá un título de hasta 200 caracteres.')
            for field in ('date', 'time', 'endTime', 'repeatUntil', 'courseId'):
                if field in raw and not isinstance(raw[field], str):
                    raise ValueError('Fecha, hora o curso inválidos.')
            start = date.fromisoformat(raw.get('date', ''))
            until = date.fromisoformat(raw.get('repeatUntil') or start.isoformat())
            if start.isoformat() != raw['date'] or until < start or (until-start).days > 730:
                raise ValueError('Fechas de repetición inválidas (máximo dos años).')
            kind = raw.get('kind')
            if kind not in ('class', 'exam', 'deadline', 'study'):
                raise ValueError('Tipo de evento inválido.')
            for field in ('time', 'endTime'):
                value = raw.get(field, '')
                if value and (not isinstance(value, str) or time.fromisoformat(value).strftime('%H:%M') != value):
                    raise ValueError('Usá horas HH:MM.')
            clock, end = raw.get('time', ''), raw.get('endTime', '')
            if kind == 'class' and (not clock or not end):
                raise ValueError('La clase necesita hora de inicio y de fin.')
            if end and (not clock or end <= clock):
                raise ValueError('La clase debe terminar después de empezar, en el mismo día.')
            excluded = raw.get('excludedDates', [])
            if not isinstance(excluded, list) or len(excluded) > 200 or any(not isinstance(d, str) or date.fromisoformat(d).isoformat() != d for d in excluded):
                raise ValueError('Fechas de excepción inválidas.')
            course_id = raw.get('courseId', '')
            selected = next(p for p in available if p['id'] == raw['roomId'])
            courses, _ = _calendar(Path(selected['path'])/'learning/learning.sqlite3')
            if course_id and course_id not in {c['id'] for c in courses}:
                raise ValueError('Curso inexistente en ese pliego.')
            event_id = raw.get('id') or str(uuid.uuid4())
            if raw.get('id') and not any(e['id'] == event_id for e in events):
                raise ValueError('Evento inexistente.')
            event = dict(id=event_id, roomId=raw['roomId'], courseId=course_id,
                         title=title.strip(), date=start.isoformat(), kind=kind,
                         time=clock, endTime=end, repeatUntil=raw.get('repeatUntil', ''), excludedDates=excluded)
            events = [e for e in events if e['id'] != event_id] + [event]
        result = {**current, 'revision': current['revision']+1, 'events': events}
        path = _file(data)
        pending = path.with_suffix('.json.tmp')
        pending.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        pending.replace(path)
        return result


def _calendar(database):
    with closing(sqlite3.connect(database.resolve().as_uri()+'?mode=ro', uri=True)) as conn:
        courses = [{'id': r[0], 'title': json.loads(r[1])['title']} for r in conn.execute('SELECT id,body FROM courses')]
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        events = [json.loads(r[0]) for r in conn.execute('SELECT body FROM calendar_events')] if 'calendar_events' in tables else []
        return courses, events


def occurrences(events, start, days=60):
    found = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        stamp = day.isoformat()
        for event in events:
            origin = date.fromisoformat(event['date'])
            weekly = event.get('repeatUntil') and origin <= day <= date.fromisoformat(event['repeatUntil']) and (day-origin).days % 7 == 0
            if (stamp == event['date'] or weekly) and stamp not in event.get('excludedDates', []):
                found.append({**event, 'occurrenceDate': stamp})
    return sorted(found, key=lambda e: (e['occurrenceDate'], e.get('time', ''), e['title'], e['roomId']))


def snapshot(data, root, now=None, start=None):
    agenda = load(data)
    now = now or datetime.now(ZoneInfo(agenda['timezone']))
    catalog = rooms.inventory(data, root, create=False)
    events = [{**e, 'source': 'margen'} for e in agenda['events']]
    warnings = list(catalog['warnings'])
    for pliego in catalog['pliegos']:
        try:
            courses, calendar = _calendar(Path(pliego['path'])/'learning/learning.sqlite3')
            pliego['courses'] = courses
            events.extend({**e, 'roomId': pliego['id'], 'source': 'course'} for e in calendar)
        except (sqlite3.Error, ValueError, OSError) as exc:
            pliego['courses'] = []
            warnings.append(pliego['title']+': '+str(exc))
    upcoming = occurrences(events, date.fromisoformat(start) if start else now.date())
    active = []
    for event in (occurrences(events, now.date(), days=2) if start else upcoming):
        if event['kind'] not in ('class', 'theory', 'practice') or not event.get('time') or not event.get('endTime'):
            continue
        start = datetime.combine(date.fromisoformat(event['occurrenceDate']), time.fromisoformat(event['time']), now.tzinfo)
        end = datetime.combine(date.fromisoformat(event['occurrenceDate']), time.fromisoformat(event['endTime']), now.tzinfo)
        if start-timedelta(minutes=15) <= now < end:
            active.append({**event, 'started': now >= start})
    return {**catalog, 'legacyLocal': not rooms.local_retired(data),
            'warnings': warnings, 'agenda': agenda, 'upcoming': upcoming,
            'activeClasses': active, 'today': now.date().isoformat(), 'timezone': agenda['timezone']}
