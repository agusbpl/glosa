# Herramientas de estudio

Inspiradas en Obsidian, integradas con los apuntes reales de Glosa sin un
segundo almacén desconectado. Todo lo que registres son **tus datos de estudio**:
se guardan dentro de la nota y **no acreditan dominio**.

El módulo vive en `web/study-tools.js` (y su hoja `web/study-tools.css`), se
auto-inicia al cargar la página y se engancha al render de apuntes
(`ClassNotes.render`). Aparece como un panel plegable titulado
«Herramientas de estudio» dentro de la vista de notas, con cinco pestañas:
Referencias, Propiedades, Ficha, Errores y Filtros.

## Características

### 1. Wikilinks y referencias inversas

Enlazá conceptos entre notas con la sintaxis `[[Título de nota]]` dentro del
texto de cualquier apunte. El panel resume esos vínculos; **no** reemplaza ni
reescribe el editor en vivo.

En la pestaña **Referencias**:

- **Notas que enlazan a esta** (referencias inversas): las notas cuyo texto
  contiene `[[Título]]` apuntando al apunte abierto. Un clic navega a la nota.
- **Enlaces en esta nota**: los `[[wikilinks]]` del apunte abierto. Si el
  destino existe, el botón navega; si no, avisa que la nota todavía no existe y
  se muestra con estilo punteado.
- **Menciones en tu material**: apariciones del título (sin necesidad de
  corchetes) en otros apuntes, en el texto de **clases** o en la consigna y
  rúbrica de **ejercicios**. Cada mención lleva etiqueta `apunte` / `clase` /
  `ejercicio` y un fragmento de contexto; al hacer clic se abre la nota o la
  clase correspondiente.

La coincidencia de títulos es exacta, insensible a mayúsculas y espacios
repetidos (se normaliza, sin búsqueda difusa).

### 2. Ficha de concepto

Plantilla estructurada para estudiar un concepto. En la pestaña **Ficha**,
escribí el nombre del concepto y presioná «Insertar ficha». La plantilla se
agrega **al final del apunte abierto** sin borrar tu borrador:

```markdown
## Ficha: [Nombre del concepto]

### Definición propia
[Explicá el concepto con tus palabras, como si se lo contaras a un compañero]

### Ejemplo
[Un caso concreto que ilustre el concepto]

### Contraejemplo
[Un caso que se parezca pero no cumpla la condición; explicá por qué]

### Fuente
[Clase, página del PDF o referencia bibliográfica]

### Pregunta de comprensión
[Una pregunta que te obligue a pensar el concepto, no solo repetirlo]
```

La inserción dispara el guardado real del apunte (`ClassNotes.flush`), así que
el cambio queda persistido.

### 3. Registro de errores de parcial

En la pestaña **Errores** podés registrar los errores que cometiste en
ejercicios o parciales del apunte abierto:

- **Concepto**: qué tema o ejercicio (se precarga con el título del apunte).
- **Tipo**: concepto, procedimiento, cálculo, interpretación, aplicación, otro.
- **Qué pasó**: descripción del error.
- **Corrección**: la forma correcta.

Cada registro se guarda con fecha y se lista debajo, con su tipo y corrección.
El registro es material de repaso personal, no una nota ni evidencia de dominio.

### 4. Propiedades de estudio y filtros

Las propiedades son **metadata propia de cada apunte** (no de la carpeta, no de
un curso), y por eso funcionan incluso sin curso activo:

| Propiedad | Dónde vive | Uso |
|-----------|------------|-----|
| **Materia** | campo `study.materia` de la nota | Agrupar apuntes por materia |
| **Unidad** | campo `study.unidad` de la nota | Agrupar por unidad o tema |
| **Fecha parcial** | campo `study.parcialDate` de la nota | Fecha del parcial que incluye el tema |
| **Necesito practicar** | campo `study.needsPractice` de la nota | Recordatorio de repaso |
| **Errores** | campo `study.errors` de la nota | Registro de errores de parcial |

