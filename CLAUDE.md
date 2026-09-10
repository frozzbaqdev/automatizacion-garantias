# Directrices para Claude en este proyecto

Instrucciones permanentes del usuario para trabajar en **frozz-garantias**. Léelas antes de hacer cambios.

## Idioma

Responder **siempre en español**, en todas las conversaciones de este proyecto. Aplica a todo el texto dirigido al usuario (explicaciones, resúmenes, preguntas). No aplica a identificadores de código, nombres de variables/funciones ni convenciones técnicas ya en inglés (ej. propiedades de Notion).

## Despliegue automático

Después de hacer cambios de código, ejecutar `npm run deploy` automáticamente, **sin esperar a que el usuario lo pida**. Trata "deploy"/"publicar" como implícitamente autorizado en este proyecto. Si el cambio es experimental o no probado contra datos reales de Notion, dilo, pero el default es desplegar automáticamente al terminar.

## El deployment debe quedar fijo (pinned)

La URL pública `/exec` que usan los clientes está atada a un deployment ID específico:
`AKfycbyImHZW3HIlv_9xSnhfI9_j_J6pXbvkcNokhkRa9gEiohdc0mfWijT5tBQLl02L01-dnA`
(URL completa: `https://script.google.com/macros/s/AKfycbyImHZW3HIlv_9xSnhfI9_j_J6pXbvkcNokhkRa9gEiohdc0mfWijT5tBQLl02L01-dnA/exec`)

**Nunca** correr `clasp deploy` sin `-i <deploymentId>` — eso crea un deployment nuevo con su propia URL en vez de actualizar el existente (ya pasó una vez y tocó limpiarlo con `clasp undeploy`). Siempre usar `npm run deploy` (que ya incluye `push:force` + el `-i` pineado), o si se despliega a mano, pasar siempre ese `-i`.

Nota: `clasp run <function>` falla con `NOT_FOUND` en este proyecto (no está configurado como API executable). Cambios en Script Properties (`configurarCredenciales`, `configurarCredencialesClientes`) requieren que el usuario los corra manualmente una vez desde el editor de Apps Script (script.google.com, no `clasp open`).

## Pruebas con Playwright: solo si el usuario lo pide

**No** lanzar pruebas con Playwright MCP por iniciativa propia después de un deploy. Solo abrir el navegador y probar interacción real cuando el usuario lo pida explícitamente en ese turno ("pruébalo", "usa playwright", etc.).

Si de todos modos parece valioso verificarlo en vivo, ofrecerlo brevemente ("¿quieres que lo pruebe con Playwright?") en vez de hacerlo directamente.

## Botones con loader

Todo botón que dispare una llamada async (`google.script.run`, fetch, etc.) debe mostrar un **loader visual** mientras está en curso, no solo deshabilitarse o cambiar su texto a "Cargando…".

En este proyecto ya existe el patrón reutilizable en [src/Styles.html](src/Styles.html): clase `.btn.is-loading` (agrega un spinner giratorio antes del texto, reutilizando `@keyframes girar-spinner`) y `.search-bar .search-submit.is-loading` para el botón redondo de ícono. Al agregar un botón nuevo que dispare una acción async:
1. Deshabilitar el botón (`btn.disabled = true`).
2. `btn.classList.add('is-loading')`.
3. Al terminar (éxito o error), quitar ambos.
