"""Build an offline lesson document from an explicit public projection."""
import html
import json
from pathlib import Path

import lesson_export

ROOT = Path(__file__).resolve().parent


def render(ctx, body):
    payload = lesson_export.build_payload(ctx, body)
    data = json.dumps(payload, ensure_ascii=False).replace('&', '\\u0026').replace('<', '\\u003c').replace('>', '\\u003e').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    css = '\n'.join((ROOT / name).read_text() for name in ('web/style.css', 'web/silent.css', 'web/ui.css', 'web/lesson-export-document.css'))
    scripts = '\n'.join((ROOT / name).read_text() for name in ('web/learning-visuals.js', 'web/lesson-export-document.js')).replace('</script', '<\\/script')
    policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
    return (f'<!doctype html><html lang="es"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<meta http-equiv="Content-Security-Policy" content="{html.escape(policy, quote=True)}">'
            f'<title>{html.escape(payload["title"])}</title><style>{css}</style></head>'
            f'<body class="silent-ui"><main id="lesson-export-root"></main><noscript>Activá JavaScript para leer este documento.</noscript>'
            f'<script id="lesson-export-data" type="application/json">{data}</script>'
            f'<script>{scripts}</script></body></html>').encode('utf-8')
