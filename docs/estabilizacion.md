# Estabilización de Glosa · próximos días

La prioridad es proteger los apuntes y el historial antes de sumar capacidades.
Cada unidad termina con un caso de regresión que usa una base temporal y con una
revisión manual del efecto visible para quien estudia.

## Día 1 · integridad de apuntes

- [x] Reanudar un enlace a una lección cuando el intento anterior ya guardó la
  nota con su ID determinista y el mismo título y contenido. El reintento no crea
  una segunda versión ni modifica un apunte de otra solicitud.
- [x] Cubrir el reintento y comprobar que el enlace aparece una sola vez.
- [x] Rechazar cambios de contenido bajo el mismo ID de solicitud y conservar
  una edición posterior de la nota ante un reintento viejo.
- [ ] Agregar fallos inducidos en cada límite entre archivo Markdown, SQLite,
  historial y enlace; documentar qué puede reanudarse y qué requiere resolver un
  conflicto de revisión.
- [ ] Comprobar altas concurrentes con títulos equivalentes en NFC, espacios y
  mayúsculas, conservando los dos borradores ante colisión.
- [ ] Cubrir dos requests simultáneos con el mismo `requestId` y permitir un
  reintento seguro cuando otra instancia aún está guardando la nota.

## Día 2 · sincronización y recuperación

- [ ] Probar cambios externos simultáneos al guardado, renombres, borrados y
  archivos inválidos. Confirmar que Glosa conserva el original o produce un
  conflicto recuperable sin resucitar una nota eliminada.
- [ ] Revisar restauración de respaldos de notas, versiones, enlaces y notas
  eliminadas con una carpeta temporal; comprobar que repetir la restauración no
  duplica historial ni archivos.
- [ ] Definir señales visibles para conflictos recuperables y probarlas en
  navegador con borrador local preservado.

## Día 3 · módulos y límites

- [ ] Trazar responsabilidades de `server.py`, `library.py` y los módulos de
  notas con CodeGraph; extraer solo límites con una interfaz estable y pruebas
  que demuestren menos acoplamiento.
- [ ] Separar las transacciones de curso, biblioteca y archivos en una tabla de
  escenarios de fallo; elegir la unidad de recuperación antes de mover código.
- [ ] Revisar las APIs de títulos, enlaces e historial para eliminar reglas
  duplicadas entre navegador y servidor.

## Día 4 · pruebas de uso y operación

- [ ] Ejecutar flujos de navegador para crear, editar, renombrar, enlazar,
  desenlazar, borrar y recuperar apuntes; verificar teclado, lector de pantalla y
  conservación de la posición de lectura.
- [ ] Revisar la matriz de pruebas rápidas y completas para que cada módulo nuevo
  indique cómo se comprueba sin tocar la base real del estudiante.
- [ ] Cerrar con auditoría de respaldo y de acceso privado por loopback/Tailscale;
  no habilitar Funnel.

## Primera unidad entregada

`POST /api/study-note` permite reanudar una creación cuyo guardado de nota terminó
pero cuyo enlace aún no se confirmó. Solo acepta la reanudación si coincide el ID
derivado del mismo `requestId` y el contenido sigue igual; las notas existentes
siguen exigiendo ID y revisión explícitos. La prueba usa la base temporal de
`tests/test_learning.py` y verifica enlace único e historial sin duplicados.

## Evidencia, revisiones y reversión

- Comando ejecutado: `PYTHONWARNINGS=ignore::ResourceWarning python -m unittest
  tests.test_learning tests.test_note_titles tests.test_notes_storage
  tests.test_release_package -q` · 107 pruebas pasaron. También pasó
  `git diff --check` sobre `server.py`, `tests/test_learning.py`, este documento
  y `release-files.json`.
- Revisaron el guard y sus pruebas `opencode/glm-5.3-flash-free` y
  `gemini-3.8-flash-low` mediante Antigravity. OpenCode confirmó el caso de
  reintento bloqueado y sugirió cubrir IDs simultáneos. Gemini señaló una posible
  carrera de edición; el guard se apoya además en la revisión optimista de
  `save_note`, que rechaza una escritura basada en una revisión vencida. La
  concurrencia del mismo ID queda pendiente de una prueba dedicada.
- Reversión de esta unidad: retirar el guard de reanudación y sus dos regresiones,
  junto con el registro de esta unidad en este plan y el allowlist de release.
  No requiere migración ni modifica datos persistentes; las pruebas usan el
  workspace temporal de `tests/test_learning.py`.
