import tempfile
import unittest
from pathlib import Path
import omarchy_theme


class OmarchyThemeTests(unittest.TestCase):
    def test_availability_and_live_palette(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(omarchy_theme.palette(tmp, Path(tmp) / 'state'), {'available': False})
            file = Path(tmp) / 'omarchy/current/theme/colors.toml'
            file.parent.mkdir(parents=True)
            file.write_text('background = "#1a1b26"\nforeground = "#a9b1d6"\naccent = "#7aa2f7"\ndark_foreground = "#565f89"\n')
            result = omarchy_theme.palette(tmp, Path(tmp) / 'state')
            self.assertTrue(result['available'])
            self.assertEqual(result['mode'], 'dark')
            v = result['variables']
            self.assertGreaterEqual(omarchy_theme.contrast(v['--muted'], v['--bg']), 4.5)
            self.assertGreaterEqual(omarchy_theme.contrast(v['--on-accent'], v['--accent-solid']), 4.5)
            file.write_text('background = "#ffffff"\nforeground = "#222222"\naccent = "#eeeeee"\n')
            result = omarchy_theme.palette(tmp, Path(tmp) / 'state')
            self.assertEqual(result['mode'], 'light')
            self.assertEqual(result['variables']['--green'], '#222222')
            file.write_text('background = "#ffffff"\nforeground = "#ffffff"\naccent = "url(evil)"\n')
            self.assertFalse(omarchy_theme.palette(tmp, Path(tmp) / 'state')['available'])

    def test_current_state_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'state/omarchy/current/theme/colors.toml'
            file.parent.mkdir(parents=True)
            file.write_text('background = "#0c0b0c"\nforeground = "#FAFCFB"\naccent = "#b59790"\n')
            self.assertTrue(omarchy_theme.palette(Path(tmp) / 'config', file.parents[3])['available'])
