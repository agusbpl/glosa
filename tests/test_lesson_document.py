import json
import re
import unittest
import lesson_document
from tests import test_lesson_export as fixtures


class DocumentTests(unittest.TestCase):
    def test_document_is_safe_and_self_contained(self):
        fixture = fixtures.LessonExportTests(); fixture.setUp()
        fixture.lesson['blocks'][0]['text'] += '</script><script>ATTACK</script>'
        result = lesson_document.render(fixture.state, fixture.body).decode()
        self.assertNotIn('SECRET', result)
        self.assertNotIn('SOLUTION', result)
        self.assertNotIn('<script>ATTACK</script>', result)
        self.assertNotIn('src="/', result)
        self.assertIn("connect-src &#x27;none&#x27;", result)
        payload = json.loads(re.search(r'type="application/json">(.*?)</script>', result, re.S)[1])
        self.assertIn('</script>', payload['courses'][0]['lessons'][0]['blocks'][0]['text'])
        self.assertEqual(len(payload['courses'][0]['lessons']), 1)

    def test_solutions_require_opt_in(self):
        fixture = fixtures.LessonExportTests(); fixture.setUp()
        fixture.body['includeSolutions'] = True
        self.assertIn('SOLUTION', lesson_document.render(fixture.state, fixture.body).decode())
