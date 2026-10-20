# Sesiones de estudio con foco y estadísticas

Implementado: un único control de sesión visible en la barra superior,
que reúna pomodoro y cronómetro libre. El objetivo es acompañar el estudio y conocer
cómo se distribuye el esfuerzo. Tiempo, actividad visible y aprendizaje comprobado
son mediciones diferentes. El control ya ofrece pomodoro, cronómetro libre y estadísticas del pliego seleccionado.

## Interfaz

En escritorio, ubicar el control entre el contexto de la materia y Comandos:
`◷ Foco 18:42 · II`. Antes de iniciar muestra `Iniciar foco`; pausado, `Pausado`;
en descanso, `Descanso 04:12`. Mantener el modo y la materia visibles. En móvil,
usar un control compacto en el encabezado; no competir con el dock inferior de
Conversar ni tapar ejercicios. En modo Foco conservar una versión mínima.

Al pulsar, abrir un panel con objetivo opcional (por defecto la lección actual),
duración, pausa y acciones iniciar/pausar/finalizar. Ofrecer 25/5, 50/10 y duración
personalizada, además de sesión libre. Son valores iniciales editables, no una
prescripción de duración ideal. Permitir ocultar el conteo mientras sigue activo.

Al terminar el bloque: señal discreta, sonido opcional, y opciones descansar,
seguir estudiando o finalizar. No interrumpir respuestas, abrir un modal obligatorio
ni empezar otro bloque automáticamente. La pausa larga puede sugerirse después de
varios bloques, con decisión del estudiante. En examen, el pomodoro personal no
impone un plazo ni entrega respuestas; no confundirlo con la duración del examen.

El cierre ofrece una única pregunta opcional: «¿Cómo te resultó?» (costó / bien /
fácil), con detalle desplegable. No pedirla en cada pausa ni convertirla en nota.

## Qué registrar

| Registro | Uso |
|---|---|
| ID de sesión y de cada segmento, dispositivo y revisión | Recuperación y deduplicación |
| Inicio/fin UTC y zona horaria | Duración y agrupación por día local |
| Modo libre/pomodoro, duración planeada y fase | Comparar intención con ejecución |
| Foco, descanso, pausa, extensión y cierre | Separar tipos de tiempo |
| Pliego, curso, versión y lección o apunte | Distribución de esfuerzo sin copiar contenido |
| Vista y visibilidad de Glosa durante cada segmento | Estimar uso visible, sin afirmar atención |
| Respuesta opcional al cierre | Interpretación personal separada del desempeño |

Reutilizar los IDs de respuestas, dudas y evaluaciones existentes para relacionar
la sesión con actividades; no duplicar mensajes completos ni registrar cada clic
o pulsación. Las interacciones asistidas no son respuestas independientes.

La primera versión debe mostrar tiempo por materia/día, foco y descanso, sesiones
finalizadas/interrumpidas, duración habitual y distribución por lección o tipo de
actividad. Una vista semanal puede añadir mapa horario y planeado frente a realizado.
Más adelante se pueden explorar relaciones con dudas y comprobaciones independientes,
sin inferir causalidad ni concluir que más minutos implican más aprendizaje.

## Continuidad y calidad de la medición

El temporizador personal puede seguir mientras el estudiante consulta un PDF,
un libro u otra ventana. Registrar por separado que Glosa no estaba visible; no
clasificar automáticamente ese intervalo como distracción. Al volver tras una
ausencia prolongada, permitir revisar el tramo y conservar la corrección como tal.
La autoevaluación no sustituye medición ni evidencia de dominio.

Reutilizar `study_time`, evitando sumar dos veces el reloj actual y el pomodoro.
El tiempo debe dividirse por contexto al cambiar de curso, apunte o pliego; una
sesión puede contener varios segmentos. El resumen diario debe aclarar su alcance:
pliego seleccionado o todas las materias del Margen.

Guardar segmentos incrementalmente y recuperar la sesión tras recargar. Calcular
el conteo desde un instante objetivo, no restando segundos por cada tick. Evitar
que pestañas simultáneas contabilicen la misma sesión. En desconexión, conservar
una cola local con IDs estables; al sincronizar, no duplicar intervalos. Si cambia
el reloj del sistema o el equipo duerme, marcar la incertidumbre y permitir revisar.
Separar el registro de estas sesiones del contexto enviado al tutor: usar agregados
pertinentes al objetivo, no volcar la telemetría completa.

