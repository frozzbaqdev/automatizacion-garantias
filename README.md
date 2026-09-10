# Frozz Garantías — Portal de tickets

Portal web responsive, sin login, para que los clientes de **Frozz Colombia**
creen y consulten solicitudes de garantía. No hay servidor propio ni base de
datos tradicional: todo el "backend" es **Google Apps Script** y todos los
datos viven en una base de datos de **Notion** que el equipo interno
administra manualmente (mueve etapas, asigna responsables, etc.).

Incluye además un **panel interno de gestión** (sin login, protegido solo por
un link "secreto" por garantía) donde el equipo de Frozz asigna responsables,
avanza el caso por sus etapas, aprueba/rechaza y cierra la garantía.

---

## Tabla de contenido

1. [Qué hace el portal](#1-qué-hace-el-portal)
2. [Arquitectura](#2-arquitectura)
3. [Con qué se conecta](#3-con-qué-se-conecta)
4. [Estructura de archivos](#4-estructura-de-archivos)
5. [Modelo de datos en Notion](#5-modelo-de-datos-en-notion)
6. [Herramientas de Claude Code en este repo (skills / MCP)](#6-herramientas-de-claude-code-en-este-repo-skills--mcp)
7. [Instalación desde cero, paso a paso](#7-instalación-desde-cero-paso-a-paso)
8. [Desarrollo día a día](#8-desarrollo-día-a-día)
9. [Convenciones de código](#9-convenciones-de-código)
10. [Modelo de seguridad](#10-modelo-de-seguridad)
11. [Limitación conocida: "PWA" en Apps Script](#11-limitación-conocida-pwa-en-apps-script)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Qué hace el portal

Dos flujos públicos (sin cuenta, sin login), accesibles desde la URL
`/exec` del deployment:

- **Nueva garantía**: el cliente ingresa el NIT/CC de su empresa (se valida
  contra Notion), opcionalmente elige una orden de trabajo asociada, llena un
  formulario (motivo, descripción, datos de contacto) y puede adjuntar hasta
  5 archivos de soporte (máx. 8 MB c/u). Al enviar, recibe un número de
  garantía con formato `GARF######` que debe guardar para consultar el
  estado más adelante.
- **Consultar garantía**: el cliente ingresa el número de garantía + NIT/CC
  de su empresa y ve el estado como una línea de tiempo (etapa actual,
  prioridad, plan de acción si ya existe, etc.).

Y un flujo interno, solo para el equipo de Frozz:

- **Panel de gestión** (`?page=gestionar&id=<pageId>`): accesible únicamente
  desde el link que el portal guarda automáticamente en la propiedad
  `GESTIONAR GARANTIA` de cada fila en Notion. Desde ahí el equipo:
  - Asigna prioridad, líder responsable y operario responsable.
  - Avanza la garantía por sus etapas (`Revisión inicial` → `Diagnóstico` →
    `Aprobación` → `En ejecución` → `Finalizada`), sin poder saltarse
    ninguna.
  - Aprueba o rechaza la garantía (con comentario).
  - Finaliza la garantía (cierra el caso).
  - Cada acción relevante dispara un correo automático (al cliente, al líder
    asignado, o al equipo de Frozz según el caso).

## 2. Arquitectura

```
┌─────────────────────┐        google.script.run        ┌──────────────────────────┐
│  Navegador (cliente) │ ───────────────────────────────▶│  Google Apps Script (V8) │
│  Index.html / JS     │◀─────────────────────────────── │  Code.js (doGet, API)    │
│  Gestionar.html / JS │                                  │  Notion.js / Clientes.js │
└──────────────────────┘                                  │  OrdenTrabajo.js         │
                                                            │  Personal.js / Drive.js  │
                                                            │  CorreoCliente/Gestion.js│
                                                            │  Errores.js              │
                                                            └────────────┬─────────────┘
                                                                         │ UrlFetchApp
                                              ┌──────────────────────────┼──────────────────────────┐
                                              ▼                          ▼                          ▼
                                     Notion API (REST)          Google Drive API v3        Gmail (MailApp)
                                     4 bases de datos            (Shared Drive)         correos transaccionales
```

- **Frontend**: HTML/CSS/JS vanilla servido por Apps Script (`HtmlService`).
  Sin frameworks, sin build step. `Index.html` (portal público) y
  `Gestionar.html` (panel interno) son plantillas que inyectan CSS/JS por
  `include()` (Apps Script no sirve `.css`/`.js` como archivos estáticos
  sueltos, es el patrón estándar de la plataforma).
- **Backend**: funciones `.js` normales de Apps Script, expuestas al cliente
  vía `google.script.run`. Cada función pública valida su input y **siempre
  devuelve `{ ok: true/false, ... }`** en vez de lanzar excepciones al
  navegador — el frontend nunca tiene que lidiar con try/catch de
  `google.script.run` (el `withFailureHandler` solo debería dispararse ante
  un bug realmente inesperado).
- **Base de datos**: Notion, vía su API REST (`https://api.notion.com/v1`),
  llamada con `UrlFetchApp` (no existe SDK oficial de Notion para Apps
  Script).
- **Almacenamiento de archivos**: Google Drive (API v3 REST, no `DriveApp`,
  ver [Drive.js](src/Drive.js) para el porqué), dentro de una carpeta raíz
  compartida (Shared Drive).
- **Correo transaccional**: `MailApp` de Apps Script (confirmaciones al
  cliente, avisos al equipo y al líder responsable, alertas de error).
- **Despliegue/tooling**: [`@google/clasp`](https://github.com/google/clasp)
  (CLI oficial de Google) para subir código y gestionar el deployment del
  Web App. `npm scripts` como wrapper de los comandos de clasp.
- **Credenciales**: `PropertiesService.getScriptProperties()` de Apps Script
  — nunca en el repo. Se cargan una sola vez ejecutando funciones desde el
  editor de Apps Script.

## 3. Con qué se conecta

| Sistema | Para qué | Vía |
|---|---|---|
| **Notion** — base `GARANTÍAS` | Crear/leer/actualizar cada ticket de garantía | API REST + token de integración interna |
| **Notion** — base `CLIENTES (COMERCIAL)` | Validar NIT/CC del cliente, resolver nombre de empresa | Relation desde `GARANTÍAS` |
| **Notion** — base `ORDEN DE TRABAJO` | Listar OT asociadas a un cliente para vincularlas a la garantía (opcional) | Relation desde `CLIENTES (COMERCIAL)` |
| **Notion** — base `PERSONAL ACTIVO` | Listar líder/operario responsable disponibles en el panel de gestión | Relation desde `GARANTÍAS` |
| **Google Drive** | Carpeta por garantía con la documentación de soporte adjunta | API v3 REST, dentro de una Shared Drive |
| **Gmail (MailApp)** | Correos al cliente (confirmación, aprobación, rechazo, cierre), al equipo (garantía nueva) y al líder (asignación), más alertas técnicas de error | Apps Script `MailApp` |

Las 4 bases de Notion son bases **distintas** (workspaces/páginas
independientes), cada una debe compartirse explícitamente con la integración
de Notion desde `···` → *Connections* — "estar en el mismo workspace" no
basta.

## 4. Estructura de archivos

```
.clasp.json            # config de clasp: scriptId, rootDir=src, extensiones
.env                    # SOLO copia local de conveniencia para probar la API de Notion con curl/node (Apps Script NUNCA lo lee) — no versionar
.mcp.json               # servidor MCP de Playwright (pruebas manuales del portal en navegador)
package.json            # scripts npm que envuelven clasp (push, deploy, logs...)
assets/logo.png          # logo fuente de Frozz (el que se usa en los correos va embebido en base64 en CorreoCliente.js)
src/
  appsscript.json        # manifest de Apps Script (timezone, webapp access, oauthScopes, runtime V8)
  Code.js                 # doGet(), y TODAS las funciones expuestas a google.script.run (portal público + panel de gestión)
  Notion.js               # integración con la base GARANTÍAS: helpers de serialización/lectura por tipo de propiedad, notionRequest_()
  Clientes.js             # integración con la base CLIENTES (COMERCIAL): búsqueda por NIT/CC
  OrdenTrabajo.js          # integración con la base ORDEN DE TRABAJO: listar OT de un cliente
  Personal.js              # integración con la base PERSONAL ACTIVO: líder/operario responsable
  GestionGarantia.js       # lógica de transiciones de etapa del panel de gestión (iniciar, avanzar, aprobar, rechazar, finalizar)
  Drive.js                 # crear carpeta de garantía y subir adjuntos a Drive (API REST v3, en paralelo con fetchAll)
  CorreoCliente.js         # correo de confirmación de ticket al cliente
  CorreoGestion.js         # correos del panel de gestión (aprobación/rechazo/cierre al cliente, aviso al equipo, aviso al líder)
  Errores.js                # notificarErrorPorCorreo_(): alerta por correo al equipo técnico ante cualquier excepción no controlada
  Index.html                # portal público (dos vistas: "Nueva garantía" / "Consultar garantía", tabs por CSS)
  JavaScript.html           # JS del cliente para Index.html (fetch de listas, submit de formularios, render de resultado)
  Styles.html                # CSS del portal público, inline dentro de un <style>
  Gestionar.html              # panel interno de gestión
  JavaScriptGestion.html      # JS del cliente para Gestionar.html
  EstilosGestion.html          # CSS del panel de gestión
```

Convención de Apps Script usada aquí: **un solo archivo HTML sirve cada
página** (`HtmlService.createTemplateFromFile(...)`), y CSS/JS se inyectan
como archivos `.html` separados vía la función `include()` de
[Code.js](src/Code.js) — Apps Script no permite servir `.css`/`.js` sueltos.

## 5. Modelo de datos en Notion

### Base `GARANTÍAS` (principal)

| Propiedad | Tipo Notion | Notas |
|---|---|---|
| `#GARANTIA` (título) | Title | Número real que ve el cliente, formato `GARF` + 6 dígitos, generado por el portal (no por Notion) y verificado como único antes de crear |
| `ID` | Unique ID | Autogenerado por Notion, ya no se usa como número visible |
| `FECHA CREACION SOLICITUD` | Date | Se setea sola al crear |
| `FECHA ESTIMADA DE ENTREGA` | Date | Opcional, la ingresa el equipo interno en el panel |
| `FECHA CIERRE SOLICITUD` | Date | Se setea sola al rechazar o finalizar, nunca manual |
| `PRIORIDAD` | Select (`Baja`/`Media`/`Alta`/`Urgente`) | Se fuerza a `Baja` al crear |
| `ESTADO` | Status (`Sin empezar`/`En curso`/`Listo`) | Se fuerza a `Sin empezar` al crear |
| `ETAPA` | Select (5 etapas, ver arriba) | Se fuerza a `Revisión inicial` al crear; el panel la avanza sin poder saltarse pasos |
| `MOTIVO` | Multi-select (`FALLA DE EQUIPO` / `FALLA POR PARTE DE CLIENTE` / `ERROR HUMANO`) | |
| `DESCRIPCIÓN GENERAL` | Rich text | |
| `PLAN DE ACCION` | URL | Solo la llena el equipo interno |
| `DOCUMENTOS SOPORTE` | URL | Link a la carpeta de Drive de la garantía |
| `GESTIONAR GARANTIA` | URL | Link al panel interno, guardado automáticamente al crear |
| `COMENTARIOS` | Rich text | Comentario de aprobación/rechazo, o error automático si falló Drive |
| `APROBACION GARANTIA` | Select | Se llena al aprobar/rechazar |
| `NOMBRE/TELEFONO/CORREO REPRESENTANTE CLIENTE` | Rich text / Phone / Email | Datos de contacto del formulario |
| `CORREO LIDER RESPONSABLE` | Email | Solo si el líder asignado no tiene correo corporativo en `PERSONAL ACTIVO` |
| `CLIENTE` | Relation → `CLIENTES (COMERCIAL)` | |
| `ORDEN DE TRABAJO` | Relation → `ORDEN DE TRABAJO` | Opcional |
| `LIDER RESPONSABLE`, `OPERARIO RESPONSABLE` | Relation → `PERSONAL ACTIVO` | Nunca los llena el portal público, solo el panel de gestión |

### Base `CLIENTES (COMERCIAL)`

| Propiedad | Tipo | Notas |
|---|---|---|
| `NOMBRE DE CLIENTE` (título) | Title | |
| `#DOCUMENTO` | Rich text | Puede venir con puntos/guiones; se compara solo por dígitos |
| `TIPO DE DOCUMENTO` | Select (`NIT`/`CC`) | |

### Base `ORDEN DE TRABAJO`

| Propiedad | Tipo | Notas |
|---|---|---|
| `CLIENTES (COMERCIAL)` | Relation | No todas las OT la tienen diligenciada; por eso el campo es opcional en el portal |
| `OT` | Formula (string) | Número legible, ej. `OT26-00103` |
| `Servicio` | Title | |
| `Estado actual` | Status | |

### Base `PERSONAL ACTIVO`

| Propiedad | Tipo | Notas |
|---|---|---|
| `Nombre` (título) | Title | |
| `ESTADO` | Select (`Vinculado`/`Desvinculado`/`En progreso`) | Solo se listan los `Vinculado` |
| `Correo corporativo` | Email | Puede venir vacío; el panel pide un correo manual si falta para el líder |

> Si algún nombre de propiedad cambia en Notion, ajusta las constantes
> `PROP` / `OT_PROP` / etc. al inicio de cada archivo de integración
> (`Notion.js`, `Clientes.js`, `OrdenTrabajo.js`, `Personal.js`) — el portal
> no descubre el esquema dinámicamente, los nombres están hardcodeados.

## 6. Herramientas de Claude Code en este repo (skills / MCP)

Este repo trae configuración de [Claude Code](https://claude.com/claude-code)
para quien lo desarrolle con Claude:

- **`.mcp.json`** — servidor MCP `playwright` (`@playwright/mcp`), para
  abrir el portal en un navegador real y probar interacción (formularios,
  clicks, etc.). **No se usa automáticamente**: solo cuando el usuario lo
  pide explícitamente en la conversación.
- **`.agents/skills/`** (declaradas en `skills-lock.json`) — skills
  descargadas de repos públicos, disponibles para Claude Code al trabajar
  en este proyecto:
  - `frontend-design` — guía de diseño visual para UI nueva o rediseños.
  - `improve-react` — auditoría de código React (no muy relevante aquí, el
    frontend es vanilla JS, pero queda disponible si el proyecto migra).
  - `improve-ui` — auditoría de una superficie de producto existente contra
    su propia evidencia de diseño.
- **`.claude/settings.json`** — `enableAllProjectMcpServers: true`, para que
  el MCP de Playwright quede disponible sin aprobación manual por sesión.
- **`CLAUDE.md`** — instrucciones permanentes del proyecto para Claude:
  responder siempre en español, desplegar automáticamente tras cambios de
  código (`npm run deploy`), mantener el deployment **pinned** al ID fijo
  (nunca crear uno nuevo sin `-i`), no lanzar Playwright sin que se pida
  explícitamente, y que todo botón que dispare una llamada async debe
  mostrar un loader visual (patrón `.btn.is-loading` en
  [Styles.html](src/Styles.html)).

Nada de esto es necesario para correr o desarrollar el proyecto — son
herramientas opcionales para quien use Claude Code sobre este repo.

## 7. Instalación desde cero, paso a paso

### 7.1 Prerrequisitos

- **Node.js** 18+ y npm (para `clasp` y los scripts de `package.json`).
- Una **cuenta de Google** con acceso al proyecto de Apps Script (pide que
  te compartan el `scriptId` o el editor, ver 7.3) y a la Shared Drive donde
  vive la carpeta raíz de documentos de garantía.
- Una **cuenta/workspace de Notion** con acceso a las 4 bases (`GARANTÍAS`,
  `CLIENTES (COMERCIAL)`, `ORDEN DE TRABAJO`, `PERSONAL ACTIVO`) y permiso
  para crear/gestionar integraciones internas.
- (Opcional) [Claude Code](https://claude.com/claude-code) si vas a
  desarrollar con asistencia de IA — este repo ya trae su configuración
  (ver sección 6).

### 7.2 Clonar e instalar dependencias

```bash
git clone <url-de-este-repositorio>
cd frozz-garantias
npm install
```

Esto instala `@google/clasp` como dependencia de desarrollo (ya está fijado
en `package.json`, no hace falta instalarlo globalmente).

### 7.3 Autenticarte con clasp

```bash
npx clasp login
```

Abre el navegador y pide iniciar sesión con la cuenta de Google que tiene
acceso al proyecto de Apps Script de Frozz Garantías. Esto genera
`~/.clasprc.json` (credenciales de clasp, **fuera** del repo — no
confundir con `.clasp.json`, que sí está versionado y solo tiene el
`scriptId` público).

Si nunca has tenido acceso al proyecto de Apps Script, pide que te agreguen
como editor desde `script.google.com` (o que te compartan el `scriptId`), y
usa el `.clasp.json` que ya trae el repo — **no** corras `clasp create`,
eso crearía un proyecto de Apps Script nuevo y distinto del que ya está
conectado a Notion/Drive/al deployment publicado.

### 7.4 Configurar la base de datos en Notion

En cada una de las 4 bases (o verifica que ya existan si el workspace es
compartido con el equipo):

1. **`GARANTÍAS`**: confirma que las propiedades coincidan con la tabla de
   la sección 5 (nombres exactos, con tildes). Si algo no calza, hay que
   ajustar las constantes `PROP` en [Notion.js](src/Notion.js) — no al
   revés.
2. Crea o localiza la **integración interna** de Notion en
   [notion.so/my-integrations](https://www.notion.so/my-integrations).
   Copia su **token** (empieza por `secret_` o `ntn_`).
3. Para **cada una** de las 4 bases: menú `···` → **Connections** → conecta
   esa integración. Compartir una no comparte las demás — hay que hacerlo
   base por base.
4. Copia el **ID de cada base** (el bloque de 32 caracteres en la URL,
   antes del `?v=`).
5. Verifica el acceso real de la integración antes de asumir nada:

   ```bash
   curl -s -X POST https://api.notion.com/v1/search \
     -H "Authorization: Bearer $NOTION_TOKEN" \
     -H "Notion-Version: 2022-06-28" \
     -H "Content-Type: application/json" \
     -d '{"filter": {"property": "object", "value": "database"}}'
   ```

   Debe listar las 4 bases. Si falta alguna, revisa el paso 3.

> `.env` en la raíz de este repo es **solo una copia local de conveniencia**
> para poder probar la integración con `curl`/`node` fuera de Apps Script —
> Apps Script mismo **nunca lo lee**. No lo subas a git (ya está en
> `.gitignore`). Si no existe, créalo con el mismo formato que se explica en
> el paso siguiente (token + IDs de las 4 bases).

### 7.5 Configurar la carpeta de Drive

El portal sube la documentación de soporte a una carpeta raíz fija dentro de
una **Shared Drive** (Unidad compartida), cuyo ID está hardcodeado en
`DRIVE_CARPETA_RAIZ_ID` en [Drive.js:26](src/Drive.js#L26). Si vas a usar
otra carpeta/Shared Drive:

1. Crea (o localiza) la carpeta raíz dentro de una Shared Drive a la que la
   cuenta que va a desplegar el portal tenga acceso de escritura.
2. Copia su ID (el segmento final de la URL `.../folders/<ID>`).
3. Actualiza `DRIVE_CARPETA_RAIZ_ID` en `Drive.js`.

### 7.6 Subir el código a Apps Script

```bash
npm run push:force
```

Sube el contenido de `src/` al proyecto de Apps Script (`clasp push
--force`). A partir de aquí puedes abrir el editor con `npx clasp open` para
ejecutar las funciones de configuración de credenciales manualmente (clasp
`run` **no funciona** en este proyecto — no está configurado como API
executable — así que estas funciones solo se pueden correr desde el editor
web).

### 7.7 Configurar credenciales (Script Properties)

Desde el editor de Apps Script (`npx clasp open`, o `script.google.com`
directamente), selecciona cada función en el desplegable de "Ejecutar" y
corre, **una sola vez cada una**:

```js
// Base GARANTÍAS (obligatoria)
configurarCredenciales('TU_TOKEN_DE_NOTION', 'ID_BASE_GARANTIAS');

// Base CLIENTES (COMERCIAL) — necesaria para validar NIT/CC
configurarCredencialesClientes('ID_BASE_CLIENTES');

// Base ORDEN DE TRABAJO — opcional, si no se configura simplemente no se
// ofrecen OT al crear la garantía (nunca bloquea el flujo)
configurarCredencialesOrdenTrabajo('ID_BASE_ORDEN_TRABAJO');

// Base PERSONAL ACTIVO — necesaria para el panel de gestión (líder/operario)
configurarCredencialesPersonal('ID_BASE_PERSONAL_ACTIVO');
```

Estas funciones guardan los valores en
`PropertiesService.getScriptProperties()`, **fuera del control de
versiones**. Nunca van en el repo ni en `appsscript.json`.

De paso, corre también `probarNotificacionError` una vez para autorizar el
permiso de envío de correo (`script.send_mail`) y confirmar que la cuenta
que va a tener desplegado el portal (`executeAs: USER_DEPLOYING`, ver
[appsscript.json](src/appsscript.json)) puede mandar los correos
transaccionales del portal.

La primera vez que ejecutes cualquiera de estas funciones desde el editor,
Google te va a pedir autorizar los scopes declarados en `appsscript.json`
(`script.external_request`, `drive`, `script.send_mail`) — acéptalos con la
cuenta que vas a usar para desplegar.

### 7.8 Desplegar

```bash
npm run deploy
```

Este comando (definido en [package.json](package.json)) hace
`push:force` + `clasp deploy -i <deploymentId pinned>`. **Nunca** corras
`clasp deploy` sin `-i`, ni le cambies el ID pinned en `package.json` — eso
crearía un deployment nuevo con una URL `/exec` distinta a la que ya usan
los clientes, en vez de actualizar el existente. Si necesitas el deployment
ID de referencia, está documentado en [CLAUDE.md](CLAUDE.md).

La URL pública a compartir con los clientes es la que termina en `/exec` del
deployment pinned — no cambia entre despliegues.

### 7.9 Verificar que todo quedó bien

1. Abre la URL `/exec` del deployment: debe cargar el portal con las dos
   pestañas ("Nueva garantía" / "Consultar garantía").
2. Crea una garantía de prueba con un NIT real de `CLIENTES (COMERCIAL)`.
3. Verifica en Notion que la fila se creó en `GARANTÍAS`, con `GESTIONAR
   GARANTIA` apuntando a `?page=gestionar&id=...`.
4. Abre ese link de gestión y confirma que carga el panel interno.
5. Revisa que llegaron los correos esperados (confirmación al cliente,
   aviso al equipo en `CORREOS_EQUIPO_NUEVA_GARANTIA` de
   [CorreoGestion.js](src/CorreoGestion.js)).

## 8. Desarrollo día a día

```bash
npm run push        # sube cambios de src/ (sin --force, falla si hay conflicto remoto)
npm run push:force   # sube cambios de src/ forzando sobrescritura
npm run pull         # trae cambios hechos directamente en el editor web de Apps Script
npm run open          # abre el proyecto en el editor de Apps Script
npm run deploy         # push:force + clasp deploy al deployment pinned (ver sección 7.8)
npm run versions       # lista versiones desplegadas del proyecto de Apps Script
npm run logs            # clasp logs --simplified (para depurar ejecuciones recientes)
```

Notas:

- No hay build step, ni bundler, ni tests automatizados: los cambios en
  `src/*.js` / `src/*.html` se prueban subiéndolos y usando el portal
  directamente (o el panel de gestión).
- `clasp run <function>` **no funciona** en este proyecto (`NOT_FOUND`, no
  está configurado como API executable) — cualquier función que solo deba
  correrse manualmente (`configurarCredenciales*`, `probarNotificacionError`)
  se ejecuta desde el editor web, nunca desde la CLI.
- Para probar interacción real en navegador (formularios, adjuntos, flujo
  completo) usa el MCP de Playwright ya configurado (`.mcp.json`) — pero
  solo cuando lo pidas explícitamente si estás trabajando con Claude Code
  (ver sección 6).

## 9. Convenciones de código

- **Funciones "privadas"** (no expuestas a `google.script.run`) terminan en
  `_` (ej. `notionRequest_`, `crearCarpetaGarantia_`). Es solo convención de
  Apps Script para documentar intención, no cambia el comportamiento.
- **Toda función pública** que expone `Code.js` devuelve
  `{ ok: true, ... }` o `{ ok: false, error: '...' }`, nunca lanza al
  cliente — así el frontend no necesita `try/catch` alrededor de
  `google.script.run`.
- **Validación en dos capas**: el frontend valida para dar buena UX, pero
  cada función del backend **revalida** lo mismo (NIT, orden de trabajo,
  personal asignado, adjuntos) por defensa en profundidad — nunca confíes
  solo en lo que ya filtró el navegador.
- **Nada debe bloquear la creación/actualización ya confirmada en Notion**:
  si un correo o la subida a Drive fallan después de que la garantía ya
  quedó guardada, se captura el error, se notifica al equipo técnico
  (`notificarErrorPorCorreo_`) y se sigue — el cliente ya tiene su número de
  ticket.
- Errores no controlados en cualquier punto de entrada terminan en un
  correo automático al equipo técnico vía
  [`notificarErrorPorCorreo_`](src/Errores.js), con el stack trace completo
  (el runtime V8 de Apps Script ya incluye función y línea exactas).

## 10. Modelo de seguridad

- El portal público es **anónimo** (`access: ANYONE_ANONYMOUS` en
  `appsscript.json`) y corre con los permisos de quien lo desplegó
  (`executeAs: USER_DEPLOYING`) — ningún visitante necesita ni usa
  credenciales propias; toda llamada a Notion/Drive se hace con las
  credenciales guardadas por quien desplegó.
- La identidad del cliente se valida por **NIT/CC + número de garantía**
  (ambos, para consultar), y por **NIT/CC** contra `CLIENTES (COMERCIAL)`
  (para crear).
- El **panel de gestión no tiene login**: su única protección es que la URL
  incluye el `pageId` real de Notion como token de acceso, generado y
  guardado por el propio portal al crear la garantía, y **nunca mostrado al
  cliente** en ninguna vista pública. No lo compartas fuera del equipo ni lo
  loguees en sitios expuestos.

## 11. Limitación conocida: "PWA" en Apps Script

Apps Script sirve el HTML dentro de un `<iframe>` en un dominio
`googleusercontent.com`, distinto del dominio superior del `/exec`. Por eso
un `manifest.json` + service worker reales (instalación nativa, caché
offline garantizada) **no son 100% confiables** en este hosting — es una
limitación de la plataforma, no del código. Aun así el portal:

- Es totalmente responsive y usable como app desde el navegador móvil.
- Sirve un manifest best-effort en `?page=manifest`
  (ver `construirManifest_()` en [Code.js](src/Code.js)).
- Si más adelante se necesita una PWA instalable garantizada con caché
  offline, la opción es separar el frontend a un hosting estático que
  consuma este Apps Script como API.

## 12. Troubleshooting

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `Faltan las credenciales de Notion` | No se corrió `configurarCredenciales(...)` en este proyecto de Apps Script | Repetir el paso 7.7 desde el editor |
| El desplegable de órdenes de trabajo sale vacío | Normal si `ORDEN DE TRABAJO` no está configurada, o si esa OT no tiene la relación a `CLIENTES (COMERCIAL)` diligenciada en Notion | No bloquea el flujo, el campo es opcional |
| `clasp run <función>` da `NOT_FOUND` | El proyecto no está configurado como API executable | Ejecuta la función desde `script.google.com` (editor web), no desde la CLI |
| `clasp deploy` crea una URL `/exec` nueva | Se corrió sin `-i <deploymentId>` | Usa siempre `npm run deploy`; si ya pasó, hay que hacer `clasp undeploy` del deployment sobrante |
| No llegan correos | Falta autorizar `script.send_mail` con la cuenta `USER_DEPLOYING`, o hay que revocar y volver a autorizar permisos | Corre `probarNotificacionError` desde el editor; si ya habías autorizado Drive con la misma cuenta, revoca el acceso en [myaccount.google.com/permissions](https://myaccount.google.com/permissions) y vuelve a correrla |
| Error de Drive tipo "permisos" al subir adjuntos | La carpeta raíz vive en una Shared Drive y falta `supportsAllDrives=true`, o el scope `drive` no quedó autorizado | Ver comentario completo en [Drive.js](src/Drive.js); revisar `oauthScopes` en `appsscript.json` |
| `npm run push` falla por conflicto | Hay cambios hechos directamente en el editor web que no están en el repo local | `npm run pull` primero, revisar el diff, y luego volver a subir |
#   a u t o m a t i z a c i o n - g a r a n t i a s  
 