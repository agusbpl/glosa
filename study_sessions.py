"""Immutable, workspace-local study telemetry. No learning claims or model calls."""
from datetime import datetime, date, time, timedelta, timezone
import json
import math
from zoneinfo import ZoneInfo


def _instant(value):
    if not isinstance(value, str):
        raise ValueError('Fecha inválida.')
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('Fecha inválida.') from None
    if result.tzinfo is None:
        raise ValueError('La fecha requiere zona horaria.')
    return result.astimezone(timezone.utc)


def _text(item, key, limit=500, required=False):
    value = item.get(key, '')
    if not isinstance(value, str) or len(value) > limit or (required and not value):
        raise ValueError('Campo inválido: ' + key)
    return value


def _normalize(item, segment):
    if not isinstance(item, dict):
        raise ValueError('Evento inválido.')
    keys = ('id', 'sessionId', 'deviceId', 'courseId', 'lessonId', 'goal', 'timezone', 'mode')
    data = {key: _text(item, key, required=key in ('id', 'sessionId', 'deviceId', 'timezone', 'mode')) for key in keys}
    try:
        ZoneInfo(data['timezone'])
    except (ValueError, KeyError):
        raise ValueError('Zona horaria inválida.') from None
    if data['mode'] not in ('pomodoro', 'free'):
        raise ValueError('Modo inválido.')
    planned = item.get('plannedSeconds', 0)
    if type(planned) not in (int, float) or not math.isfinite(planned) or not 0 <= planned <= 86400:
        raise ValueError('Duración prevista inválida.')
    data['plannedSeconds'] = planned
    tracking = item.get('tracking', 'manual')
    if tracking not in ('manual', 'automatic'): raise ValueError('Registro inválido.')
    if tracking == 'automatic': data['tracking'] = tracking
    event_id = data.pop('id')
    course_id, lesson_id = data.pop('courseId'), data.pop('lessonId')
    if segment:
        start, end = _instant(item.get('startedAt')), _instant(item.get('endedAt'))
        duration = (end-start).total_seconds()
        if not 0 <= duration <= 86400:
            raise ValueError('Duración del segmento inválida.')
        if item.get('phase') not in ('focus', 'break', 'pause'):
            raise ValueError('Fase inválida.')
        if type(item.get('visible')) is not bool or type(item.get('uncertain')) is not bool:
            raise ValueError('Visibilidad e incertidumbre requieren booleanos.')
        data.update({key: _text(item, key) for key in ('courseVersion', 'view', 'noteId')})
        data.update(startedAt=start.isoformat(), endedAt=end.isoformat(), phase=item['phase'], visible=item['visible'], uncertain=item['uncertain'], durationSeconds=duration, seconds=duration if item['phase']=='focus' else 0)
        kind, timestamp = 'study_time', start.isoformat()
    else:
        if item.get('action') not in ('start', 'finish'):
            raise ValueError('Acción inválida.')
        if item.get('rating') not in (None, 'hard', 'okay', 'easy'):
            raise ValueError('Valoración inválida.')
        data.update(action=item['action'], reason=_text(item, 'reason'), rating=item.get('rating'))
        kind, timestamp = 'study_session', _instant(item.get('timestamp')).isoformat()
    return (event_id, timestamp, kind, course_id, lesson_id, json.dumps(data, sort_keys=True, ensure_ascii=False))


def save(ctx, body):
    if not isinstance(body, dict):
        raise ValueError('Lote inválido.')
    segments, sessions = body.get('segments', []), body.get('sessions', [])
    if not isinstance(segments, list) or not isinstance(sessions, list) or len(segments)+len(sessions)>100:
        raise ValueError('El lote admite hasta 100 eventos.')
    rows = [_normalize(item, True) for item in segments] + [_normalize(item, False) for item in sessions]
    inserted = 0
    with ctx.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        for row in rows:
            old = conn.execute('SELECT id,timestamp,kind,course_id,lesson_id,body FROM events WHERE id=?', (row[0],)).fetchone()
            if old:
                prior = tuple(old)
                if prior[:5] != row[:5] or json.loads(prior[5]) != json.loads(row[5]):
                    raise ValueError('ID de evento reutilizado con contenido distinto.')
            else:
                conn.execute('INSERT INTO events VALUES(?,?,?,?,?,?)', row)
                inserted += 1
    return {'accepted': len(rows), 'inserted': inserted, 'duplicates': len(rows)-inserted}


