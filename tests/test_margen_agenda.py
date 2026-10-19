import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime
from zoneinfo import ZoneInfo

import margen_agenda as agenda
import rooms
from scripts.room_backup import workspace
import server

ROOT = Path(__file__).resolve().parents[1]


class MargenAgendaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.data = self.base/'data'
        self.data.mkdir()
        self.margen = self.base/'Margen'
        self.margen.mkdir()
        self.env = patch.dict(os.environ, {'GLOSA_MARGEN_DIR': str(self.margen)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.pliego = rooms.create(self.data, ROOT, 'Materia')
        self.event = dict(roomId=self.pliego['id'], courseId='', title='Clase', kind='class',
                          date='2026-10-19', time='18:00', endTime='20:00',
                          repeatUntil='2026-11-30', excludedDates=['2026-10-26'])

    def save(self, **changes):
        return agenda.save(self.data, ROOT, {'expectedRevision': 0, 'event': {**self.event, **changes}})

    def test_class_window_repeat_exception_and_immutable_reads(self):
        saved = self.save()
        path = self.margen/'.glosa-agenda.json'
        before = path.read_bytes()
        for stamp, expected in [('2026-10-19T17:44', 0), ('2026-10-19T17:45', 1),
                                ('2026-10-19T19:59', 1), ('2026-10-19T20:00', 0),
                                ('2026-10-26T18:30', 0), ('2026-11-02T18:30', 1)]:
            now = datetime.fromisoformat(stamp).replace(tzinfo=ZoneInfo(saved['timezone']))
            state = agenda.snapshot(self.data, ROOT, now)
            self.assertEqual(len(state['activeClasses']), expected, stamp)
        self.assertEqual(path.read_bytes(), before)
        self.assertTrue((self.margen/'Materia/learning/learning.sqlite3').is_file())

    def test_preclass_window_can_begin_on_previous_date(self):
        self.save(date='2026-10-20', time='00:05', endTime='01:00', repeatUntil='')
        state = agenda.snapshot(self.data, ROOT, datetime(2026,10,19,23,50,tzinfo=ZoneInfo('America/Argentina/Buenos_Aires')))
        self.assertEqual(len(state['activeClasses']), 1)
        self.assertFalse(state['activeClasses'][0]['started'])

    def test_revision_edit_delete_and_missing_room(self):
        saved = self.save()
        with self.assertRaisesRegex(ValueError, 'cambió'):
            self.save()
        event = {**saved['events'][0], 'title': 'Cambio'}
        edited = agenda.save(self.data, ROOT, {'expectedRevision': 1, 'event': event})
        self.assertEqual(edited['events'][0]['id'], event['id'])
        result = agenda.save(self.data, ROOT, {'expectedRevision': 2, 'action': 'delete', 'id': event['id']})
        self.assertEqual(result['events'], [])
        with self.assertRaisesRegex(ValueError, 'pliego'):
            agenda.save(self.data, ROOT, {'expectedRevision': 3, 'event': {**self.event, 'roomId': '../foreign'}})

    def test_overlapping_classes_all_surface_and_other_calendar_is_aggregated(self):
        self.save()
        second = rooms.create(self.data, ROOT, 'Otra materia')
        agenda.save(self.data, ROOT, {'expectedRevision': 1, 'event': {**self.event, 'roomId': second['id']}})
        state = agenda.snapshot(self.data, ROOT, datetime(2026,10,19,18,30,tzinfo=ZoneInfo('America/Argentina/Buenos_Aires')))
        self.assertEqual({e['roomId'] for e in state['activeClasses']}, {self.pliego['id'], second['id']})
        scope = rooms.room(self.data, ROOT, second['id'])
        with workspace(scope['root'], scope['data']):
            with server.connect() as conn:
                event = dict(id='exam', title='Examen', kind='exam', courseId='a', date='2026-10-20')
                conn.execute('INSERT INTO calendar_events VALUES(?,?)', ('exam',json.dumps(event)))
        state = agenda.snapshot(self.data, ROOT, datetime(2026,10,19,18,30,tzinfo=ZoneInfo('America/Argentina/Buenos_Aires')))
        self.assertTrue(any(e['id']=='exam' and e['roomId']==second['id'] for e in state['upcoming']))

    def test_invalid_times_and_course_are_rejected_without_writing(self):
        for changes in ({'endTime':''}, {'endTime':'17:00'}, {'time':'9:00'}, {'repeatUntil':'2030-01-01'}, {'courseId':'missing'}, {'excludedDates':['bad']}):
            with self.subTest(changes=changes), self.assertRaises((ValueError, TypeError)):
                self.save(**changes)
            self.assertFalse((self.margen/'.glosa-agenda.json').exists())

    def test_read_empty_does_not_create_agenda(self):
        self.assertEqual(agenda.load(self.data)['revision'], 0)
        self.assertFalse((self.margen/'.glosa-agenda.json').exists())


if __name__ == '__main__':
    unittest.main()
