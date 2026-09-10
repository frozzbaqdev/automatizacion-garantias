# Contexto del proyecto — Frozz Garantías (para replicar el patrón en otro proyecto)

Documento de referencia con toda la arquitectura, decisiones y aprendizajes de este
proyecto, pensado para arrancar un proyecto **similar** (portal web ligero sobre
Google Apps Script + Notion como base de datos) sin tener que redescubrir nada.

## 1. Qué es este proyecto

Portal web responsive para que clientes de una empresa (Frozz) **creen y consulten
tickets de garantía**, sin necesidad de cuenta ni login. Los datos viven en una base
de datos de Notion; el "backend" es 100% Google Apps Script (sin servidor propio, sin
hosting, sin base de datos tradicional).

Dos operaciones únicamente:
- Crear un ticket (formulario) → Notion asigna un ID autogenerado (`GAR-N`).
- Consultar un ticket por ese ID → se muestra su estado como línea de tiempo.

## 2. Por qué esta arquitectura (y cuándo tiene sentido replicarla)

Encaja bien cuando:
- El "backend" real ya es una base de datos de Notion que un equipo administra
  manualmente (mueve estados, asigna responsables, etc.) y el portal solo necesita
  ser una fachada de lectura/escritura simple sobre ella.
- No se quiere pagar ni mantener hosting: Apps Script es gratis, se despliega como
  Web App con `clasp`, y Notion hace de base de datos + panel de administración para
  el equipo interno.
- El volumen de tráfico es bajo/medio (Apps Script tiene cuotas de ejecución diarias).

No encaja si se necesita autenticación de usuarios, alta concurrencia, relaciones
complejas entre muchas bases de Notion, o una PWA instalable garantizada (ver
limitación en la sección 7).

## 3. Stack técnico

- **Frontend**: HTML/CSS/JS vanilla servido por Apps Script (`HtmlService`), sin
  frameworks. Un solo `Index.html` con dos "vistas" (tabs) mostradas/ocultadas por JS.
- **Backend**: Google Apps Script (V8 runtime), funciones `.js` normales expuestas al
  cliente vía `google.script.run`.
- **Base de datos**: Notion, vía su API REST (`https://api.notion.com/v1`), llamada
  con `UrlFetchApp` (no hay SDK oficial de Notion para Apps Script).
- **Despliegue/tooling**: `@google/clasp` (CLI de Google) para subir código y
  gestionar el deployment del Web App. `npm scripts` como wrapper de los comandos de
  clasp.
- **Credenciales**: `PropertiesService.getScriptProperties()` de Apps Script — nunca
  en el repo. Se cargan una sola vez ejecutando una función desde el editor.

## 4. Estructura de archivos

```
.clasp.json          # config de clasp: scriptId, rootDir=src, extensiones
.env                  # SOLO para pruebas locales del token de Notion (no lo usa Apps Script)
package.json          # scripts npm que envuelven clasp (push, deploy, logs...)
src/
  appsscript.json      # manifest de Apps Script (timezone, webapp access, runtime)
  Code.js              # doGet(), funciones expuestas al cliente (crearTicket, buscarTicketPorId, configurarCredenciales)
  Notion.js            # toda la capa de integración con la API de Notion (fetch, mapeo de propiedades)
  Datos.js             # datos auxiliares hardcodeados (lista de empresas) — "reemplazar cuando exista fuente real"
  Index.html           # único HTML, con <?!= include(...) ?> para inyectar Styles/JavaScript
  JavaScript.html      # todo el JS del cliente (fetch de listas, submit de forms, render de resultado)
  Styles.html           # todo el CSS, inline dentro de un <style>
```

Patrón clave de Apps Script: **un solo archivo HTML sirve la página**
(`HtmlService.createTemplateFromFile('Index')`), y CSS/JS se inyectan como archivos
`.html` separados vía `include()` — es la forma estándar de organizar código en Apps
Script, que no permite servir `.css`/`.js` como archivos estáticos sueltos.

## 5. Modelo de datos en Notion

Base de datos "GARANTÍAS" (`NOTION_DATABASE_ID` en Script Properties). Propiedades
reales verificadas contra la API (2026-09-04):

