# Pendientes

Ideas anotadas para más adelante. **No forman parte de la entrega actual** y no
conviene presentarlas como si ya existieran.

## Lector de PDF

- **Voz natural en voz alta.** Leer el fragmento o la página con una voz que
  suene humana, eligiendo dónde empezar y con qué velocidad. El audio acompaña la
  lectura; no reemplaza haber entendido ni acredita comprensión.
- **Seguimiento automático de texto.** Mientras se escucha o se lee, que el
  resaltado avance solo sobre la frase que suena, sin perder la posición si la
  persona se detiene. Habría que cuidar que no compita con el resaltado manual:
  quien decide qué marcar sigue siendo quien estudia.

Ambas necesitan decidir antes la fuente de la voz, el permiso y el costo, y cómo
conviven con los resaltados y las notas que ya existen. Por eso quedan escritas
acá y no implementadas.

## Autoría y tutor: revisar evaluator-loop y /teach

Pedido del 16/10/2026: dejar estas ideas para después y continuar ahora con el
pliego del parcial TPG. No implementar sin volver a consultar al usuario.

- Revisar `<HOME>/Scripts/skills/evaluator-loop/SKILL.md` como referencia:
  en autoría, planificación según plazo y actividades integradoras; en tutor,
  dudas explícitas, diagnóstico tentativo de errores, refuerzo con casos nuevos
  e intercalación de dificultades anteriores.
- Comparar con lo ya disponible antes de proponer cambios, para evitar duplicar
  registros, continuaciones y controles de evidencia.
- Localizar y revisar también la skill `/teach`: todavía no fue inspeccionada.
  Identificar qué aporta y proponer qué correspondería a autoría o al tutor.
- Conservar la evaluación por criterio y las citas del estudiante; distinguir
  ayuda de aplicación independiente y avance por plazo de dominio demostrado.
- No trasladar reglas de igualar longitudes artificialmente, imponer balances
  de respuestas, inferir probabilidades de examen ni acreditar dominio mediante
  un umbral automático de nota. Mantener azar criptográfico y revisión semántica.

La revisión de skills es una fuente de propuestas, no una autorización para
modificar los MCP ni para adoptar su flujo completo.

## Interfaz móvil pendiente

Implementación actual autorizada: solo escritorio. Estas observaciones quedan
para un ciclo móvil posterior; comprobarlas en teléfonos y anchos estrechos
antes de ajustar el comportamiento.

- **Lectura y barra inferior:** en lectura, la barra fija inferior puede tapar las
  últimas líneas. Criterio de aceptación: el final del contenido puede
  desplazarse por encima de la barra y permanece legible, con controles
  accesibles y sin saltos al abrir/cerrar paneles.
- **Orden del inicio:** en móvil, “Nuevo pliego” e “Importar” aparecen antes de
  “Continuar”. Criterio de aceptación: si hay trabajo reciente, “Continuar” se
  encuentra antes de las acciones de creación/importación; en biblioteca vacía,
  creación sigue siendo la acción principal.
- **Calendario global:** explorar una agenda diaria como detalle principal en
  móvil en lugar de depender de las celdas mensuales estrechas. Criterio de
  aceptación: cada día permite ver y editar eventos, crear horarios y manejar
  excepciones; el mes sigue disponible para orientarse y no hay desbordamiento
  horizontal.
