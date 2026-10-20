# Contrato de importación · versión 1

Entregá un único JSON, UTF-8, hasta 8 MB. El botón Importar acepta un curso o el respaldo generado por la aplicación. No usar HTML, scripts ni componentes ejecutables dentro del curso. La teoría se representa como texto plano, con párrafos separados por `\n\n`.

## Curso

| Campo | Requisito |
|---|---|
| schemaVersion | Número `1` |
| id | Texto estable y único de la materia |
| version | Texto; cambiar cuando se modifica contenido |
| title | Nombre visible |
| description | Descripción corta opcional |
| sources | Lista de fuentes |
| lessons | Entre 1 y 200 lecciones |

Fuente: `{ "id": "fuente-1", "title": "Título del documento", "url": "https://..." }`. El ID admite letras, números, guion, punto y guion bajo; máximo 100 caracteres. Para PDFs locales copiá el archivo a `sources/` y usá `/sources/nombre.pdf`, o usá `/documents/ID` para un PDF registrado en Notas; `list_documents` entrega la URL correcta. Las referencias usan páginas del PDF contando desde 1, que pueden diferir de las páginas impresas. El respaldo JSON no incluye los PDFs.

## Lección

| Campo | Requisito |
|---|---|
| id, title | ID único dentro del curso y título |
| unit | Agrupación visible en el menú |
| intro | Objetivo expresado para el estudiante |
| minutes | Estimación mayor que 0 y hasta 240 |
| priority | `1` fundamental, `2` importante, `3` profundización |
| prerequisites | IDs de lecciones previas; sin ciclos |
| blocks | Lista no vacía de bloques |
| exercises | Lista no vacía de actividades |
| warning | Aviso opcional sobre fuentes o alcance |
| simulation | Opcional: `integration` o `dashboard` |
| resources | Videos opcionales |

Bloque: `{ "id": "b1", "title": "Una idea", "text": "Explicación...", "references": [{ "sourceId": "fuente-1", "page": 3 }] }`. IDs únicos dentro de la lección. El servidor comprueba que la fuente exista en el inventario; el autor debe comprobar que realmente respalde el texto. Una fuente HTTPS se abre por enlace; no se descarga ni se añade automáticamente al contexto del tutor. Para fuentes locales con cache por página se incorporan los extractos pertinentes.

Actividad: `{ "id": "e1", "type": "explain", "question": "Explicalo con tus palabras...", "rubric": ["Criterio observable"] }`. Tipos: `open` (argumentación), `explain` (explicación propia), `choice` (opción múltiple). `choice` requiere además `options` (al menos dos textos), `correctIndex` (índice desde cero) y `explanation` (por qué corresponde). Todas requieren rúbrica no vacía.

### Simulacros

Usá `mode: "exam"` en la lección para mostrar todas las preguntas en una vista de resolución con progreso y entrega conjunta. `mode: "study"` conserva la lectura habitual. Por compatibilidad, los títulos que contienen «simulacro» también activan la vista de examen cuando no se especifica `mode`.

En un simulacro, `examTopics` es un texto opcional con materia/temas (por ejemplo «Teoría · Unidades 1–3»); `title` debe ser breve y neutral. Si falta `examTopics`, se usa `unit`, salvo agrupaciones por día de calendario: en ese caso se muestra el nombre del curso sin inventar temas. La interfaz presenta instrucciones mínimas y aviso no oficial; no muestra `intro`, bloques, recursos ni simulaciones durante la resolución. Conservá las consignas completas en `question`, incluidos datos necesarios de cualquier caso. Los bloques permanecen disponibles para el contexto interno del tutor. Las fuentes se consultan desde un desplegable secundario.

Guardá rúbricas en `rubric` y estrategias del tutor en campos pedagógicos adicionales, nunca en los textos estudiantiles. No uses títulos que revelen la respuesta ni referencias circunstanciales al calendario personal. No inventes duración: `minutes` sigue siendo una estimación de planificación y no inicia un reloj.

La entrega admite preguntas pendientes con confirmación. Los borradores se guardan en este navegador; al entregar se registran respuestas por separado y una consulta conjunta. La corrección depende del canal real: API conectada, MCP pendiente o tutor sin conexión. Entregar no acredita comprensión. No se muestran soluciones automáticas de opciones antes de recibir la devolución del tutor.

### Secuencia de lectura y conversación

Sin `sequence`, se muestran los bloques de teoría, los recursos y luego las actividades. Las actividades consecutivas comparten un único **Consultar al tutor** al final del grupo: conserva cada respuesta por separado y envía el conjunto en una sola consulta.