En la pestaña **Propiedades** editás materia, unidad, fecha de parcial y el
check «Necesito practicar» del apunte abierto. Los indicadores
`Practicar` / `Parcial` también se muestran en la lista lateral de apuntes.

En la pestaña **Filtros** combinás materia, unidad, fecha de parcial y «solo
necesito practicar». **Los filtros vacíos incluyen las notas sin propiedades**:
si no elegís nada, ves todas.

La metadata se guarda dentro de la nota y la valida `library.py`
(`validate_study`): se conserva en revisiones, respaldos y restauraciones, y
sobrevive a la recarga. Se guarda sin crear ningún curso, lección ni evento de
feedback.

## Autoevaluación vs evidencia de dominio

- **Autoevaluación** (este módulo): propiedades, wikilinks, fichas y errores
  son tu guía de estudio personal. No acreditan comprensión independiente.
- **Evidencia de dominio** (sistema de evaluación): solo los ejercicios
  evaluados por el tutor con respuestas independientes pueden acreditar
  dominio, y se registran como eventos `assessment`, nunca como `feedback`.

> Marcar «necesito practicar» o completar una ficha **no** demuestra dominio.
> El registro de parciales es tu propio material de repaso.

## Integración técnica

### Cómo guarda

| Dato | Almacenamiento |
|------|----------------|
| Propiedades (materia, unidad, parcial, practicar) y errores | campo `study` de la nota, vía `POST /api/notes` |
| Wikilinks | texto de la nota (`[[Título]]`) |
| Fichas | texto de la nota (plantilla insertada al final) |

No usa el estado global `window.state`: lee el `state` léxico de `app.js`
(accede a `state.library.notes` y `state.courses`) y usa la función `api`
existente. Para no perder cambios recién hechos, el módulo copia transitoriamente
la metadata dentro del cuerpo real de `/api/notes` justo antes de la petición y
la quita enseguida, de modo que `notes.js` adopta la revisión guardada sin
re-guardar en bucle. Si en el futuro `notes.js` exporta más API de selección, el
módulo la usa (ver las instrucciones de integración).

### Archivos del módulo

| Archivo | Descripción |
|---------|-------------|
| `web/study-tools.js` | Módulo principal (`window.StudyTools`) |
| `web/study-tools.css` | Estilos del panel y de los indicadores de la lista |
| `tests/test_study_tools.js` | Tests unitarios (Node) |
| `tests/test_note_study_metadata.py` | Tests de la metadata `study` en `library.py` |
| `tests/browser_study_tools.cjs` | Test de navegador real (Playwright) |
| `docs/herramientas-estudio.md` | Esta documentación |

### API pública (`window.StudyTools`)

`init`, `refresh`, `extractWikilinks`, `normalizeTitle`, `findNoteByTitle`,
`getBacklinks`, `outgoingLinks`, `getMentions`, `getActiveNoteId`, `openNote`,
`openLesson`, `createConceptCard`, `insertConceptCard`, `getNoteProperties`,
`setProperty`, `saveStudy`, `logPartialError`, `filterNotes`, `getAllMaterias`,
`getAllUnidades`, `studyByNote`, `CONCEPT_CARD_TEMPLATE`, `ERROR_TYPES`.

## Tests

```bash
node tests/test_study_tools.js
.venv-author/bin/python -m unittest tests.test_note_study_metadata tests.test_note_markdown tests.test_backup_validation
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/thorium-browser/thorium node scripts/test_browser.cjs browser_study_tools.cjs
```

Los tests unitarios verifican: extracción de wikilinks, búsqueda por título,
referencias inversas, menciones, generación de fichas, propiedades y errores
como metadata de la nota, guardado real a través de `/api/notes`, filtros que
incluyen notas sin propiedades y la separación de autoevaluación respecto de la
evidencia de dominio. Los tests de Python validan `study` dentro de
`library.validate_note`. El test de navegador usa el Glosa real (no mocks):
comprueba referencias cruzadas con navegación que conserva el borrador,
inserción de ficha, propiedades booleanas persistentes sin curso, errores como
metadata, filtros y recarga.

