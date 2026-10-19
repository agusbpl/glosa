"""A pliego's assets directory is not the application's Python runtime."""
import base64
from pathlib import Path
import tempfile
import unittest
from library import Library
from tests.helpers.fixture_workspace import fixture_pdf


class DocumentUploadRuntimeTests(unittest.TestCase):
    def test_upload_uses_application_runtime_for_separate_pliego_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            data, assets = base/'learning', base/'assets'
            data.mkdir(); assets.mkdir()
            library = Library(data/'learning.sqlite3', data, assets)
            library.initialize([])
            document = library.upload('PDF temporal', base64.b64encode(fixture_pdf()).decode())
            self.assertEqual(document['pages'], 2)
            self.assertEqual(library.document_path(document).parent, data/'documents')
            extracted = library.pages(document['id'], 1, 2)
            self.assertEqual(len(extracted['pages']), 2)
            self.assertIn('PDF temporal', extracted['pages'][0]['text'])
            self.assertEqual(library.upload('Otra vez', base64.b64encode(fixture_pdf()).decode())['id'], document['id'])