| Propiedad | Tipo Notion | Notas |
|---|---|---|
| `ID` (título de la fila) | Unique ID (prefijo `GAR`) | Autogenerado por Notion, no se envía al crear |
| `FECHA CREACION SOLICITUD` | Date | Antes se llamaba `FECHA` (renombrada 2026-09-07); se setea a hoy al crear |
| `FECHA ESTIMADA DE ENTREGA` | Date | Opcional, la ingresa el equipo interno en el panel de gestión (tarjeta "Asignación") |
| `FECHA CIERRE SOLICITUD` | Date | Se setea sola al rechazar o finalizar una garantía, nunca la llena una persona |
| `PRIORIDAD` | Select (Baja/Media/Alta/Urgente) | Se fuerza a `Baja` al crear |
| `ESTADO` | Status (Sin empezar/En curso/Listo) | Se fuerza a `Sin empezar` al crear |
| `ETAPA` | Select (4 etapas del flujo interno) | Se fuerza a la primera etapa al crear; el equipo interno la mueve manualmente en Notion, el portal solo la **lee** para pintar una línea de tiempo |
| `MOTIVO` | Multi-select (3 opciones fijas) | |
| `DESCRIPCIÓN GENERAL` | Rich text | |
| `PLAN DE ACCION` | URL | Solo lo llena el equipo interno; el portal lo muestra si existe |
| `NOMBRE/TELEFONO/CORREO REPRESENTANTE CLIENTE` | Rich text / Phone / Email | |
| `CLIENTE` | Relation → `CLIENTES (COMERCIAL)` | Se llena con el `pageId` que devuelve la búsqueda por NIT (ver abajo) |

**Actualización 2026-09-04**: la integración ahora tiene acceso, vía `/v1/search`, a
6 bases: `GARANTÍAS`, `CLIENTES (COMERCIAL)`, `PERSONAL ACTIVO`, `DISEÑOS`,
`ORDEN DE TRABAJO` y `Programación KICK OFF MEETING` (las últimas 3 de otros
proyectos, sin relación). `CLIENTE` en `GARANTÍAS` ya es una propiedad `relation`
real hacia `CLIENTES (COMERCIAL)` — el portal la llena con
`{ relation: [{ id: pageId }] }`, usando el `pageId` que devuelve
`notionBuscarClientePorNit_()` en `Clientes.js` tras validar el NIT.

Base "CLIENTES (COMERCIAL)" (`databaseId` `268ca234-1407-8057-a4ee-e51de6b2d55a`,
guardado en Script Properties como `NOTION_CLIENTES_DATABASE_ID` vía
`configurarCredencialesClientes()`), propiedades relevantes para el portal:

| Propiedad | Tipo Notion | Notas |
|---|---|---|
| `NOMBRE DE CLIENTE` (título de la fila) | Title | Nombre de la empresa que se muestra en el portal |
| `#DOCUMENTO` | Rich text | NIT/cédula; puede venir con puntos/guiones — se compara solo por dígitos (`limpiarNit_()`) |
| `TIPO DE DOCUMENTO` | Select (NIT/CC) | No se usa para filtrar, solo informativo |

El patrón general para conectar una relación real una vez se comparte la base
(reutilizable si se replica este proyecto):
1. Compartir explícitamente cada base relacionada con la integración desde Notion
   (menú `···` → *Connections*, por cada base).
2. Confirmarlo con `POST /v1/search` (debe listar esas bases) antes de asumir que ya
   tiene acceso — "estar en el mismo workspace" no es suficiente, compartir es un
   paso explícito por base.
3. Verificar el esquema real con `GET /v1/databases/{id}` — no asumir nombres de
   columna, confirmarlos.
4. Guardar el `databaseId` de la base relacionada en Script Properties (mismo patrón
   que `NOTION_DATABASE_ID`) y usar `{ relation: [{ id: pageId }] }` al escribir.

## 6. Flujo de configuración de credenciales

Nunca van en el repo ni en `appsscript.json`. Una sola vez, desde el editor de Apps
Script (`clasp open`), se ejecuta manualmente:

```js
configurarCredenciales('TU_TOKEN_DE_NOTION', 'TU_DATABASE_ID');
```

