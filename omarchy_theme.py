"""Read the host's Omarchy palette without executing theme files."""
import os
from pathlib import Path
import re


def luminance(color):
    channels = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return sum(w * (v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4)
               for w, v in zip((.2126, .7152, .0722), channels))


def contrast(a, b):
    x, y = sorted((luminance(a), luminance(b)))
    return (y + .05) / (x + .05)


def palette(config_home=None, state_home=None):
    config = Path(config_home or os.environ.get('XDG_CONFIG_HOME') or Path.home() / '.config')
    state = Path(state_home or os.environ.get('XDG_STATE_HOME') or Path.home() / '.local/state')
    current = state / 'omarchy/current/theme/colors.toml'
    if not current.is_file():
        current = config / 'omarchy/current/theme/colors.toml'
    try:
        text = current.read_text(encoding='utf-8')
        # Legacy location remains supported for older Omarchy installations.
        if len(text) > 65536:
            return {'available': False}
    except (OSError, UnicodeError):
        return {'available': False}
    colors = dict(re.findall(r'^\s*([a-z_]+)\s*=\s*[\"\'](#[0-9a-fA-F]{6})[\"\']\s*(?:#.*)?$', text, re.M))
    if not all(k in colors for k in ('background', 'foreground', 'accent')):
        return {'available': False}
    bg, fg = colors['background'], colors['foreground']
    if contrast(bg, fg) < 4.5:
        return {'available': False}
    paper = colors.get('lighter_background', bg)
    if contrast(paper, fg) < 4.5:
        paper = bg
    accent = colors['accent']
    if min(contrast(accent, bg), contrast(accent, paper)) < 4.5:
        accent = fg
    muted = colors.get('dark_foreground', fg)
    if min(contrast(muted, bg), contrast(muted, paper)) < 4.5:
        muted = fg
    button_ink = max(('#000000', '#ffffff'), key=lambda c: contrast(c, accent))
    return {'available': True, 'mode': 'dark' if luminance(bg) < .179 else 'light',
            'variables': {'--bg': bg, '--paper': paper, '--ink': fg, '--muted': muted,
                          '--green': accent, '--accent-ink': accent, '--accent-solid': accent,
                          '--on-accent': button_ink, '--line': colors.get('muted', fg),
                          '--pale': bg, '--panel': paper}}
