"""Global active-time calendar. Read-only aggregation, with overlapping time counted once."""
from contextlib import closing
from datetime import date, datetime, time, timedelta, timezone
import heapq
import json
import sqlite3
from pathlib import Path

import rooms
from study_sessions import _instant


def aggregate(scopes, zone, year, now=None):
    year = int(year)
    if not 1970 <= year <= 2100:
        raise ValueError('Año inválido.')
    today = (now or datetime.now(timezone.utc)).astimezone(zone).date()
    first, last = date(year, 1, 1), date(year+1, 1, 1)
    start = datetime.combine(first, time.min, zone).timestamp()
    end = min(datetime.combine(last, time.min, zone).timestamp(), (now or datetime.now(timezone.utc)).timestamp())
    intervals, warnings, seen = [], [], set()
    for scope in scopes:
        path = scope['db'].resolve()
        if path in seen or not path.is_file():
            continue
        seen.add(path)
        try:
            with closing(sqlite3.connect(path.as_uri()+'?mode=ro', uri=True)) as conn:
                courses = {cid: json.loads(body) for cid, body in conn.execute('SELECT id,body FROM courses')}
                tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                notes = {nid: json.loads(body).get('title', 'Nota') for nid, body in conn.execute('SELECT id,body FROM notes')} if 'notes' in tables else {}
                for eid, stamp, cid, lid, body in conn.execute("SELECT id,timestamp,course_id,lesson_id,body FROM events WHERE kind='study_time'"):
                    try:
                        item = json.loads(body)
                        if not isinstance(item,dict): continue
                        # Legacy estimates, hidden/background time and uncertain gaps do not heat days.
                        if item.get('phase') != 'focus' or not item.get('visible') or item.get('uncertain'):
                            continue
                        a, b = _instant(item['startedAt']).timestamp(), _instant(item['endedAt']).timestamp()
                        a, b = max(start, a), min(end, b)
                        if b <= a:
                            continue
                        course = courses.get(cid, {})
                        lesson = next((l for l in course.get('lessons', []) if l['id']==lid), {})
                        meta = {'roomId':scope['id'], 'roomTitle':scope['title'], 'courseId':cid,
                                'courseTitle':course.get('title', ''), 'lessonId':lid,
                                'lessonTitle':lesson.get('title', ''), 'noteId':item.get('noteId',''),
                                'noteTitle':notes.get(item.get('noteId'), ''), 'view':item.get('view','study')}
                        intervals.append((a,b,0 if item.get('tracking')=='automatic' else 1,meta))
                    except (ValueError, TypeError, KeyError, StopIteration, OverflowError):
                        continue
        except (sqlite3.Error, OSError, ValueError):
            warnings.append(scope['title'])
    days = { (first+timedelta(days=i)).isoformat():{'seconds':0,'studySeconds':0,'writingSeconds':0,'items':{}}
             for i in range((last-first).days) }
    points = sorted([(a,1,i) for i,(a,b,p,m) in enumerate(intervals)] + [(b,0,i) for i,(a,b,p,m) in enumerate(intervals)])
    active, heap, previous = set(), [], None
    for at, opening, index in points:
        while heap and heap[0][1] not in active:
            heapq.heappop(heap)
        if previous is not None and at>previous and heap:
            meta = intervals[heap[0][1]][3]
            cursor = datetime.fromtimestamp(previous, timezone.utc)
            stop = datetime.fromtimestamp(at, timezone.utc)
            while cursor<stop:
                day = cursor.astimezone(zone).date()
                boundary = datetime.combine(day+timedelta(days=1), time.min, zone).astimezone(timezone.utc)
                finish = min(stop,boundary)
                seconds = (finish-cursor).total_seconds()
                entry = days[day.isoformat()]
                writing = meta['view'] in ('notes','notebook')
                entry['seconds'] += seconds
                entry['writingSeconds' if writing else 'studySeconds'] += seconds
                key = (meta['roomId'],meta['courseId'],meta['lessonId'],meta['noteId'],meta['view'])
                item = entry['items'].setdefault(key,{**meta,'seconds':0})
                item['seconds'] += seconds
                cursor = finish
        if opening:
            active.add(index)
            heapq.heappush(heap,(intervals[index][2],index))
        else:
            active.discard(index)
        previous = at
    result = []
    for day, values in days.items():
        values['items'] = sorted(values['items'].values(),key=lambda x:-x['seconds'])
        result.append({'date':day,**values})
    return {'year':year,'today':today.isoformat(),'timezone':str(zone),'days':result,
            'seconds':sum(d['seconds'] for d in result),'warnings':warnings}


def summary(ctx, year=None):
    scopes = [{'id':rooms.TUTORIAL_ID,'title':'Primer trazo','db':ctx.DATA/'tutorial'/'learning.sqlite3'}]
    if not rooms.local_retired(ctx.DATA):
        local = rooms.local_scope(ctx.DATA)
        if local is None and (ctx.DATA/rooms.LOCAL_ALIAS_FILE).exists():
            raise ValueError('No se pudo resolver la biblioteca local trasladada.')
        scopes.append({'id':'local','title':local['title'] if local else 'Pliego local',
                       'db':ctx._scope_db(local) if local else ctx.DB})
    for item in rooms.inventory(ctx.DATA,ctx.ROOT,details=False,create=False)['pliegos']:
        scopes.append({'id':item['id'],'title':item['title'],'db':Path(item['path'])/'learning'/'learning.sqlite3'})
    return aggregate(scopes,ctx.LOCAL_ZONE,year or datetime.now(ctx.LOCAL_ZONE).year)
