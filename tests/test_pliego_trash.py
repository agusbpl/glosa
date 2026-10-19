"""Deleting a pliego moves its complete folder; all fixtures are temporary."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import rooms

ROOT = Path(__file__).resolve().parents[1]


class PliegoTrashTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.data = self.base/'data'; self.data.mkdir()
        self.margen = self.base/'Margen'; self.margen.mkdir()
        env = patch.dict(os.environ, {'GLOSA_MARGEN_DIR': str(self.margen)})
        env.start(); self.addCleanup(env.stop)

    def test_complete_folder_is_preserved_and_can_be_restored(self):
        item = rooms.create(self.data, ROOT, 'Eliminar')
        folder = Path(item['path'])
        (folder/'Apuntes').mkdir()
        (folder/'Apuntes'/'personal.md').write_text('Contenido temporal')
        before = {p.relative_to(folder): p.read_bytes() for p in folder.rglob('*') if p.is_file()}
        result = rooms.trash(self.data, ROOT, item['id'])
        trashed = Path(result['trashPath'])
        self.assertFalse(folder.exists())
        self.assertEqual(rooms.inventory(self.data, ROOT)['pliegos'], [])
        self.assertEqual(before, {p.relative_to(trashed): p.read_bytes() for p in trashed.rglob('*') if p.is_file()})
        with self.assertRaises(ValueError): rooms.room(self.data, ROOT, item['id'])
        trashed.rename(folder)
        self.assertEqual(rooms.inventory(self.data, ROOT)['pliegos'][0]['id'], item['id'])

    def test_registered_pliego_cannot_be_rediscovered_through_registry(self):
        item = rooms.create(self.data, ROOT, 'Registrado')
        (self.data/'rooms.json').write_text(json.dumps([item]))
        rooms.trash(self.data, ROOT, item['id'])
        self.assertEqual(rooms.registry(self.data), [])
        self.assertEqual(rooms.inventory(self.data, ROOT)['pliegos'], [])

    def test_special_unknown_and_path_ids_are_rejected(self):
        for item in ('local', 'primer-trazo', '../other', None):
            with self.subTest(item=item), self.assertRaises(ValueError): rooms.trash(self.data, ROOT, item)

    def test_trash_names_do_not_overwrite_and_symlinks_are_rejected(self):
        one = rooms.create(self.data, ROOT, 'Mismo nombre')
        first = rooms.trash(self.data, ROOT, one['id'])
        two = rooms.create(self.data, ROOT, 'Mismo nombre')
        second = rooms.trash(self.data, ROOT, two['id'])
        self.assertNotEqual(first['trashPath'], second['trashPath'])
        self.assertTrue(Path(first['trashPath']).exists())