Una lección puede alternar teoría y actividades con `sequence`: `[{"type":"block","id":"b1"},{"type":"exercise","id":"e1"},{"type":"exercise","id":"e2"},{"type":"block","id":"b2"},{"type":"exercise","id":"e3"}]`. Debe mencionar todos los bloques y actividades exactamente una vez. El ejemplo produce dos conversaciones: una tras e1/e2 y otra tras e3. Simulaciones y videos se muestran al final cuando se usa `sequence`. La secuencia conserva los IDs de `blocks` y `exercises`; no duplicar contenido dentro de ella.

Video: `{ "kind": "youtube", "videoId": "cfYl7Xhymx0", "title": "Título", "startSeconds": 0, "task": "Qué observar y explicar" }`. `resources` debe ser una lista; cada video requiere `kind: "youtube"`, un `videoId` de 11 caracteres ASCII (letras, números, guion o guion bajo), título y consigna no vacíos. `startSeconds` es opcional y, si se incluye, debe ser un entero no negativo; su valor predeterminado es 0. La plataforma valida estos requisitos y construye el reproductor; el agente entrega datos JSON, sin HTML ni configuración del navegador.

El autor debe comprobar el contenido, su relación con el objetivo de la lección, la disponibilidad y el permiso de incrustación. Elegir el inicio relevante y explicar en `task` qué observar y qué relación debe elaborar el estudiante. Incorporar al texto de la lección el contexto necesario para que el tutor pueda trabajar con el recurso; no se obtiene una transcripción automáticamente. Si no se pudo consultar el contenido o comprobar la incrustación, declarar esa limitación en la lección y en la justificación del borrador. La validación estructural no comprueba esas propiedades externas.

Para videos locales ya instalados, se admite `{ "kind": "video", "src": "/media/glosa-demo.mp4", "title": "Título", "task": "Qué observar" }`. `src` debe señalar un MP4 o WebM servido por Glosa; no inventar rutas ni suponer que una URL importa el archivo. La plataforma controla reproducción, carga y presentación.

Las dos simulaciones iniciales son modelos conceptuales de integración y elección de indicadores. Para otras materias, proponer una especificación pedagógica de simulación; implementar un nuevo componente y su validación antes de declarar que es compatible. No insertar un nombre de simulación inventado en el JSON.

Se pueden agregar campos de objetivos, conceptos, respuestas aceptables, errores frecuentes, pistas y trazabilidad (`adaptationRationale` con IDs de eventos). Se conservan en importación/exportación y llegan al tutor con la lección, pero no crean vistas nuevas por sí solos.

## Continuaciones e historial

Mantener el ID del curso para una continuación; incrementar `version`. Entregar el **curso completo**, no solamente un parche. Mantener IDs estables cuando el significado no cambie; para una actividad sustancialmente nueva usar otro ID. Al actualizar se guarda el curso anterior en un evento `course_version`; las anotaciones anteriores siguen en el cuaderno con su fragmento y versión originales. La comprensión de la versión nueva debe volver a comprobarse.

El respaldo incluye `courses`, `events`, `settings`, `schemaVersion`, fecha de exportación y zona horaria. Cada evento lleva `id`, `timestamp`, `kind`, `courseId`, `lessonId` y `data`. `data` conserva la evidencia original, versión y huella del curso cuando corresponda. No editar o resumir destructivamente estos eventos para preparar una continuación. Usar IDs de eventos en su justificación.

Incluye también `calendarEvents`, con eventos ligados al curso, revisión, tipo (`theory`, `practice`, `deadline`, `exam`, `study`), fecha ISO, hora opcional y fecha final opcional de repetición semanal. Un conflicto de revisión/contenido al restaurar se rechaza. `tutor_note` registra una síntesis importante del tutor con cita literal y evento de origen; no es evidencia independiente. `continuation_requested` y `continuation_applied` conservan los encargos explícitos y su aplicación por MCP.

También incluye `library`: documentos registrados, apuntes independientes, versiones anteriores y borradores de cursos. Cada apunte conserva ID, revisión, título, carpeta, contenido, visibilidad, fechas, documento/página opcionales y referencias con documento, huella SHA-256, página PDF, fragmento y comentario. Un apunte no exige curso ni documento. En la trazabilidad de una lección podés conservar `noteIds` y sus revisiones dentro de `adaptationRationale`; esos campos no crean controles nuevos. El MCP comparte solamente los apuntes actuales autorizados; el respaldo personal completo incluye también los privados.

Las prioridades son decisiones pedagógicas estimadas; no inventar probabilidades de aparición en un examen. Registrar faltantes, distinguir respuestas asistidas y no tratar visita, tiempo o revisión personal como prueba de comprensión.

## Comprobar el archivo

Desde la carpeta del proyecto:

```bash
python3 scripts/validate_course.py ruta/al/curso.json
```

