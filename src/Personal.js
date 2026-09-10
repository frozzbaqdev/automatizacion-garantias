/**
 * Integración con la base de Notion "PERSONAL ACTIVO" (líder responsable y
 * operario responsable que se asignan a una garantía desde el panel interno
 * de gestión, ver Gestionar.html / GestionGarantia.js).
 *
 * Esquema verificado el 2026-09-10 vía GET /v1/databases/{id}:
 *   - Nombre: Title.
 *   - ESTADO: Select (Vinculado / Desvinculado / En progreso). Solo se
 *     listan personas con ESTADO = "Vinculado" (activas).
 *   - Correo corporativo: Email. No todo el personal lo tiene diligenciado
 *     — cuando falta para el líder responsable asignado, el panel de
 *     gestión pide un correo manual (ver GestionGarantia.js /
 *     Gestionar.html) que se guarda en GARANTIAS.CORREO LIDER RESPONSABLE.
 *
 * getNotionPersonalConfig_() sigue leyendo el databaseId de Script
 * Properties (mismo patrón que NOTION_CLIENTES_DATABASE_ID) — hay que
 * ejecutar UNA vez desde el editor de Apps Script:
 *   configurarCredencialesPersonal('<databaseId de PERSONAL ACTIVO>')
 */

var PERSONAL_PROP = {
  NOMBRE: 'Nombre',
  ESTADO: 'ESTADO',
  CORREO: 'Correo corporativo'
};

var PERSONAL_ESTADO_ACTIVO = 'Vinculado';

function getNotionPersonalConfig_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('NOTION_TOKEN');
  var databaseId = props.getProperty('NOTION_PERSONAL_DATABASE_ID');
  if (!token || !databaseId) return null;
  return { token: token, databaseId: databaseId };
}

/**
 * Ejecutar UNA sola vez desde el editor de Apps Script (no está expuesta al
 * portal público), igual que configurarCredencialesClientes(), cuando ya se
 * haya compartido la base PERSONAL ACTIVO con la integración desde Notion
 * (··· → Connections) y se tenga su databaseId.
 */
function configurarCredencialesPersonal(databaseId) {
  PropertiesService.getScriptProperties().setProperty('NOTION_PERSONAL_DATABASE_ID', databaseId);
}

/**
 * Lista el personal activo (ESTADO = "Vinculado") para poblar los
 * desplegables de líder/operario responsable en el panel de gestión.
 * Devuelve un arreglo plano [{ pageId, nombre }], nunca lanza: si la base
 * no está configurada o la consulta falla, devuelve un arreglo vacío para
 * no bloquear la carga del panel por esto (el llamador decide qué mostrar).
 */
function notionListarPersonalActivo_() {
  var config = getNotionPersonalConfig_();
  if (!config) return [];

  var personal = [];
  var cursor = null;
  try {
    do {
      var payload = {
        filter: {
          property: PERSONAL_PROP.ESTADO,
          select: { equals: PERSONAL_ESTADO_ACTIVO }
        },
        page_size: 100
      };
      if (cursor) payload.start_cursor = cursor;

      var body = notionFetch_('/databases/' + config.databaseId + '/query', 'post', payload, config.token);
      var paginas = body.results || [];

      for (var i = 0; i < paginas.length; i++) {
        var p = paginas[i].properties;
        var nombre = leerTexto_(p[PERSONAL_PROP.NOMBRE]).trim();
        if (!nombre) continue;
        personal.push({ pageId: paginas[i].id, nombre: nombre, correo: leerCorreo_(p[PERSONAL_PROP.CORREO]) });
      }

      cursor = body.has_more ? body.next_cursor : null;
    } while (cursor);
  } catch (err) {
    return [];
  }

  personal.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  return personal;
}

/**
 * Obtiene el nombre de una persona a partir de su pageId (ya asignada como
 * líder u operario responsable), para mostrarlo en el panel de gestión.
 * Devuelve '' si falla, mismo patrón defensivo que
 * notionObtenerNumeroOrdenTrabajo_ en OrdenTrabajo.js.
 */
function notionObtenerNombrePersonal_(pageId) {
  var config = getNotionPersonalConfig_();
  if (!config || !pageId) return '';

  try {
    var pagina = notionFetch_('/pages/' + pageId, 'get', null, config.token);
    return leerTexto_(pagina.properties[PERSONAL_PROP.NOMBRE]);
  } catch (err) {
    return '';
  }
}

/**
 * Igual que notionObtenerNombrePersonal_, pero para el correo corporativo
 * registrado en PERSONAL ACTIVO (puede venir vacío si no se ha diligenciado
 * para esa persona). Lo usa notionObtenerGarantiaPorPageId_ (GestionGarantia.js)
 * para resolver a qué correo enviarle el aviso de asignación al líder
 * responsable, con el correo manual de GARANTIAS.CORREO LIDER RESPONSABLE
 * como respaldo cuando esto devuelve ''.
 */
function notionObtenerCorreoPersonal_(pageId) {
  var config = getNotionPersonalConfig_();
  if (!config || !pageId) return '';

  try {
    var pagina = notionFetch_('/pages/' + pageId, 'get', null, config.token);
    return leerCorreo_(pagina.properties[PERSONAL_PROP.CORREO]);
  } catch (err) {
    return '';
  }
}
