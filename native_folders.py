"""Desktop directory chooser; cancellation never changes the configured Margen."""
from pathlib import Path
import shutil
import subprocess
import threading

_LOCK = threading.Lock()


def choose(initial):
    executable = shutil.which('zenity')
    if not executable:
        raise ValueError('No está disponible el selector de carpetas del sistema (zenity).')
    if not _LOCK.acquire(blocking=False):
        raise ValueError('Ya hay un selector de carpetas abierto.')
    try:
        result = subprocess.run(
            [executable, '--file-selection', '--directory', '--title=Elegir carpeta del Margen',
             '--filename='+str(Path(initial).expanduser())+'/', '--modal'],
            capture_output=True, text=True, timeout=300)
        if result.returncode == 1:
            return {'folder': None}
        if result.returncode != 0:
            raise ValueError('No se pudo abrir el selector de carpetas del sistema.')
        folder = Path(result.stdout.rstrip('\n')).expanduser()
        if not folder.is_absolute() or not folder.is_dir():
            raise ValueError('Elegí una carpeta existente.')
        return {'folder': str(folder.resolve())}
    except subprocess.TimeoutExpired:
        return {'folder': None}
    finally:
        _LOCK.release()
