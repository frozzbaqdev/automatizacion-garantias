/**
 * Integración con la base de Notion "ORDEN DE TRABAJO" (listado de OT
 * asociadas a un cliente, para vincularlas a una garantía nueva).
 *
 * Esquema verificado el 2026-09-07 vía GET /v1/databases/{id}. Columnas
 * relevantes para el portal:
 *   - CLIENTES (COMERCIAL): Relation hacia CLIENTES (COMERCIAL) — la misma
 *     base que usa Clientes.js. Es como se filtran las OT de un cliente.
 *   - OT: Formula (string), ej. "OT26-00103". Es el número legible de la
 *     orden de trabajo.
 *   - Servicio: Title. Descripción corta del servicio (puede venir vacía).
 *   - Estado actual: Status.
 *
 * IMPORTANTE: la relación CLIENTES (COMERCIAL) no está diligenciada en
 * todas las OT (algunas la tienen, muchas no todavía), así que el
 * desplegable puede salir vacío para clientes cuyas OT aún no fueron
 * vinculadas desde Notion. Por eso este campo es opcional en el formulario
 * de crear garantía (ver Index.html / JavaScript.html) y nunca bloquea la
 * creación.
 *
 * getNotionOrdenTrabajoConfig_() sigue leyendo el databaseId de Script
 * Properties (mismo patrón que NOTION_CLIENTES_DATABASE_ID) — hay que
 * ejecutar UNA vez desde el editor de Apps Script:
 *   configurarCredencialesOrdenTrabajo('<databaseId de ORDEN DE TRABAJO>')
 */

var OT_PROP = {
  CLIENTE: 'CLIENTES (COMERCIAL)',
  NUMERO: 'OT',
  SERVICIO: 'Servicio',
  ESTADO: 'Estado actual'
};

function getNotionOrdenTrabajoConfig_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('NOTION_TOKEN');
  var databaseId = props.getProperty('NOTION_ORDEN_TRABAJO_DATABASE_ID');
  if (!token || !databaseId) return null;
  return { token: token, databaseId: databaseId };
}

/**
 * Ejecutar UNA sola vez desde el editor de Apps Script (no está expuesta al
 * portal público), igual que configurarCredencialesClientes(), cuando ya se
 * haya compartido la base ORDEN DE TRABAJO con la integración desde Notion
 * (··· → Connections) y se tenga su databaseId.
 */
function configurarCredencialesOrdenTrabajo(databaseId) {
  PropertiesService.getScriptProperties().setProperty('NOTION_ORDEN_TRABAJO_DATABASE_ID', databaseId);
}

/**
 * Lista todas las órdenes de trabajo cuya relación CLIENTES (COMERCIAL)
 * incluya al cliente dado (pageId de CLIENTES), para que el usuario elija
 * cuál asociar a la garantía que va a crear.
 */
function notionListarOrdenesTrabajoPorCliente_(clientePageId) {
  var config = getNotionOrdenTrabajoConfig_();
  if (!config) {
    return { ok: false, error: 'La consulta de órdenes de trabajo aún no está configurada. Contacta al equipo de Frozz Colombia.' };
  }

  clientePageId = String(clientePageId || '').trim();
  if (!clientePageId) {
    return { ok: false, error: 'Falta el cliente para buscar sus órdenes de trabajo.' };
  }

  var ordenes = [];
  var cursor = null;
  do {
    var payload = {
      filter: {
        property: OT_PROP.CLIENTE,
        relation: { contains: clientePageId }
      },
      page_size: 100
    };
    if (cursor) payload.start_cursor = cursor;

    var body = notionFetch_('/databases/' + config.databaseId + '/query', 'post', payload, config.token);
    var paginas = body.results || [];

    for (var i = 0; i < paginas.length; i++) {
      var p = paginas[i].properties;
      ordenes.push({
        pageId: paginas[i].id,
        numero: leerFormula_(p[OT_PROP.NUMERO]),
        servicio: leerTexto_(p[OT_PROP.SERVICIO]),
        estado: leerStatus_(p[OT_PROP.ESTADO])
      });
    }

    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);

  return { ok: true, ordenes: ordenes };
}

/**
 * Obtiene el número legible (OT_PROP.NUMERO, ej. "OT26-00103") de una orden
 * de trabajo puntual a partir de su pageId, para mostrarlo en el resultado
 * de consulta de una garantía (ver buscarTicketPorId en Code.js). Devuelve
 * '' si la base de OT no está configurada o si la página no se pudo leer,
 * para no bloquear la consulta de la garantía por esto.
 */
function notionObtenerNumeroOrdenTrabajo_(pageId) {
  var config = getNotionOrdenTrabajoConfig_();
  if (!config || !pageId) return '';

  try {
    var pagina = notionFetch_('/pages/' + pageId, 'get', null, config.token);
    return leerFormula_(pagina.properties[OT_PROP.NUMERO]);
  } catch (err) {
    return '';
  }
}
