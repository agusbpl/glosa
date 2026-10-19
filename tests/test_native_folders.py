import subprocess
import tempfile
import unittest
from unittest.mock import patch
import native_folders


class NativeFolderTests(unittest.TestCase):
    @patch('native_folders.shutil.which', return_value='/usr/bin/zenity')
    def test_selection_uses_native_directory_mode_and_preserves_spaces(self, _):
        with tempfile.TemporaryDirectory(prefix='carpeta con espacios ') as folder:
            with patch('native_folders.subprocess.run', return_value=subprocess.CompletedProcess([], 0, folder+'\n', '')) as run:
                self.assertEqual(native_folders.choose(folder)['folder'], folder)
                self.assertIn('--directory', run.call_args.args[0])
                self.assertNotIn('shell', run.call_args.kwargs)

    @patch('native_folders.shutil.which', return_value='/usr/bin/zenity')
    def test_cancel_and_timeout_leave_choice_unchanged(self, _):
        with patch('native_folders.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', '')):
            self.assertIsNone(native_folders.choose('/tmp')['folder'])
        with patch('native_folders.subprocess.run', side_effect=subprocess.TimeoutExpired('zenity', 300)):
            self.assertIsNone(native_folders.choose('/tmp')['folder'])

    @patch('native_folders.shutil.which', return_value='/usr/bin/zenity')
    def test_failure_is_not_an_empty_path_selection(self, _):
        with patch('native_folders.subprocess.run', return_value=subprocess.CompletedProcess([], 2, '', 'display unavailable')):
            with self.assertRaises(ValueError): native_folders.choose('/tmp')
