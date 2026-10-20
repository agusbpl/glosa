"""Tutor providers; local credentials stay separate from settings and exports."""
import json
import os
from pathlib import Path
import tempfile
from urllib.parse import urlsplit

def opencode_service():
    """Read local service discovery only; never export its password."""
    state = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state')))
    try:
        data = json.loads((state / 'opencode/service.json').read_text(encoding='utf-8'))
        url = data['url'].rstrip('/')
        parts = urlsplit(url)
        if (parts.scheme != 'http' or parts.hostname not in ('127.0.0.1', 'localhost', '::1')
                or not parts.port or parts.username or parts.password or parts.query or parts.fragment
                or parts.path or any(ch.isspace() for ch in url)):
            return None
        if not isinstance(data.get('password'), str):
            return None
        return {'url': url, 'password': data['password']}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


PROVIDERS = {
    'openrouter': {'name': 'OpenRouter', 'baseUrl': 'https://openrouter.ai/api/v1',
                   'defaultModel': 'openrouter/free', 'url': 'https://openrouter.ai/settings/keys'},
    'freellmapi': {'name': 'FreeLLMAPI', 'baseUrl': os.environ.get('FREELLMAPI_BASE_URL', 'http://localhost:3001/v1').rstrip('/'),
                   'defaultModel': 'auto', 'url': 'https://freellmapi.co/'},
    'opencode': {'name': 'OpenCode', 'baseUrl': (opencode_service() or {}).get('url', 'http://127.0.0.1:4096'),
                 'defaultModel': 'opencode/deepseek-v4.1-flash-free', 'url': 'https://opencode.ai/v2/docs/'},
    'deepseek': {'name':'DeepSeek', 'baseUrl':'https://api.deepseek.com', 'defaultModel':'deepseek-flash', 'url':'https://platform.deepseek.com'},
    'compatible': {'name':'API compatible', 'baseUrl':'', 'defaultModel':'', 'url':''},
    'intern': {'name': 'Intern Discovery', 'baseUrl': 'https://discovery-api.intern-ai.org.cn/v1',
               'defaultModel': '', 'url': 'https://discovery.intern-ai.org.cn/token-plan/home'},
}


def configuration(settings):
    provider = settings.get('provider', 'openrouter')
    if not isinstance(provider, str) or provider not in PROVIDERS:
        raise ValueError('Proveedor de tutor inválido.')
    base = settings.get('providerBaseUrl') or PROVIDERS[provider]['baseUrl']
    if not isinstance(base, str):
        raise ValueError('URL de API inválida.')
    base = base.strip().rstrip('/')
    try:
        parts = urlsplit(base)
        parts.port
    except ValueError:
        raise ValueError('URL de API inválida.') from None
    if (parts.scheme not in ('http', 'https') or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment
            or any(ch.isspace() or ord(ch) < 32 for ch in base)):
        raise ValueError('Usá una URL HTTP(S) sin credenciales, parámetros ni fragmentos.')
    if provider not in ('freellmapi', 'opencode', 'compatible') and base != PROVIDERS[provider]['baseUrl']:
        raise ValueError('La URL de este proveedor es fija.')
    if provider == 'opencode' and parts.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise ValueError('OpenCode debe servirse desde loopback (localhost, 127.0.0.1 o ::1).')
    return provider, base


def validate_settings(settings):
    provider, base = configuration(settings)
    model = settings.get('model', PROVIDERS[provider]['defaultModel'])
    if not isinstance(model, str) or len(model) > 200 or any(ord(ch) < 32 for ch in model):
        raise ValueError('Modelo inválido.')
    model = model.strip()
    if provider == 'openrouter' and not (model == 'openrouter/free' or model.endswith(':free')):
        raise ValueError('Seleccioná un modelo gratuito de OpenRouter.')
    if provider in ('deepseek','compatible') and not model:
        raise ValueError('Seleccioná o ingresá el ID del modelo.')
    if provider == 'freellmapi' and not model:
        raise ValueError('Seleccioná un modelo o usá auto en FreeLLMAPI.')
    if provider == 'opencode' and (not model or (model != 'auto' and ('/' not in model or not all(model.split('/', 1))))):
        raise ValueError('Usá auto o un modelo proveedor/modelo de OpenCode.')
    return {'provider': provider, 'providerBaseUrl': base, 'model': model}


def load_credentials(path):
    """Only explicitly saved keys override environment defaults, including disconnects."""
    path = Path(path)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if data['schemaVersion'] != 1 or not isinstance(data['credentials'], list):
            raise ValueError
        credentials = {}
        for entry in data['credentials']:
            provider, base = configuration({'provider': entry['provider'], 'providerBaseUrl': entry['baseUrl']})
            key = entry['key']
            if not isinstance(key, str) or len(key) > 1000 or any(ord(ch) < 32 or ord(ch) > 126 for ch in key):
                raise ValueError
            credentials[(provider, base)] = key
        return credentials
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError('No se pudieron leer las claves locales del tutor.') from None


def save_credential(path, provider, base, key):
    """Caller serializes updates; replace atomically with owner-only permissions."""
    path = Path(path)
    credentials = load_credentials(path)
    credentials[(provider, base)] = key
    data = {'schemaVersion': 1, 'credentials': [
        {'provider': p, 'baseUrl': url, 'key': value}
        for (p, url), value in sorted(credentials.items())
    ]}
    temporary = None
    try:
        fd, temporary = tempfile.mkstemp(prefix='.tutor-credentials-', suffix='.json', dir=path.parent)
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            json.dump(data, output, ensure_ascii=False)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except OSError:
        raise ValueError('No se pudo guardar la clave del tutor en esta instalación.') from None
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