Esto llama a `PropertiesService.getScriptProperties().setProperties(...)`
([Code.js:40-45](src/Code.js#L40-L45)), que persiste fuera del control de versiones.
`getNotionConfig_()` en `Notion.js` lee de ahí y lanza error explícito si faltan.

El `.env` de este repo es **solo una copia de conveniencia para poder probar la
integración con `curl`/`node` desde fuera de Apps Script** (como se hizo en esta
sesión) — Apps Script mismo nunca lo lee.

## 7. Despliegue

```bash
npm run push:force   # clasp push --force: sube src/ al proyecto de Apps Script
npm run deploy       # push:force + clasp deploy: crea/actualiza el deployment del Web App
```

El manifest (`appsscript.json`) fija `"executeAs": "USER_DEPLOYING"` y
`"access": "ANYONE_ANONYMOUS"` — el portal es público, sin login, y corre con los
permisos de quien lo desplegó (no de cada visitante). Esto es clave: cualquier
llamada a la API de Notion se hace con el token guardado por quien desplegó, nunca
con credenciales del visitante.

La URL que se comparte con clientes es la del deployment terminada en `/exec`.

## 8. Patrón backend (Apps Script)

- `doGet(e)` en `Code.js` sirve el HTML (o el manifest si `?page=manifest`).
- Funciones "públicas" para el cliente (`crearTicket`, `buscarTicketPorId`) hacen
  **validación de input en Apps Script** (campos obligatorios, formato de correo,
  valores permitidos) antes de llamar a la capa de Notion, y siempre devuelven
  `{ ok: true/false, ... }` en vez de lanzar excepciones al cliente — así el frontend
  nunca tiene que lidiar con try/catch de `google.script.run`.
- `Notion.js` centraliza: helpers de serialización por tipo de propiedad
  (`rt_`, `sel_`, `multiSel_`, `status_`, `date_`, `tel_`, `email_`) y de lectura
  (`leerTexto_`, `leerSelect_`, etc.), más `notionRequest_()` como wrapper único de
  `UrlFetchApp.fetch` con manejo de errores HTTP de Notion.
- Todas las funciones "privadas" (no expuestas al cliente) terminan en `_` por
  convención — es una convención de Apps Script, no hace nada especial por sí sola,
  pero documenta la intención.

## 9. Patrón frontend

Un solo `Index.html` con dos secciones (`data-view="nuevo"` / `data-view="consultar"`)
que se muestran/ocultan por CSS (`.is-active`) al hacer click en tabs — no hay router,
no hay build step, no hay framework.

Comunicación con el backend, siempre con el mismo patrón
(`google.script.run` es la API que Apps Script inyecta en el HTML servido):

```js
google.script.run
  .withSuccessHandler(function (res) { /* res.ok / res.error */ })
  .withFailureHandler(function (err) { /* error inesperado (excepción no controlada) */ })
  .nombreDeFuncionEnAppsScript(args);
```

`withFailureHandler` solo se dispara ante una excepción no capturada en el backend;
como las funciones públicas siempre devuelven `{ ok:false, error }` en vez de lanzar,
`withFailureHandler` casi nunca debería activarse en uso normal — es la red de
seguridad para errores realmente inesperados.

## 10. Limitación conocida: "PWA" en Apps Script

Apps Script sirve el HTML dentro de un `<iframe>` en un dominio
`googleusercontent.com` distinto del dominio superior `/exec`. Por eso un
`manifest.json` + service worker reales (instalación nativa, caché offline
garantizada) **no son 100% confiables** en este hosting — es una limitación de la
plataforma, no del código. Aun así el portal:
- Es responsive y usable como app desde navegador móvil.
- Sirve un manifest best-effort en `?page=manifest`.
- Si se necesita PWA instalable garantizada, la solución es separar el frontend a un
  hosting estático que consuma este Apps Script solo como API.

## 11. Cómo se validó la integración con Notion (metodología reutilizable)

Para verificar que una integración de Notion tiene acceso a lo que se espera, sin
depender del editor de Apps Script:

```bash
# 1. Listar TODO lo que la integración puede ver (no basta con "compartir en el workspace")
curl -s -X POST https://api.notion.com/v1/search \
  -H "Authorization: Bearer $NOTION_TOKEN" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"property": "object", "value": "database"}}'

# 2. Confirmar el esquema real y actualizado de una base concreta
curl -s "https://api.notion.com/v1/databases/$NOTION_DATABASE_ID" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28"

# 3. Prueba end-to-end: crear una página de prueba, consultarla, y archivarla
#    (PATCH .../pages/{id} con {"archived": true}) para no dejar basura en la base real.
```

Notas prácticas:
- En Windows/Git Bash, pasar el JSON del payload por `--data-binary @archivo.json`
  (no `-d '...'` inline) evita que se corrompan los acentos/tildes por la codificación
  del shell.
- `archived: true` es reversible (va a la papelera de Notion) — preferible a borrar
  de verdad al hacer pruebas sobre una base productiva.

## 12. Checklist para arrancar un proyecto nuevo con este mismo patrón

1. Crear la base de datos en Notion con las propiedades necesarias.
2. Crear la integración interna en `notion.so/my-integrations`, copiar el token.
3. Compartir explícitamente la base (y cualquier base relacionada) con esa
   integración desde `···` → Connections.
4. Verificar acceso con `POST /v1/search` **antes** de escribir código contra
   propiedades que no se ha confirmado que existan.
5. `clasp create` (o clonar este `.clasp.json` con un `scriptId` nuevo) +
   `rootDir: "src"`.
6. Separar helpers de serialización/lectura por tipo de propiedad de Notion en un
   archivo tipo `Notion.js`, para no repetir mapeo de tipos en cada función.
7. Guardar credenciales solo vía `PropertiesService`, nunca en `appsscript.json` ni
   en el repo.
8. Definir `appsscript.json` con `access` según si el portal debe ser público o no.
9. Un `Index.html` + `Styles.html` + `JavaScript.html` con `include()`, sin build step.
10. Cada función pública del backend valida input y devuelve `{ok, ...}` en vez de
    lanzar, para que el frontend no necesite manejar excepciones de
    `google.script.run`.
