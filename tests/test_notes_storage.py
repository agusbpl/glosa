"""Almacenamiento de apuntes como Markdown original (SQLite = índice).

Cubren los riesgos reales de sobreescritura detectados en la revisión: archivo
ajeno con el mismo título, edición/rename/borrado externos sin snapshot
intermedio, segunda migración sobre un .md editado, dry-run read-only y archivos
duplicados. Todo con datos temporales.
"""
import json
import os
import tempfile
import unittest
from pathlib import Path

import note_files
from library import Library


class NotesStorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='glosa-notes-storage-')
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        self.lib = Library(self.data/'notes.sqlite3', self.data, self.data)
        self.lib.initialize([])
        self.root = self.lib.notes_root()

    def note(self, **overrides):
        body = dict(title='Apunte', folder='', content='Texto original', shared=False,
                    documentId=None, page=None, anchors=[])
        body.update(overrides)
        return self.lib.save_note(body)

    def add_doc(self, doc_id='pdf-1', pages=3):
        doc = {'id': doc_id, 'title': 'PDF temporal', 'sha256': '0'*64, 'pages': pages,
               'storage': 'upload', 'filename': doc_id+'.pdf'}
        with self.lib.connect() as conn:
            conn.execute('INSERT INTO documents VALUES(?,?)', (doc['id'], json.dumps(doc)))
        return doc

    def rel(self, note_id):
        return self.lib.note_file(note_id).relative_to(self.root).as_posix()

    # --- Archivo ajeno no se pisa ----------------------------------------- #

    def test_foreign_markdown_same_title_is_never_overwritten(self):
        self.root.mkdir(parents=True, exist_ok=True)
        foreign = self.root/'Apunte.md'
        foreign.write_text('# Apunte\n\nTexto ajeno que no es de Glosa.\n', encoding='utf-8')
        before = foreign.read_bytes()
        with self.assertRaisesRegex(ValueError,'Ya existe'):
            self.note(title='Apunte', content='Mi texto de Glosa')
        self.assertEqual(foreign.read_bytes(), before)
        adopted = [n for n in self.lib.snapshot()['notes'] if 'Texto ajeno' in n['content']]
        self.assertEqual(len(adopted), 1)

    # --- Formato roto: conflicto explícito, nunca sobrescribir ------------- #

    def test_save_after_external_corruption_is_conflict(self):
        note = self.note()
        path = self.lib.note_file(note['id'])
        path.write_bytes(b'---\ntitle: roto\n')  # frontmatter sin cerrar
        before = path.read_bytes()
        with self.assertRaises(ValueError):
            self.lib.save_note({**note, 'content': 'No debe pisar'})
        self.assertEqual(path.read_bytes(), before)

    # --- Rename/move externo sin snapshot ---------------------------------- #

    def test_save_without_snapshot_after_external_move_keeps_id(self):
        note = self.note(folder='')
        old = self.lib.note_file(note['id'])
        moved_dir = self.root/'Materia'
        moved_dir.mkdir()
        os.replace(old, moved_dir/'Apunte.md')
        with self.assertRaises(ValueError):
            self.lib.save_note(note)  # revisión vieja tras el movimiento
        state = self.lib.snapshot()
        active = [n for n in state['notes'] if n['id'] == note['id']]
        self.assertEqual(len(active), 1)
        self.assertEqual(active[0]['folder'], 'Materia')
        self.assertEqual(self.rel(note['id']), 'Materia/Apunte.md')
        self.assertFalse((self.root/'Apunte.md').exists())

    def test_save_without_snapshot_after_external_delete_does_not_resurrect(self):
        note = self.note()
        path = self.lib.note_file(note['id'])
        path.unlink()
        with self.assertRaises(ValueError):
            self.lib.save_note({**note, 'content': 'No debe resucitar'})
        state = self.lib.snapshot()
        self.assertEqual([n for n in state['notes'] if n['id'] == note['id']], [])
        self.assertEqual(len([n for n in state['deletedNotes'] if n['id'] == note['id']]), 1)
        self.assertFalse(path.exists())

    # --- Edición externa del texto de una página --------------------------- #

    def test_external_page_edit_is_adopted_without_moving_others(self):
        doc = self.add_doc(pages=3)
        note = self.lib.save_note(dict(title='Con páginas', folder='', content='General',
                                       shared=False, documentId=doc['id'], page=1,
                                       writingScope='page', pageNotes={doc['id']: {'1': 'uno', '2': 'dos'}},
                                       anchors=[]))
        path = self.lib.note_file(note['id'])
        path.write_text(path.read_text(encoding='utf-8').replace('dos', 'dos editado afuera'), encoding='utf-8')
        updated = next(n for n in self.lib.snapshot()['notes'] if n['id'] == note['id'])
        self.assertEqual(updated['pageNotes'][doc['id']]['2'], 'dos editado afuera')
        self.assertEqual(updated['pageNotes'][doc['id']]['1'], 'uno')
        self.assertEqual(updated['content'], 'General')

    # --- Borrado: a papelera oculta, sin perder texto ---------------------- #

    def test_delete_moves_file_to_hidden_trash(self):
        note = self.note()
        path = self.lib.note_file(note['id'])
        self.lib.delete_note(note)
        self.assertFalse(path.exists())
        self.assertIsNone(self.lib.note_file(note['id']))
        self.assertTrue((self.root/'.glosa-eliminados'/'Apunte.md').is_file())

    # --- Migración idempotente y dry-run read-only ------------------------- #

    def _insert_legacy(self, **overrides):
        body = {'id': 'legacy-1', 'title': 'Viejo', 'folder': '', 'content': 'Texto original',
                'shared': False, 'documentId': None, 'page': None, 'anchors': [],
                'writingScope': 'general', 'pageNotes': {},
                'createdAt': '2026-01-01T00:00:00+00:00', 'updatedAt': '2026-01-01T00:00:00+00:00',
                'revision': 1}
        body.update(overrides)
        with self.lib.connect() as conn:
            conn.execute('INSERT INTO notes VALUES(?,?)', (body['id'], json.dumps(body, ensure_ascii=False)))
        return body

    def test_migration_dry_run_is_read_only(self):
        self._insert_legacy()
        db = self.data/'notes.sqlite3'
        before_bytes, before_mtime = db.read_bytes(), db.stat().st_mtime_ns
        self.assertFalse(self.root.exists())
        plan = self.lib.migrate_notes_to_files(dry_run=True)
        self.assertEqual(plan['notes'][0]['action'], 'export')
        self.assertFalse(self.root.exists())
        self.assertEqual(db.read_bytes(), before_bytes)
        self.assertEqual(db.stat().st_mtime_ns, before_mtime)

    def test_migration_second_run_imports_external_edit(self):
        self._insert_legacy()
        plan = self.lib.migrate_notes_to_files(dry_run=True)
        self.assertEqual(plan['notes'][0]['action'], 'export')
        self.assertEqual(self.lib.migrate_notes_to_files(), plan)
        path = self.lib.note_file('legacy-1')
        self.assertEqual(self.rel('legacy-1'), 'Viejo.md')
        # Edición externa después de migrar.
        path.write_text(path.read_text(encoding='utf-8').replace('Texto original', 'Texto editado afuera'), encoding='utf-8')
        plan2 = self.lib.migrate_notes_to_files(dry_run=True)
        self.assertEqual(plan2['notes'][0]['action'], 'import-external')
        self.lib.migrate_notes_to_files()
        self.assertIn('Texto editado afuera', path.read_text(encoding='utf-8'))
        note = next(n for n in self.lib.snapshot()['notes'] if n['id'] == 'legacy-1')
        self.assertEqual(note['content'], 'Texto editado afuera')

    def test_migration_does_not_reexport_over_invalid_file(self):
        self._insert_legacy()
        self.lib.migrate_notes_to_files()
        path = self.lib.note_file('legacy-1')
        path.write_bytes(b'---\ntitle: roto\n')
        before = path.read_bytes()
        self.lib.migrate_notes_to_files()
        self.assertEqual(path.read_bytes(), before)

    def test_migration_does_not_resurrect_externally_deleted_note(self):
        note = self.note()
        path = self.lib.note_file(note['id'])
        path.unlink()
        # La migración no debe reexportar desde SQLite un archivo borrado afuera.
        self.lib.migrate_notes_to_files()
        self.assertFalse(path.exists())
        state = self.lib.snapshot()
        self.assertEqual([n for n in state['notes'] if n['id'] == note['id']], [])
        self.assertEqual(len([n for n in state['deletedNotes'] if n['id'] == note['id']]), 1)

    # --- Duplicados y repetidos ------------------------------------------- #

    def test_duplicate_glosa_id_files_are_reported_and_untouched(self):
        note = self.note()
        path = self.lib.note_file(note['id'])
        duplicate = self.root/'Copia.md'
        duplicate.write_text(path.read_text(encoding='utf-8'), encoding='utf-8')
        before_a, before_b = path.read_bytes(), duplicate.read_bytes()
        state = self.lib.snapshot()
        self.assertTrue(any('mismo ID' in warning for warning in state['noteWarnings']))
        self.assertEqual(path.read_bytes(), before_a)
        self.assertEqual(duplicate.read_bytes(), before_b)
        self.assertEqual(len([n for n in state['notes'] if n['id'] == note['id']]), 1)

    def test_repeated_titles_reuse_existing_identity_for_editing(self):
        first = self.note(title='Repetido')
        with self.assertRaisesRegex(ValueError,'Ya existe'):
            self.note(title='Repetido',content='Otro texto')
        second=self.note(**{**first,'content':'Otro texto'})
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(self.rel(second['id']),'Repetido.md')

    # --- Identidad portable de apuntes externos sin glosa_id ---------------- #

    def test_external_raw_rename_and_move_keep_id(self):
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root/'Uno.md').write_text('# Concepto\n\nTexto externo.\n', encoding='utf-8')
        first = self.lib.snapshot()
        adopted = [n for n in first['notes'] if 'Texto externo' in n['content']]
        self.assertEqual(len(adopted), 1)
        note_id = adopted[0]['id']
        # Renombrar y mover a mano, sin abrir ni guardar desde Glosa.
        moved = self.root/'Materia'
        moved.mkdir()
        os.replace(self.root/'Uno.md', moved/'Dos.md')
        second = self.lib.snapshot()
        active = [n for n in second['notes'] if n['id'] == note_id]
        self.assertEqual(len(active), 1)
        self.assertIn('Texto externo', active[0]['content'])
        self.assertEqual([n for n in second['deletedNotes'] if n['id'] == note_id], [])
        self.assertFalse(any('adoptado con ID' in w and 'Dos.md' in w for w in second['noteWarnings']))

    def test_external_raw_edit_then_rename_keeps_id(self):
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root/'Uno.md'
        path.write_text('# Concepto\n\nTexto externo.\n', encoding='utf-8')
        note_id = next(n['id'] for n in self.lib.snapshot()['notes'] if 'Texto externo' in n['content'])
        # Edición externa antes de renombrar: sigue siendo la misma nota.
        path.write_text('# Concepto\n\nTexto editado afuera.\n', encoding='utf-8')
        self.lib.snapshot()
        os.replace(path, self.root/'Dos.md')
        state = self.lib.snapshot()
        active = [n for n in state['notes'] if n['id'] == note_id]
        self.assertEqual(len(active), 1)
        self.assertIn('Texto editado afuera', active[0]['content'])
        self.assertEqual(len([n for n in state['notes'] if 'Texto editado' in n['content']]), 1)

    def test_two_raw_files_with_same_content_do_not_collapse(self):
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root/'A.md').write_text('# X\n\nmismo cuerpo\n', encoding='utf-8')
        (self.root/'B.md').write_text('# X\n\nmismo cuerpo\n', encoding='utf-8')
        state = self.lib.snapshot()
        self.assertEqual(len(state['notes']), 2)
        self.assertEqual(len({n['id'] for n in state['notes']}), 2)

    def test_sidecar_stores_portable_relative_path(self):
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root/'Uno.md').write_text('# Concepto\n\nTexto externo.\n', encoding='utf-8')
        note_id = next(n['id'] for n in self.lib.snapshot()['notes'] if 'Texto externo' in n['content'])
        payload = json.loads((self.root/'.glosa-identidad.json').read_text(encoding='utf-8'))
        # v2 guarda la ruta relativa (portable) además de la clave física local.
        self.assertEqual(payload['version'], 2)
        self.assertEqual(payload['files']['Uno.md']['id'], note_id)
        self.assertIn('key', payload['files']['Uno.md'])

    def test_external_adoption_preserves_body_and_foreign_frontmatter(self):
        self.root.mkdir(parents=True, exist_ok=True)
        text = '---\ncssclass: ajeno\ntags: [uno, dos]\n---\n\n# Título\n\nCuerpo propio que no es de Glosa.\n'
        path = self.root/'Propio.md'
        path.write_text(text, encoding='utf-8')
        self.lib.snapshot()
        # Nunca se reescribe el archivo ajeno al adoptarlo.
        self.assertEqual(path.read_text(encoding='utf-8'), text)

    # --- Rename / move dentro de Glosa ------------------------------------- #

    def test_rename_and_move_keep_id_and_move_file(self):
        note = self.note(title='Viejo', folder='A')
        self.assertTrue((self.root/'A'/'Viejo.md').is_file())
        updated = self.lib.save_note({**note, 'title': 'Nuevo', 'folder': 'B/C'})
        self.assertEqual(updated['id'], note['id'])
        self.assertFalse((self.root/'A'/'Viejo.md').exists())
        self.assertTrue((self.root/'B'/'C'/'Nuevo.md').is_file())
        self.assertEqual(self.rel(updated['id']), 'B/C/Nuevo.md')

    # --- Metadatos auxiliares por archivo ---------------------------------- #

    def test_anchors_and_study_survive_file_roundtrip(self):
        doc = self.add_doc(pages=3)
        anchor = {'id': 'a1', 'scope': 'page', 'documentId': doc['id'], 'sha256': '0'*64,
                  'page': 1, 'quote': 'cita', 'comment': 'nota'}
        study = {'materia': 'Matemática', 'unidad': 'U1', 'parcialDate': None,
                 'needsPractice': True, 'errors': []}
        note = self.lib.save_note(dict(title='Con estudio', folder='', content='x', shared=True,
                                       documentId=doc['id'], page=1, writingScope='page',
                                       pageNotes={doc['id']: {'1': 'p1'}}, anchors=[anchor], study=study))
        info = note_files.read_note_file(self.lib.note_file(note['id']))
        self.assertEqual(info['extras']['anchors'], [anchor])
        self.assertEqual(info['extras']['study'], study)
        self.assertEqual(info['pageNotes'][doc['id']], {'1': 'p1'})

    # --- Seguridad de rutas ------------------------------------------------ #

    def test_traversal_title_cannot_escape_the_notes_root(self):
        note = self.note(title='../../evil')
        target = self.lib.note_file(note['id'])
        self.assertNotIn('..', target.relative_to(self.root).as_posix().split('/'))
        self.assertTrue(target.is_file())
        self.assertFalse((self.data/'evil.md').exists())

    def test_symlink_inside_tree_is_ignored(self):
        self.root.mkdir(parents=True, exist_ok=True)
        outside = self.data/'afuera.md'
        outside.write_text('# Ajeno\n', encoding='utf-8')
        (self.root/'Enlace.md').symlink_to(outside)
        state = self.lib.snapshot()
        self.assertEqual(state['notes'], [])
        self.assertEqual(outside.read_text(encoding='utf-8'), '# Ajeno\n')

    # --- Avisos visibles en el snapshot ------------------------------------ #

    def test_snapshot_reports_invalid_file_warning(self):
        note = self.note()
        self.lib.note_file(note['id']).write_text('---\nsin cierre\n', encoding='utf-8')
        state = self.lib.snapshot()
        self.assertTrue(any('Apunte.md' in warning for warning in state['noteWarnings']))

    # --- Aislamiento: nunca se escribe en la Margen real ------------------- #

    def test_notes_root_stays_inside_the_temporary_data(self):
        self.assertTrue(str(self.root).startswith(self.tmp.name), self.root)
        self.assertEqual(self.root, self.data/'Apuntes')
        self.assertNotEqual(self.root, Path.home()/'Margen'/'Apuntes')


if __name__ == '__main__':
    unittest.main()