La validación de estructura no demuestra exactitud, cobertura ni calidad de la enseñanza. Usá `courses/tutorial.json` como referencia de estructura y revisá las fuentes antes de importar.


## Calidad de evaluación y presentación de opciones

Aplicá [la regla de evaluación rigurosa](evaluacion-rigurosa.md) al redactar y revisar actividades. El índice `correctIndex` identifica la opción original, no su posición aleatoria en pantalla. No referirse a letras o posiciones en las opciones. Para alternativas con un orden semántico obligatorio se admite `orderedOptions: true`; el autor debe justificarlo. Los borradores se rechazan si el control mecánico detecta opciones duplicadas, referencias a posiciones o una clave excepcionalmente larga. Esto no reemplaza la verificación semántica.

### Práctica interactiva opcional

Una lección de estudio admite `interactive` con `kind: "classify"` o `"order"`,
`title`, `prompt`, `items` y `explanation`. Cada ítem tiene `id`, `text` y `answer`.
Clasificación requiere `categories` (2–10 textos distintos) y respuestas de esa lista.
Ordenamiento requiere posiciones únicas como textos `"1"` a `"N"`. Se admiten 2–20
ítems. La clasificación muestra tarjetas y categorías de destino: elegir tarjeta
y categoría funciona por clic o teclado; arrastrar es opcional. El ordenamiento
muestra pasos numerados y botones para subir/bajar. La devolución se muestra en
cada tarjeta después de comprobar; el contador indica elementos ubicados, no
dominio. El componente guarda borrador por pliego,
curso, versión y lección, y muestra la guía solo después de completar y comprobar.
Es práctica asistida: no registra dominio ni sustituye actividades con rúbrica.
No aparece en simulacros. Se entregan datos JSON, sin HTML ni scripts arbitrarios.


### Diagramas y gráficos explorables

`visuals` es una lista opcional de hasta cuatro figuras por lección. Se muestran
solo en estudio, nunca en la resolución de un examen. Cada figura requiere `id`
único, `kind`, `title` y `caption` (explicación textual del modelo y sus límites).
`blockId` opcional la coloca debajo de un bloque existente; sin él aparece después
de la teoría. Las fuentes localizables se conservan en `references` del bloque.

Diagrama `kind: "flow"`: `nodes` (2–12) y `edges` (1–24). Cada nodo tiene `id`,
`label` (hasta 60 caracteres), `detail`, `col` (0–2) y `row` (0–5), sin posiciones
repetidas. Cada conexión tiene `from`, `to` (IDs distintos existentes) y `label`
(relación explícita). Los botones permiten explorar conexiones y leer el detalle;
la alternativa textual enumera todos los nodos y relaciones. Elegí disposiciones
que eviten cruces y flechas sobre otros nodos; validá visualmente el resultado.

Gráfico `kind: "plot"`: `xLabel`, `yLabel` (magnitudes/unidades), `series` (1–3),
cada una con `label` y `points` (2–200 pares `[x,y]` finitos, x estrictamente
creciente). El agente calcula las muestras y verifica sus resultados; no se evalúan
expresiones del curso. Se dibujan segmentos entre muestras, con escalas explícitas,
patrones de línea distintos, selector de serie, control para recorrer puntos y
tabla de valores. Declarar en `caption` si los datos son didácticos, los supuestos
y la interpretación; una interpolación lineal no equivale a una función exacta.

```json
{"id":"circuito","kind":"flow","title":"Del pedido a la operación",
 "caption":"Ejemplo simplificado: una confirmación transmite un pedido validado.",
 "nodes":[{"id":"web","label":"Canal web","detail":"Recibe la solicitud.","col":0,"row":0},
          {"id":"erp","label":"ERP","detail":"Valida y registra la operación.","col":1,"row":0}],
 "edges":[{"from":"web","to":"erp","label":"Pedido confirmado"}]}
```

Estos recursos explican y permiten explorar; no producen evidencia de aprendizaje
ni alteran estados de dominio. El tutor recibe sus datos como parte de la lección,
pero sigue evaluando las respuestas independientes con la rúbrica del ejercicio.


### Lectura fluida y notas de conceptos

Para una sigla o un detalle de consulta, guardar primero una nota nativa con
`save_native_note` y usar el enlace devuelto dentro del texto del bloque:
`Un [ERP](#note=ID) conecta procesos internos y comparte datos.` La nota contiene
el desarrollo de la sigla, definición, ejemplo y fuente; la prosa no repite esa
expansión larga. Reutilizar el ID cuando el concepto ya tiene una nota en el mismo
pliego y comprobar que el destino exista. Los enlaces nativos tienen vista previa
y permiten abrir la nota. No usarlos en títulos ni en campos sin soporte de enlaces,
ni para adelantar soluciones en un examen. La explicación central sigue en la lección.
