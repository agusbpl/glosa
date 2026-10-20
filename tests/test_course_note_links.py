from contextlib import closing
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

import course_note_links


class LinkTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.db=Path(self.temp.name)/'test.db';self.history=[]
        def connect():
            c=sqlite3.connect(self.db);c.row_factory=sqlite3.Row;return c
        self.ctx=SimpleNamespace(connect=connect,event=lambda *args:self.history.append(args))
        self.text='😀 Antes [término](#note=gone) después [otro](#note=keep).'
        self.course={'id':'c','version':'v','lessons':[{'id':'l','blocks':[{'id':'b','text':self.text}]},{'id':'l2','blocks':[]}]}
        units=lambda s:len(s.encode('utf-16-le'))//2
        with closing(connect()) as c,c:
            c.executescript('CREATE TABLE courses(id TEXT,body TEXT); CREATE TABLE events(id TEXT,course_id TEXT,lesson_id TEXT,kind TEXT,body TEXT);')
            c.execute('INSERT INTO courses VALUES(?,?)',('c',json.dumps(self.course)))
            for i,quote in enumerate(('Antes','término','después')):
                start=units(self.text[:self.text.index(quote)])
                c.execute('INSERT INTO events VALUES(?,?,?,?,?)',(str(i),'c','l','annotation',json.dumps({'courseVersion':'v','blockId':'b','start':start,'end':start+units(quote),'quote':quote})))
            c.execute('INSERT INTO events VALUES(?,?,?,?,?)',('other','c','l2','annotation',json.dumps({'courseVersion':'v','quote':'Otra lección'})))
        self.body={'courseId':'c','lessonId':'l','blockId':'b','noteId':'gone','version':'v'}

    def tearDown(self):self.temp.cleanup()

    def test_unlink_preserves_text_unicode_other_links_and_annotations(self):
        course_note_links.unlink(self.ctx,self.body)
        with closing(self.ctx.connect()) as c:
            course=json.loads(c.execute('SELECT body FROM courses').fetchone()[0]);text=course['lessons'][0]['blocks'][0]['text']
            self.assertEqual(text,'😀 Antes término después [otro](#note=keep).')
            for row in c.execute('SELECT body FROM events'):
                data=json.loads(row[0]);self.assertEqual(data['courseVersion'],course['version'])
                if 'start' in data:self.assertEqual(text.encode('utf-16-le')[data['start']*2:data['end']*2].decode('utf-16-le'),data['quote'])
        self.assertEqual(self.history[0][3]['previousCourse'],self.course)

    def test_stale_request_does_not_modify_course(self):
        with self.assertRaises(ValueError):course_note_links.unlink(self.ctx,{**self.body,'version':'old'})
        with closing(self.ctx.connect()) as c:self.assertEqual(json.loads(c.execute('SELECT body FROM courses').fetchone()[0]),self.course)