## Entrega sugerida

1. Control en encabezado y panel de sesión, pomodoro/libre, pausa/descanso y recuperación.
2. Registro unificado por segmentos y resumen diario por materia, sin doble conteo.
3. Vista semanal y cierre opcional; después, relaciones con evidencias de aprendizaje.

Verificar con reloj controlable y base temporal: recarga, pestañas simultáneas,
modo oculto, cambios de pliego, desconexión, sueño, cambio de día/zona horaria,
impresión, teclado y móvil. Ninguna prueba agrega sesiones ficticias al historial
real. Reversión: retirar control/panel y motor nuevos conservando los registros;
el contador anterior solo se reemplaza cuando la medición unificada esté validada.


## Estado y comprobación de esta entrega

Implementados control superior, panel, 25/5, 50/10 y duración personalizada,
cronómetro libre, pausas, descansos voluntarios, cierre con valoración opcional,
sonido optativo y ocultar conteo. Recuperación por navegador con un único escritor
coordinado mediante Web Locks; cola local por pliego y eventos con IDs estables.
Un intervalo largo sin observación del reloj requiere revisión antes de continuar.
Los intervalos fuera de Glosa pueden contarse, con visibilidad separada.

El panel muestra hoy y últimos siete días del **pliego seleccionado**, por materia
y actividad. Los tiempos históricos se conservan como estimaciones. El día se
agrupa según la zona horaria de la instalación, indicada por la API. El historial
exportable conserva sesiones y segmentos, sin enviarlos como conversación al tutor.
No se agregaron estadísticas entre todos los pliegos ni inferencias de aprendizaje.
Un segundo dispositivo tiene su propia sesión declarada: todavía no hay coordinación
entre navegadores o dispositivos ni unión de sus intervalos solapados.

Unidades de revisión: (1) almacenamiento y agregación en `study_sessions.py`,
(2) motor y adaptación del registro anterior en `web/focus-clock.js` y `web/app.js`,
(3) panel y estilos en `web/focus-panel.*`. No se creó un commit sobre los cambios
previos del workspace. Revertir el panel/motor/adaptador y rutas nuevos permite
retirar la función; no borrar sus eventos. Restaurar el registrador anterior solo
si se retira el nuevo, para evitar doble conteo.

Comprobaciones ejecutadas: ocho pruebas de almacenamiento/agregación y exclusión de telemetría del tutor; motor con
reloj controlable (plazo, pausa, descanso, recarga, pestañas, cambio de contexto,
cola offline, visibilidad, ausencia y reloj atrasado); prueba completa de navegador
con base temporal (panel, descanso, recarga, dos pestañas, estadísticas y cierre);
74 pruebas de aprendizaje existentes y flujo de exámenes en Chromium. Las pruebas
no escriben respuestas ni sesiones ficticias en los pliegos reales. Se verificaron
capturas del panel en escritorio y móvil y ausencia de superposiciones en encabezado.

### Avisos durante la sesión

El pomodoro avisa cuando falta un minuto en etapas de cinco minutos o más.
Al completar foco pregunta si querés descansar, seguir o finalizar; al completar
el descanso pregunta si querés otro bloque o finalizar. El aviso permanece en
la página hasta elegir o pulsar «Ahora no», sin abrir un modal ni cambiar de
etapa automáticamente. El panel conserva las mismas decisiones al reabrirlo.
La valoración opcional se pide únicamente al finalizar la sesión.

El sonido suave está activado inicialmente; se puede desactivar en Preferencias.
El navegador necesita una interacción para habilitar audio. Los avisos de
escritorio son optativos: el permiso se solicita al activar esa preferencia y
se usan al completar una etapa con Glosa en segundo plano. Si el navegador los
bloquea o el equipo duerme, el aviso de la página queda disponible al volver;
no se promete una alarma con la página cerrada. Avisos y sonido no acreditan
aprendizaje ni generan respuestas del estudiante.
