from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from zoneinfo import ZoneInfo
import json
import sqlite3
import unittest

import activity_calendar


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory()
        self.scopes=[]
        self.now=datetime(2026,10,21,12,tzinfo=timezone.utc)
        for i in range(2):
            db=Path(self.temp.name)/f'{i}.sqlite3'
            with closing(sqlite3.connect(db)) as c, c:
                c.executescript('CREATE TABLE courses(id TEXT,body TEXT); CREATE TABLE notes(id TEXT,body TEXT); CREATE TABLE events(id TEXT,timestamp TEXT,kind TEXT,course_id TEXT,lesson_id TEXT,body TEXT);')
                c.execute('INSERT INTO courses VALUES(?,?)',('c',json.dumps({'title':'Materia','lessons':[{'id':'l','title':'Tema'}]})))
                c.execute('INSERT INTO notes VALUES(?,?)',('n',json.dumps({'title':'Apunte','content':'PRIVATE_TEXT'})))
            self.scopes.append({'id':str(i),'title':f'Pliego {i}','db':db})

    def tearDown(self):
        self.temp.cleanup()

    def insert(self, room, start, end, **extra):
        item={'startedAt':start,'endedAt':end,'visible':True,'uncertain':False,'phase':'focus','view':'study',**extra}
        with closing(sqlite3.connect(self.scopes[room]['db'])) as c, c:
            c.execute('INSERT INTO events VALUES(?,?,?,?,?,?)',('event',start,'study_time','c','l',json.dumps(item)))

    def result(self,year=2026):
        return activity_calendar.aggregate(self.scopes,ZoneInfo('America/Argentina/Buenos_Aires'),year,self.now)

    def test_overlaps_count_once_across_rooms_and_manual_clock(self):
        self.insert(0,'2026-10-19T15:00:00Z','2026-10-19T16:00:00Z')
        self.insert(1,'2026-10-19T15:30:00Z','2026-10-19T16:30:00Z',tracking='automatic',view='notes',noteId='n')
        result=self.result();day=next(d for d in result['days'] if d['date']=='2026-10-19')
        self.assertEqual(result['seconds'],5400)
        self.assertEqual(day['studySeconds'],1800)
        self.assertEqual(day['writingSeconds'],3600)
        self.assertEqual(day['items'][0]['noteTitle'],'Apunte')
        self.assertNotIn('PRIVATE_TEXT',json.dumps(result))

    def test_midnight_and_duplicate_database(self):
        self.insert(0,'2026-10-20T02:59:00Z','2026-10-20T03:01:00Z')
        self.scopes.append(self.scopes[0])
        result=self.result();days={d['date']:d for d in result['days']}
        self.assertEqual(days['2026-10-19']['seconds'],60)
        self.assertEqual(days['2026-10-20']['seconds'],60)
        self.assertEqual(result['seconds'],120)

    def test_hidden_uncertain_break_legacy_and_future_do_not_heat(self):
        for extra in [{'visible':False},{'uncertain':True},{'phase':'break'},{'phase':'pause'}]:
            self.insert(0,'2026-10-19T15:00:00Z','2026-10-19T16:00:00Z',**extra)
        self.insert(0,'2026-12-01T15:00:00Z','2026-12-01T16:00:00Z')
        with closing(sqlite3.connect(self.scopes[0]['db'])) as c, c:
            c.execute('INSERT INTO events VALUES(?,?,?,?,?,?)',('legacy','2026-10-19T15:00:00Z','study_time','c','l',json.dumps({'seconds':3600})))
        self.assertEqual(self.result()['seconds'],0)

    def test_leap_year_and_local_dst_midnight(self):
        self.insert(0,'2024-03-10T04:30:00Z','2024-03-10T07:30:00Z')
        result=activity_calendar.aggregate(self.scopes,ZoneInfo('America/New_York'),2024,self.now)
        self.assertEqual(len(result['days']),366)
        days={d['date']:d['seconds'] for d in result['days']}
        self.assertEqual(days['2024-03-09'],1800)
        self.assertEqual(days['2024-03-10'],9000)

    def test_invalid_year(self):
        with self.assertRaises(ValueError): self.result(9999)
