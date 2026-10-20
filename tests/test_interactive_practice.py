import copy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class InteractivePracticeTests(unittest.TestCase):
    def setUp(self):
        self.course = json.loads((server.ROOT / 'courses/tutorial.json').read_text())
        self.practice = {'kind': 'classify', 'title': 'Relacionar', 'prompt': 'Elegí categoría',
                         'categories': ['A', 'B'], 'items': [
                             {'id': 'x', 'text': 'Uno', 'answer': 'A'},
                             {'id': 'y', 'text': 'Dos', 'answer': 'B'}], 'explanation': 'Razones'}
        self.course['lessons'][0]['interactive'] = self.practice

    def test_valid_classification_and_order(self):
        server.validate_course(self.course)
        self.practice['kind'] = 'order'
        for i, item in enumerate(self.practice['items']):
            item['answer'] = str(i + 1)
        server.validate_course(self.course)
        self.practice['items'][1]['answer'] = '1'
        with self.assertRaises(ValueError):
            server.validate_course(self.course)

    def test_rejects_malformed_and_unbounded_practice(self):
        for field, value in [('items', []), ('categories', ['A', 'A']), ('title', 'x' * 201),
                             ('explanation', ''), ('kind', 'html')]:
            with self.subTest(field=field):
                course = copy.deepcopy(self.course)
                course['lessons'][0]['interactive'][field] = value
                with self.assertRaises(ValueError):
                    server.validate_course(course)
        self.practice['items'][0]['answer'] = '<script>'
        with self.assertRaises(ValueError):
            server.validate_course(self.course)


if __name__ == '__main__':
    unittest.main()
