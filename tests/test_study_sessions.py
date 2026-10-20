import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import study_sessions


class StudySessionsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'test.sqlite3'
        def connect():
            conn = sqlite3.connect(self.path)
            conn.row_factory = sqlite3.Row
            return conn
        self.ctx = SimpleNamespace(connect=connect, LOCAL_ZONE=ZoneInfo('America/Argentina/Buenos_Aires'), active_workspace=lambda: {'id':'test'})
        with connect() as conn:
            conn.executescript('CREATE TABLE events(id TEXT PRIMARY KEY,timestamp TEXT,kind TEXT,course_id TEXT,lesson_id TEXT,body TEXT); CREATE TABLE courses(id TEXT PRIMARY KEY,body TEXT);')
            conn.execute('INSERT INTO courses VALUES(?,?)', ('c', json.dumps({'title':'Curso'})))
        self.segment = dict(id='one', sessionId='s', deviceId='d', courseId='c', lessonId='l', mode='pomodoro', timezone='America/Argentina/Buenos_Aires', plannedSeconds=1500, startedAt='2026-10-20T02:59:00Z', endedAt='2026-10-20T03:01:00Z', phase='focus', visible=True, uncertain=False, view='study', courseVersion='v', goal='Repasar')

    def test_automatic_tracking_stays_out_of_manual_clock_summary(self):
        study_sessions.save(self.ctx, {'segments': [{**self.segment, 'tracking':'automatic'}]})
        self.assertEqual(self.summary()['total']['focusSeconds'], 0)

    def tearDown(self):
        self.tmp.cleanup()

    def summary(self):
        return study_sessions.summary(self.ctx, '2026-10-19', '2026-10-20', datetime(2026,10,20,12,tzinfo=timezone.utc))

    def test_clock_telemetry_is_excluded_from_tutor_history(self):
        import tutor_context
        course = {'id': 'c', 'version': 'v', 'title': 'Materia', 'sources': [],
                  'lessons': [{'id': 'l', 'title': 'Tema', 'blocks': [], 'exercises': []}]}
        events = [{'id': kind, 'kind': kind, 'courseId': 'c', 'lessonId': 'l',
                   'data': {'courseVersion': 'v', 'text': 'TELEMETRIA_PRIVADA' if kind != 'answer' else 'Respuesta propia'}}
                  for kind in ['study_time', 'study_session', 'answer']]
        state = {'courses': [course], 'events': events, 'library': {'notes': [], 'documents': []}, 'settings': {}}
        result = tutor_context.build(None, state, {'kind': 'study', 'courseId': 'c', 'lessonId': 'l'})
        self.assertNotIn('TELEMETRIA_PRIVADA', json.dumps(result['payload']))
        self.assertIn('Respuesta propia', json.dumps(result['payload']))

    def test_deduplication_conflict_and_atomicity(self):
        result = study_sessions.save(self.ctx, {'segments':[self.segment,self.segment]})
        self.assertEqual((result['inserted'],result['duplicates']), (1,1))
        with self.assertRaises(ValueError):
            study_sessions.save(self.ctx, {'segments':[{**self.segment,'id':'two'}, {**self.segment,'goal':'Changed'}]})
        with self.ctx.connect() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM events').fetchone()[0], 1)

    def test_local_midnight_and_break(self):
        study_sessions.save(self.ctx, {'segments':[self.segment, {**self.segment,'id':'break','phase':'break'}]})
        result = self.summary()
        self.assertEqual([day['focusSeconds'] for day in result['days']], [60,60])
        self.assertEqual(result['total']['breakSeconds'],120)
        self.assertEqual(result['today']['focusSeconds'],60)
        self.assertEqual(result['courses'][0]['focusSeconds'],120)

    def test_sessions_do_not_add_minutes(self):
        common = {k:v for k,v in self.segment.items() if k in ('id','sessionId','deviceId','mode','plannedSeconds','goal','courseId','lessonId','timezone')}
        study_sessions.save(self.ctx, {'sessions':[{**common,'action':'finish','timestamp':'2026-10-20T10:00:00Z','rating':'okay'}]})
        result = self.summary()
        self.assertEqual(result['total']['focusSeconds'],0)
        self.assertEqual(result['total']['sessionsFinished'],1)

    def test_legacy_estimated_visible(self):
        with self.ctx.connect() as conn:
            conn.execute('INSERT INTO events VALUES(?,?,?,?,?,?)', ('old','2026-10-20T10:00:00Z','study_time','c','l',json.dumps({'seconds':120})))
        result = self.summary()['total']
        self.assertEqual(result['focusSeconds'],120)
        self.assertEqual(result['visibleSeconds'],120)
        self.assertEqual(result['uncertainSeconds'],120)
        self.assertEqual(result['sessionsFinished'],0)

    def test_legacy_interval_clipped_to_requested_range(self):
        with self.ctx.connect() as conn:
            conn.execute('INSERT INTO events VALUES(?,?,?,?,?,?)', ('old','2000-01-01T00:00:00Z','study_time','c','l',json.dumps({'seconds':100*366*86400})))
        result = self.summary()
        self.assertEqual(result['total']['focusSeconds'], 2*86400)
        self.assertEqual([day['focusSeconds'] for day in result['days']], [86400,86400])

    def test_dst_elapsed_time(self):
        self.ctx.LOCAL_ZONE=ZoneInfo('America/New_York')
        study_sessions.save(self.ctx, {'segments':[{**self.segment,'startedAt':'2026-11-01T00:30:00-04:00','endedAt':'2026-11-01T02:30:00-05:00'}]})
        result=study_sessions.summary(self.ctx,'2026-11-01','2026-11-01')
        self.assertEqual(result['total']['focusSeconds'],10800)

    def test_validation(self):
        for change in ({'startedAt':'2026-10-20T00:00:00'}, {'endedAt':'2026-10-24T00:00:00Z'}, {'visible':1}, {'plannedSeconds':float('nan')}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                study_sessions.save(self.ctx, {'segments':[{**self.segment,**change}]})
        with self.assertRaises(ValueError): study_sessions.save(self.ctx, {'segments':[self.segment]*101})


if __name__=='__main__': unittest.main()
