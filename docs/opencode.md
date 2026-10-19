# OpenCode como backend del tutor

Glosa puede usar la **CLI oficial de OpenCode v2** además de sus proveedores de
API y del canal MCP externo. Cada consulta de estudio o apuntes ejecuta
`opencode run --server URL -s SESIÓN --format json --file consulta.txt`.
El flujo se comprobó con OpenCode 2.0.32 y
`opencode/deepseek-v4.1-flash-free`, que respondió `OK`.

## Configuración

1. Instalá OpenCode y configurá sus proveedores. La CLI debe estar en el PATH,
   en `~/.opencode/bin/opencode`, o indicada por `OPENCODE_BIN` al iniciar Glosa.
2. Iniciá su servicio con `opencode service start`. No hace falta mantener
   abierta la ventana de OpenCode. Si el servicio local detectado está detenido,
   Glosa intenta iniciarlo automáticamente al buscar modelos o crear una consulta.
3. En Glosa, abrí **Ajustes → Tutor**, elegí **API / OpenCode** y
   **OpenCode local (v2)**. Glosa detecta la URL del servicio al iniciar y su
   contraseña local. Recargá la página después de reiniciar Glosa.
4. Pulsá **Buscar modelos** y elegí el modelo: el listado muestra
   **proveedor · modelo**. La selección inicial propuesta es
   `opencode/deepseek-v4.1-flash-free`. Guardá los ajustes.

Podés usar un servidor explícito iniciado con
`opencode serve --hostname 127.0.0.1 --port 4096`, indicando su URL sin `/v1`
y su contraseña en Ajustes. Una contraseña guardada explícitamente tiene
prioridad sobre la detectada. También se admiten `OPENCODE_SERVER_PASSWORD`
y `OPENCODE_SERVER_USERNAME` en el entorno de Glosa.

La contraseña detectada nunca se envía al navegador ni se incluye en
exportaciones. Glosa sólo admite URLs loopback para OpenCode. El navegador
habla con Glosa, que crea la sesión y ejecuta la CLI contra ese servidor.
No hace falta habilitar CORS ni publicar OpenCode. El acceso remoto a Glosa
mantiene Tailscale Serve privado.

## Consultas y permisos

Glosa crea una sesión nueva en un directorio temporal por consulta, con
permisos en `ask`. Envía la política y el contexto elegido en un archivo
privado y lee los eventos de texto de la CLI. No usa `-c`, no continúa tus
conversaciones personales y no aprueba herramientas automáticamente. El tutor
recibe la instrucción de responder sin herramientas ni comandos. Si pide
permiso y no termina, Glosa cancela al alcanzar el límite de 70 segundos.

Al finalizar, incluso ante un error o demora, Glosa intenta interrumpir y
eliminar únicamente su sesión y elimina el directorio temporal. OpenCode
puede conservar sus propios logs locales. El historial de aprendizaje,
la trazabilidad y la validación de evidencia permanecen en Glosa. Las
credenciales guardadas en Ajustes siguen separadas de bóvedas y respaldos.
El modelo resuelto de la sesión se registra también cuando se selecciona `auto`.

## Disponibilidad

El catálogo muestra modelos habilitados, pero no garantiza que su acceso o
cuota estén vigentes. `auto` usa el predeterminado de OpenCode: si apunta a
FreeLLMAPI, esa instancia debe estar funcionando. Las condiciones y costos
dependen de cada proveedor.

El endpoint experimental de generación sin estado rechazó modelos gratuitos
con `FreeTierError`; se reemplazó por el flujo de sesión y CLI que respondió
correctamente con DeepSeek. Esto no garantiza acceso a todos los modelos.
Si hay un rechazo, Glosa conserva el trabajo del estudiante.

Las pruebas con procesos y transportes simulados verifican el software, no la
calidad pedagógica. Al cambiar de modelo corresponde repetir una muestra de
la [evaluación rigurosa](evaluacion-rigurosa.md).