def summary(ctx, start=None, end=None, now=None):
    zone = ctx.LOCAL_ZONE
    current = (now or datetime.now(timezone.utc)).astimezone(zone)
    try:
        last = date.fromisoformat(end) if end else current.date()
        first = date.fromisoformat(start) if start else last-timedelta(days=6)
    except (ValueError, TypeError):
        raise ValueError('Rango de fechas inválido.') from None
    if last == date.max or not 0 <= (last-first).days <= 365:
        raise ValueError('El rango admite hasta 366 días.')
    empty = lambda: {'focusSeconds': 0, 'breakSeconds': 0, 'visibleSeconds': 0, 'sessionsFinished': 0, 'uncertainSeconds': 0}
    days = {(first+timedelta(days=i)).isoformat(): empty() for i in range((last-first).days+1)}
    today, total, courses, activities = empty(), empty(), {}, {}
    range_start = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
    range_end = datetime.combine(last+timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    with ctx.connect() as conn:
        titles = {r['id']: json.loads(r['body']).get('title', r['id']) for r in conn.execute('SELECT id,body FROM courses')}
        rows = conn.execute("SELECT * FROM events WHERE kind IN ('study_time','study_session')").fetchall()
    finished = set()
    for row in rows:
        data = json.loads(row['body'])
        if data.get('tracking') == 'automatic': continue
        try:
            timestamp = _instant(row['timestamp'])
            if row['kind']=='study_session':
                day = timestamp.astimezone(zone).date().isoformat()
                identity = (data.get('deviceId'), data.get('sessionId'))
                if data.get('action')=='finish' and identity not in finished and day in days:
                    finished.add(identity)
                    days[day]['sessionsFinished'] += 1
                    total['sessionsFinished'] += 1
                    if day==current.date().isoformat(): today['sessionsFinished'] += 1
                continue
            modern = 'startedAt' in data and 'endedAt' in data
            begin = _instant(data['startedAt']) if modern else timestamp
            seconds = data.get('seconds', 0)
            if type(seconds) not in (int, float) or not math.isfinite(seconds) or seconds<0: continue
            finish = _instant(data['endedAt']) if modern else begin+timedelta(seconds=seconds)
            if finish<begin: continue
            # Bound work by the requested range, including imported legacy data.
            begin, finish = max(begin, range_start), min(finish, range_end)
            if finish<=begin: continue
            phase = data.get('phase', 'focus')
            visible = data.get('visible', True) if modern else True
            uncertain = data.get('uncertain', False) if modern else True
            cursor = begin
            while cursor<finish:
                local_date = cursor.astimezone(zone).date()
                boundary = datetime.combine(local_date+timedelta(days=1), time.min, zone).astimezone(timezone.utc)
                stop = min(finish, boundary)
                duration = (stop-cursor).total_seconds()
                day = local_date.isoformat()
                if day in days:
                    values = empty()
                    values['focusSeconds'] = duration if phase=='focus' else 0
                    values['breakSeconds'] = duration if phase=='break' else 0
                    values['visibleSeconds'] = duration if phase=='focus' and visible else 0
                    values['uncertainSeconds'] = duration if phase=='focus' and uncertain else 0
                    targets = [days[day], total]
                    if day==current.date().isoformat(): targets.append(today)
                    for target in targets:
                        for key, value in values.items(): target[key] += value
                    cid, view = row['course_id'], data.get('view', 'study')
                    courses[cid] = courses.get(cid, 0)+values['focusSeconds']
                    activities[view] = activities.get(view, 0)+values['focusSeconds']
                cursor = stop
        except (ValueError, TypeError, KeyError, OverflowError):
            continue
    return {'scope': ctx.active_workspace().get('id', 'local'), 'timezone': str(zone), 'from': first.isoformat(), 'to': last.isoformat(), 'today': today, 'total': total, 'days': [{'date':day, **values} for day,values in days.items()], 'courses': [{'id':cid, 'title': titles.get(cid, cid or 'Sin curso'), 'focusSeconds':seconds} for cid,seconds in sorted(courses.items(), key=lambda pair:-pair[1])], 'activities':[{'view':view, 'focusSeconds':seconds} for view,seconds in sorted(activities.items(), key=lambda pair:-pair[1])]}
