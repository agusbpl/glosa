# Glosa

Glosa es una aplicación personal de estudio con cursos referenciados, apuntes junto a PDFs, actividades, historial y un tutor opcional conectado a un proveedor de modelos. Guarda los datos de estudio localmente y se sirve en loopback para una persona.

## Empezar

```bash
git clone https://github.com/agusbpl/glosa.git
cd glosa
./start.sh
```

Abrí <http://127.0.0.1:8765>. Necesitás Python 3.11 o posterior. La distribución pública se prepara sin claves, respuestas, apuntes ni PDFs personales mediante la [lista de release](docs/release.md). Podés crear una bóveda vacía, importar un curso propio o usar Primer trazo para conocer la interfaz.

El arranque y las pruebas se verificaron en Linux con Bash y Chromium. Otros sistemas y navegadores todavía requieren verificación.

La extracción de PDFs y la autoría MCP requieren dependencias adicionales:

```bash
python3 -m venv .venv-author
.venv-author/bin/python -m pip install -r requirements-author.txt
```

Para pruebas y estructura del proyecto, consultá [desarrollo](docs/desarrollo.md). El [acceso remoto](docs/acceso-remoto.md) usa Tailscale Serve privado. Glosa no está diseñada como servicio público multiusuario: no expongas el servidor directamente a Internet ni habilites Tailscale Funnel.

## Uso y datos

En **Margen** vivís tu bóveda global: una carpeta visible de esta computadora que reúne **pliegos** (subcarpetas por materia) con cursos, lectura, notas, PDFs y conversación, sin mezclarse entre sí. Los **apuntes** son archivos Markdown originales editables con cualquier editor; Glosa conserva en SQLite el historial, las revisiones y los conflictos de una edición externa. Cada pliego puede exportarse como ZIP con sus PDFs e historial. Revisá el contenido antes de compartir un respaldo; los borradores aún presentes solo en el navegador pueden quedar fuera de la exportación. Detalles en [bóvedas](docs/bovedas.md) y [almacenamiento](docs/almacenamiento.md).

En **Notas**, las [herramientas de estudio](docs/herramientas-estudio.md) agregan referencias entre apuntes, fichas de concepto, propiedades de materia, unidad, fecha de parcial y repaso, y un registro de errores. Esa metadata se guarda dentro del apunte y no crea cursos ni evaluaciones. Los resaltados de PDF se guardan con su color y pueden quitarse del resaltado sin perder el historial.

La apariencia se elige en Ajustes: tema claro, oscuro o automático, y un color de acento. En el lector, los resaltados usan cuatro colores fijos (amarillo, verde, azul y rosa) y siguen legibles en tema oscuro y en pantallas pequeñas.

El tutor es opcional. Al usarlo, el contexto elegido se envía al proveedor configurado. Las credenciales permanecen en la instalación local de la PC, fuera de los respaldos de bóvedas. Las condiciones y costos dependen del proveedor. El tutor trabaja con modos **Flexible**, **Estricto** y **Extremo**: en automático la política local decide con fechas y evidencia reales y nunca debilita la puerta de evidencia ni declara dominio con una ayuda propia. En Plan, la pestaña **Parciales** muestra el plan global de todas las materias del Margen con prioridad explicada. Leé [privacidad](docs/privacidad.md) y [modos del tutor](docs/modos-tutor.md).

También podés usar [OpenCode v2 como backend local del tutor](docs/opencode.md), con sus modelos y credenciales configurados, desde Ajustes.

Hay dos integraciones MCP separadas y opcionales: el [tutor de apuntes](docs/mcp-tutor.md), que responde preguntas sobre notas compartidas, y la [autoría de cursos y lecciones](docs/mcp-autor.md), que ayuda a preparar materiales. Ninguna acredita dominio por sí sola ni reemplaza la revisión humana.

Para preparar una materia, decile a tu agente: **«Usá el MCP de autoría para crear
un pliego con /ruta/a/mis/materiales»**. El agente redacta la teoría, la ruta y las
actividades y crea un directorio completo en tu Margen configurado (`~/Margen`
por defecto). Abrilo desde **GLOSA → Margen**: ya tiene el curso incorporado.
No necesitás ZIP ni importar cursos desde Notas.

Si preferís no escribir el encargo, abrí **GLOSA → Preparar una materia con mi
agente**. Elegí la carpeta; podés dejar que el agente proponga la ruta o agregar
los datos del examen, el temario y tu disponibilidad. Revisá el texto y pulsá
**Copiar** para pegarlo en tu agente. Este formulario no lee los materiales,
no inicia programas y no crea pliegos por sí mismo.

Los cursos y las evaluaciones requieren revisión humana de fuentes y rúbricas. La [regla de evaluación rigurosa](docs/evaluacion-rigurosa.md) describe los criterios del proyecto; las comprobaciones automáticas no acreditan calidad pedagógica por sí solas.

## Participar

El código de Glosa se distribuye bajo [Apache License 2.0](LICENSE). Las contribuciones se reciben bajo la misma licencia; consultá [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) y [SUPPORT.md](SUPPORT.md). Las bibliotecas vendorizadas conservan sus licencias, indicadas en [NOTICE](NOTICE). La distribución usa un árbol y una historia filtrados según la [revisión de release](docs/release.md); los materiales de terceros necesitan permisos independientes.

En **Tu entorno → Apariencia → Tema**, la opción **Omarchy** aparece cuando la instalación que sirve Glosa tiene una paleta válida en `$XDG_STATE_HOME/omarchy/current/theme/colors.toml` (por defecto `~/.local/state`); también se admite la ubicación anterior en `~/.config/omarchy/current/theme/colors.toml`. Sigue sus cambios cada 15 segundos y al volver a la ventana; el acento también lo define esa paleta. La elección se guarda por navegador. Si la paleta deja de estar disponible, se usa temporalmente el tema del sistema. En acceso remoto se toman los colores del equipo que sirve Glosa.