## Limitaciones

- La coincidencia de wikilinks es por título exacto (normalizado); no hay
  búsqueda difusa.
- El panel solo aparece en la vista de notas.
- Las propiedades se asocian al apunte, no a conceptos individuales dentro de
  él.
- Las propiedades y errores del apunte activo se guardan en el próximo guardado
  real de la nota; en un apunte nuevo sin cambios todavía, quedan pendientes
  hasta que se guarde.
- La navegación desde el panel usa la lista real de apuntes (o
  `ClassNotes.select` si `notes.js` lo exporta). Mientras `select` no esté
  exportado, se apoya en los enlaces de la lista lateral, que internamente hacen
  flush del borrador.

## Escribir una nota para un término mientras leés

Seleccioná el término en Estudiar y pulsá su resaltado. **Crear nota de concepto**
abre un editor para escribir tu explicación y **Guardar y enlazar** crea la nota
nativa y el enlace en ese lugar de la lección. Funciona sin tutor conectado; la
opción de generar un apunte con el agente sigue disponible como acción separada.
La nota escrita por vos queda privada inicialmente y se puede ampliar desde Notas.
Un comentario sobre el resaltado sigue siendo una anotación diferente de esta nota.

Al alternar entre Estudiar y Notas se recuperan la lección, el apunte activo y la
posición de lectura de cada vista. También se conservan página, zoom y posición del
PDF y el cursor de notas simples. Las posiciones se guardan por pliego y contexto,
sin copiar el contenido del apunte. La navegación a otra lección comienza arriba.

## Notas de concepto y enlaces

La barra del resaltado tiene una sola acción manual de nota, con icono de lápiz. Crea una nota de concepto o permite editar un comentario previo del resaltado. La nota se guarda como un apunte independiente, editable en Notas. Al crearla podés desactivar **Enlazar el término con esta nota**: se guarda el apunte y la lección no cambia.

Al tocar un enlace cuyo apunte ya no existe, elegí **Quitar enlace** para conservar el término como texto. Para una nota existente, la vista previa ofrece **Quitar enlace del texto**. Se conserva la nota, el historial del curso y los resaltados.

## Proveedor del tutor

En Ajustes → Tutor podés elegir **DeepSeek directo**, pegar su clave y usar el catálogo de modelos o escribir un ID. La URL oficial es `https://api.deepseek.com`; se verificó en [su documentación](https://api-docs.deepseek.com/).

**Otra API compatible** permite configurar la URL base, la clave y el ID de modelo de un servicio compatible con Chat Completions (`/chat/completions`). Incluí `/v1` en la base cuando lo requiera el proveedor. El catálogo (`/models`) es opcional: si no está disponible, ingresá el ID manualmente. No implica compatibilidad con protocolos propios de todos los proveedores.

Las claves se guardan fuera de los pliegos y sus exportaciones, separadas por proveedor y URL. El consumo y los costos corresponden a la cuenta del proveedor elegido.

Los títulos de notas son únicos dentro de cada pliego, aunque estén en carpetas distintas. Se ignoran diferencias de mayúsculas y espacios al comparar. Crear una nota de concepto con un título existente carga esa nota para editarla y conserva su ID, su privacidad y su historial. Un cambio simultáneo de la nota bloquea el guardado del borrador anterior. Renombrar una nota con el título de otra se rechaza para no pisar su contenido.

La unificación de duplicadas conserva los contenidos diferentes, los apuntes por página, los resaltados y las versiones originales. Las copias originales quedan archivadas con el ID de la nota de destino; los enlaces de las lecciones se redirigen con una nueva versión del curso. Los registros del tutor y las versiones que citan los IDs originales se conservan.
