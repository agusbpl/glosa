"""Run the official OpenCode CLI in a disposable session, with no auto-approval."""
from concurrent.futures import ThreadPoolExecutor, wait
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import quote


_service_start_lock = threading.Lock()


def executable_path():
    executable = os.environ.get('OPENCODE_BIN') or shutil.which('opencode')
    if not executable:
        candidate = Path.home() / '.opencode/bin/opencode'
        executable = str(candidate) if candidate.is_file() else None
    if not executable:
        raise ValueError('No se encontró la CLI de OpenCode. Instalá OpenCode o configurá OPENCODE_BIN.')
    return executable


def start_service():
    with _service_start_lock:
        try:
            result = subprocess.run([executable_path(), 'service', 'start'], capture_output=True,
                                    text=True, timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            raise ValueError('OpenCode está detenido y no pudo iniciarse. Ejecutá opencode service start.') from None
        if result.returncode:
            raise ValueError('OpenCode está detenido y no pudo iniciarse. Ejecutá opencode service start.')


def complete(prompt, model, base, call, password='', on_text=None):
    executable = executable_path()
    session_id = None
    with tempfile.TemporaryDirectory(prefix='glosa-opencode-') as directory:
        prompt_file = Path(directory) / 'consulta.txt'
        prompt_file.write_text(prompt, encoding='utf-8')
        os.chmod(prompt_file, 0o600)
        body = {'title': 'Glosa · consulta temporal', 'location': {'directory': directory},
                'permissions': [{'action': '*', 'resource': '*', 'effect': 'ask'}]}
        if model != 'auto':
            provider, model_id = model.split('/', 1)
            body['model'] = {'providerID': provider, 'id': model_id}
        created = call('api/session', body)
        data = created.get('data') if isinstance(created, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get('id'), str) or not data['id']:
            raise ValueError('OpenCode no pudo crear la sesión temporal. Tu trabajo sigue guardado.')
        session_id = quote(data['id'], safe='')
        try:
            args = [executable, 'run', '--server', base, '-s', data['id'], '--format', 'json',
                    '--file', str(prompt_file)]
            if model != 'auto':
                args += ['--model', model]
            args += ['Respondé a la consulta del archivo adjunto respetando su política. '
                     'No uses herramientas, archivos adicionales ni comandos. Devolvé sólo la respuesta final.']
            env = os.environ.copy()
            env['OPENCODE_SERVER_PASSWORD'] = password() if callable(password) else password
            def run_cli():
                return subprocess.run(args, cwd=directory, env=env, capture_output=True,
                                      text=True, encoding='utf-8', timeout=70)
            if on_text:
                # CLI text events arrive at part completion. Read the session's
                # live text while the official CLI drives generation.
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(run_cli)
                    previous = ''
                    while not wait([future], timeout=0.15).done:
                        try:
                            messages = call('api/session/' + session_id + '/message?type=assistant&order=asc')
                        except ValueError:
                            continue  # The final CLI result remains authoritative.
                        items = messages.get('data', []) if isinstance(messages, dict) else []
                        text = '\n'.join(part['text'] for message in items
                                         if isinstance(message, dict) and message.get('type') == 'assistant'
                                         for part in message.get('content', []) if isinstance(part, dict)
                                         and part.get('type') == 'text' and isinstance(part.get('text'), str))
                        if text and text != previous:
                            previous = text
                            on_text(text)
                    result = future.result()
            else:
                result = run_cli()
            texts, model_used = [], model
            failed = False
            for line in result.stdout.splitlines():
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(event, dict):
                    continue
                if event.get('type') == 'error':
                    failed = True
                if event.get('type') == 'text':
                    part = event.get('part', {})
                    if isinstance(part, dict) and isinstance(part.get('text'), str):
                        texts.append(part['text'])
            if failed or result.returncode:
                raise ValueError('OpenCode no completó la consulta. Revisá el acceso del modelo en OpenCode. '
                                 'Tu trabajo sigue guardado.')
            text = '\n'.join(texts).strip()
            if not text:
                raise ValueError('OpenCode no devolvió una respuesta final. Tu trabajo sigue guardado.')
            if on_text:
                on_text(text)
            # The resolved model is part of the session, including when auto was selected.
            info = call('api/session/' + session_id)
            resolved = info.get('data', {}).get('model') if isinstance(info, dict) else None
            if isinstance(resolved, dict) and isinstance(resolved.get('providerID'), str) and isinstance(resolved.get('id'), str):
                model_used = resolved['providerID'] + '/' + resolved['id']
            return {'model': model_used, 'choices': [{'message': {'role': 'assistant', 'content': text}}]}
        except subprocess.TimeoutExpired:
            raise ValueError('OpenCode no terminó en 70 segundos; puede estar esperando permiso para una herramienta. '
                             'Glosa no aprueba herramientas automáticamente. Tu trabajo sigue guardado.') from None
        except OSError:
            raise ValueError('No se pudo ejecutar la CLI de OpenCode. Revisá su instalación.') from None
        finally:
            # Only this request's session is touched. Never continue the user's last session.
            try:
                call('api/session/' + session_id + '/interrupt', {})
            except ValueError:
                pass  # An already finished session may reject interruption.
            call('api/session/' + session_id, method='DELETE')
