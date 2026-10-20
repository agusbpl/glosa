import json
import unittest
import lesson_export


class LessonExportTests(unittest.TestCase):
    def setUp(self):
        self.lesson = {'id': 'l', 'title': 'Tema', 'blocks': [{'id': 'b', 'text': '[A](#note=a)', 'references': [{'sourceId': 's', 'page': 3, 'private': 'SECRET'}]}], 'exercises': [{'id': 'e', 'type': 'choice', 'question': '¿Cuál?', 'options': ['A', 'B'], 'correctIndex': 1, 'explanation': 'SOLUTION', 'acceptedAnswer': 'SOLUTION', 'rubric': ['SECRET']}], 'interactive': {'kind': 'classify', 'title': 'Práctica', 'prompt': 'Ubicar', 'categories': ['uno', 'dos'], 'explanation': 'SOLUTION', 'items': [{'id': 'i', 'text': 'Registro', 'answer': 'ANSWER_SECRET', 'private': 'SECRET'}]}, 'adaptationRationale': 'SECRET'}
        self.state = {'room': {'title': 'Pliego'}, 'courses': [{'id': 'c', 'title': 'Curso', 'lessons': [self.lesson, {'id': 'other', 'title': 'Otro', 'blocks': [{'text': '[D](#note=d)'}]}], 'sources': [{'id': 's', 'title': 'Fuente', 'url': 'http://localhost:8765/source?file=/home/secret', 'path': '/home/SECRET'}], 'tutorStrategy': 'SECRET'}], 'events': ['SECRET'], 'settings': {'key': 'SECRET'}, 'library': {'notes': [{'id': 'a', 'title': 'A', 'content': '[B](#note-b)', 'shared': True}, {'id': 'b', 'title': 'B', 'content': 'Contenido privado autorizado', 'shared': False, 'history': 'SECRET'}, {'id': 'd', 'title': 'D', 'content': 'UNRELATED_SECRET', 'shared': True}, {'id': 'p', 'title': 'Privada', 'content': 'PRIVATE_SECRET', 'shared': False}]}}
        self.body = {'selection': [{'courseId': 'c', 'lessonIds': ['l']}], 'noteIds': ['a']}

    def test_inventory_contains_only_referenced_metadata(self):
        inv = lesson_export.inventory(self.state)
        self.assertEqual({n['id'] for n in inv['notes']}, {'a', 'b', 'd'})
        self.assertNotIn('content', json.dumps(inv))
        self.assertFalse(next(n for n in inv['notes'] if n['id'] == 'b')['shared'])
        self.assertEqual(next(n for n in inv['notes'] if n['id'] == 'b')['referencedBy'], [{'courseId': 'c', 'lessonId': 'l'}])

    def test_safe_projection_without_solutions(self):
        payload = lesson_export.build_payload(self.state, self.body)
        raw = json.dumps(payload)
        for forbidden in ('SECRET', 'SOLUTION', 'correctIndex', 'acceptedAnswer', 'rubric', 'localhost', '/home/', 'Contenido privado'):
            self.assertNotIn(forbidden, raw)
        self.assertEqual(len(payload['courses'][0]['lessons']), 1)
        self.assertEqual([n['id'] for n in payload['notes']], ['a'])

    def test_explicit_private_note_and_solutions(self):
        self.body.update(noteIds=['a', 'b'], includeSolutions=True)
        payload = lesson_export.build_payload(self.state, self.body)
        self.assertEqual(payload['notes'][1]['content'], 'Contenido privado autorizado')
        self.assertEqual(payload['courses'][0]['lessons'][0]['interactive']['items'][0]['answer'], 'ANSWER_SECRET')
        self.assertNotIn('rubric', json.dumps(payload))

    def test_invalid_selections_and_note_authorization(self):
        for update in ({'noteIds': ['d']}, {'noteIds': ['a', 'a']}, {'selection': [{'courseId': 'c', 'lessonIds': ['l', 'l']}]}, {'selection': [{'courseId': 'c', 'lessonIds': ['missing']}]}, {'selection': [self.body['selection'][0]] * 2}, {'selection': []}, {'includeSolutions': 'yes'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                lesson_export.build_payload(self.state, {**self.body, **update})

    def test_cycle_terminates(self):
        self.state['library']['notes'][1]['content'] = '[A](#note=a)'
        self.assertEqual(len(lesson_export.inventory(self.state)['notes']), 3)

    def test_exam_does_not_export_tutor_context_or_referenced_notes(self):
        for mode in ('explicit', 'implicit'):
            with self.subTest(mode=mode):
                self.lesson['title'] = 'Simulacro final'
                if mode == 'explicit':
                    self.lesson['mode'] = 'exam'
                else:
                    self.lesson.pop('mode', None)
                self.lesson['intro'] = 'EXAM_SECRET'
                self.lesson['blocks'][0]['text'] = 'EXAM_SECRET [A](#note=a)'
                self.body['noteIds'] = []
                out = lesson_export.build_payload(self.state, self.body)
                self.assertNotIn('EXAM_SECRET', json.dumps(out))
                self.assertEqual(out['courses'][0]['lessons'][0]['mode'], 'exam')
                self.assertEqual(out['courses'][0]['lessons'][0]['exercises'][0]['question'], '¿Cuál?')
                self.assertNotIn('interactive', json.dumps(out))
                self.assertNotIn('a', [n['id'] for n in lesson_export.inventory(self.state)['notes']])

    def test_links_scrubbed_before_serialization_and_dotted_ids(self):
        self.state['library']['notes'][0]['id'] = 'concept.erp'
        self.state['library']['notes'][0]['content'] = '[privada](file:///home/PRIVATE_PATH) [doc](/documents/PRIVATE_PATH) [script](javascript:alert(1)) [web](https://example.com/page)'
        self.lesson['blocks'][0]['text'] = '[ERP](#note=concept.erp) [ruta](/home/PRIVATE_PATH) [local](http://localhost/PRIVATE_PATH)'
        self.body['noteIds'] = ['concept.erp']
        out = lesson_export.build_payload(self.state, self.body)
        raw = json.dumps(out)
        self.assertNotIn('PRIVATE_PATH', raw)
        self.assertNotIn('javascript:', raw)
        self.assertIn('https://example.com/page', raw)
        self.assertIn('#note=concept.erp', raw)
        self.assertIsNone(lesson_export._https('https://[invalid'))
        self.assertNotIn('a' * 101, lesson_export._links('#note=' + 'a' * 101))


if __name__ == '__main__':
    unittest.main()
