from contextlib import closing
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest

from library import Library
import note_consolidation


class TitleTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);self.lib=Library(root/'test.db',root,root);self.lib.initialize([])
        with self.lib.connect() as c:
            c.executescript('CREATE TABLE courses(id TEXT,body TEXT); CREATE TABLE events(id TEXT,course_id TEXT,lesson_id TEXT,kind TEXT,body TEXT);')
        self.history=[];self.ctx=SimpleNamespace(library=lambda:self.lib,event=lambda *args:self.history.append(args))

    def note(self,title,content='Texto',**kwargs):
        return self.lib.save_note({'title':title,'content':content,'folder':'','shared':False,'documentId':None,'page':None,'anchors':[],**kwargs})

    def test_name_collision_is_rejected_without_overwriting(self):
        original=self.note('  Mi Concepto  ')
        with self.assertRaisesRegex(ValueError,'Ya existe'):self.note('mi   concepto','Otro texto')
        state=self.lib.snapshot();self.assertEqual(len(state['notes']),1);self.assertEqual(state['notes'][0]['content'],'Texto')
        updated=self.note(original['title'],'Editado',id=original['id'],revision=original['revision'])
        self.assertEqual(updated['id'],original['id']);self.assertEqual(updated['revision'],2)

    def test_consolidation_preserves_content_versions_privacy_and_redirects(self):
        first=self.note('Concepto','Primera explicación')
        second=self.note('Otro título','Segunda explicación',shared=True)
        # Simulate a legacy duplicate using the old persisted representation.
        second['title']='concepto'
        with self.lib.connect() as c:
            self.lib._write_note_file(c,second)
            c.execute('UPDATE notes SET body=? WHERE id=?',(json.dumps(second),second['id']))
            course={'id':'c','version':'v','lessons':[{'id':'l','blocks':[{'id':'b','text':'Ver [concepto](#note='+second['id']+').'}]}]}
            c.execute('INSERT INTO courses VALUES(?,?)',('c',json.dumps(course)))
        result=note_consolidation.consolidate(self.ctx);self.assertEqual(result['merged'],1)
        state=self.lib.snapshot();self.assertEqual(len(state['notes']),1)
        merged=state['notes'][0];self.assertIn('Primera explicación',merged['content']);self.assertIn('Segunda explicación',merged['content']);self.assertFalse(merged['shared'])
        self.assertEqual(state['deletedNotes'][0]['mergedInto'],merged['id'])
        self.assertGreaterEqual(len(state['noteVersions']),2)
        with closing(self.lib.connect()) as c:
            updated=json.loads(c.execute('SELECT body FROM courses').fetchone()[0])
        self.assertIn('#note='+merged['id'],updated['lessons'][0]['blocks'][0]['text'])
        self.assertEqual(note_consolidation.consolidate(self.ctx)['merged'],0)

    def test_header_only_note_does_not_add_duplicate_heading_or_empty_section(self):
        first=self.note('maestro','# maestro\n\n ',contentFormat='markdown')
        second=self.note('otro','# maestro\n\nEl maestro identifica entidades reutilizables',contentFormat='markdown')
        second['title']='maestro'
        with self.lib.connect() as c:
            self.lib._write_note_file(c,second)
            c.execute('UPDATE notes SET body=? WHERE id=?',(json.dumps(second),second['id']))
        note_consolidation.consolidate(self.ctx)
        note=self.lib.snapshot()['notes'][0]
        self.assertEqual(note['content'],'# maestro\n\nEl maestro identifica entidades reutilizables')
        self.assertNotIn('---',note['content'])
