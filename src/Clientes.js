/**
 * Integración con la base de Notion "CLIENTES (COMERCIAL)" (búsqueda de
 * empresa por NIT/documento).
 *
 * Acceso confirmado el 2026-09-04 vía POST /v1/search: la integración ve
 * databaseId 268ca234-1407-8057-a4ee-e51de6b2d55a, esquema verificado con
 * GET /v1/databases/{id}:
 *   - NOMBRE DE CLIENTE: title
 *   - #DOCUMENTO: rich_text (puede venir con puntos/guiones, ver limpiarNit_)
 *   - TIPO DE DOCUMENTO: select (NIT / CC)
 *   - TELÉFONO, CORREO, CONTACTO PRINCIPAL, UBICACIÓN, CIUDAD, CLIENTE_STATUS
 *
 * GARANTÍAS ya tiene su propiedad CLIENTE como relation real hacia esta base
 * (antes se guardaba como texto en la descripción; ver notionCrearTicket en
 * Notion.js).
 *
 * getNotionClientesConfig_() sigue leyendo el databaseId de Script
 * Properties (mismo patrón que NOTION_DATABASE_ID) — hay que ejecutar UNA
 * vez desde el editor de Apps Script:
 *   configurarCredencialesClientes('268ca234-1407-8057-a4ee-e51de6b2d55a')
 */

var CLIENTES_PROP = {
  DOCUMENTO: '#DOCUMENTO',
  TIPO_DOCUMENTO: 'TIPO DE DOCUMENTO',
  EMPRESA: 'NOMBRE DE CLIENTE'
};

var TIPO_DOCUMENTO_OPCIONES = ['NIT', 'CC'];

function getNotionClientesConfig_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('NOTION_TOKEN');
  var databaseId = props.getProperty('NOTION_CLIENTES_DATABASE_ID');
  if (!token || !databaseId) return null;
  return { token: token, databaseId: databaseId };
}

/**
 * Ejecutar UNA sola vez desde el editor de Apps Script (no está expuesta al
 * portal público), igual que configurarCredenciales(), cuando ya se haya
 * compartido la base CLIENTES con la integración desde Notion
 * (··· → Connections) y se tenga su databaseId.
 */
function configurarCredencialesClientes(databaseId) {
  PropertiesService.getScriptProperties().setProperty('NOTION_CLIENTES_DATABASE_ID', databaseId);
}

/**
 * Deja solo los dígitos de un NIT/documento, sin importar si viene con
 * puntos, guiones, espacios o dígito de verificación separado
 * (ej. "901.287.786-55" y "90128778655" comparan igual).
 */
function limpiarNit_(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function leerValorPropiedad_(propiedad) {
  if (!propiedad) return '';
  switch (propiedad.type) {
    case 'title':
    case 'rich_text':
      return leerTexto_(propiedad);
    case 'number':
      return (propiedad.number === null || propiedad.number === undefined) ? '' : String(propiedad.number);
    case 'phone_number':
      return leerTelefono_(propiedad);
    case 'select':
      return leerSelect_(propiedad);
    default:
      return '';
  }
}

/**
 * Busca en CLIENTES una fila cuyo DOCUMENTO, limpio de puntos/guiones/
 * espacios, coincida con el documento buscado. Se recorre toda la base
 * página por página porque Notion no permite filtrar "ignorando formato"
 * del lado del servidor (el DOCUMENTO puede venir con o sin puntos según
 * cómo lo haya digitado cada quien).
 *
 * tipoDocumento es opcional: cuando se envía (NIT / CC, ver
 * TIPO_DOCUMENTO_OPCIONES), también debe coincidir con la columna
 * "TIPO DE DOCUMENTO" del cliente, para no confundir un NIT y una cédula
 * que compartan la misma secuencia de dígitos.
 */
// El formulario de creación llama a esta función dos veces para el mismo
// documento: una vez al "Verificar empresa" y otra como defensa en
// profundidad dentro de crearTicketInterno_ (Code.js). Cada llamada, si no
// hay match temprano, puede recorrer toda la base CLIENTES página por
// página — con la base creciendo, eso duplica el costo por cada garantía
// creada y es la causa principal de la lentitud reportada al crear. Se
// cachea el resultado (positivo) por documento+tipo unos minutos para que
// la segunda llamada de la misma sesión no vuelva a escanear la base.
var CLIENTES_CACHE_SEGUNDOS = 300;

function notionBuscarClientePorNit_(nitBuscado, tipoDocumento) {
  var config = getNotionClientesConfig_();
  if (!config) {
    return { ok: false, error: 'La verificación de clientes por NIT aún no está configurada. Contacta al equipo de Frozz Colombia.' };
  }

  var nitLimpio = limpiarNit_(nitBuscado);
  if (!nitLimpio) {
    return { ok: false, error: 'Ingresa un NIT o número de documento válido.' };
  }

  var tipoDocumentoLimpio = String(tipoDocumento || '').trim().toUpperCase();
  if (tipoDocumentoLimpio && TIPO_DOCUMENTO_OPCIONES.indexOf(tipoDocumentoLimpio) === -1) {
    return { ok: false, error: 'Selecciona un tipo de documento válido.' };
  }

  var cache = CacheService.getScriptCache();
  var claveCache = 'cliente_' + tipoDocumentoLimpio + '_' + nitLimpio;
  var clienteEnCache = cache.get(claveCache);
  if (clienteEnCache) {
    return { ok: true, cliente: JSON.parse(clienteEnCache) };
  }

  var cursor = null;
  do {
    var payload = { page_size: 100 };
    if (cursor) payload.start_cursor = cursor;

    var body = notionFetch_('/databases/' + config.databaseId + '/query', 'post', payload, config.token);
    var paginas = body.results || [];

    for (var i = 0; i < paginas.length; i++) {
      var p = paginas[i].properties;
      var documento = leerValorPropiedad_(p[CLIENTES_PROP.DOCUMENTO]);
      var tipoDocumentoCliente = leerValorPropiedad_(p[CLIENTES_PROP.TIPO_DOCUMENTO]);
      var coincideDocumento = limpiarNit_(documento) === nitLimpio;
      var coincideTipo = !tipoDocumentoLimpio || tipoDocumentoCliente.toUpperCase() === tipoDocumentoLimpio;
      if (coincideDocumento && coincideTipo) {
        var cliente = {
          pageId: paginas[i].id,
          nit: nitLimpio,
          tipoDocumento: tipoDocumentoCliente,
          empresa: leerValorPropiedad_(p[CLIENTES_PROP.EMPRESA])
        };
        cache.put(claveCache, JSON.stringify(cliente), CLIENTES_CACHE_SEGUNDOS);
        return { ok: true, cliente: cliente };
      }
    }

    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);

  return { ok: false, error: 'El tipo de documento o número ingresado no están registrados en la base de datos de Frozz Colombia. Para mayor información comunícate a la siguiente casilla: servicioalcliente@frozzcolombia.com' };
}

/**
 * Lee un cliente directamente por su pageId (ya conocido, ej. el que trae
 * CLIENTE en una garantía), para el panel de gestión (ver
 * GestionGarantia.js). A diferencia de notionBuscarClientePorNit_, no
 * recorre toda la base: es un GET directo a la página. Devuelve null si
 * falla o si la base de CLIENTES no está configurada, para no bloquear la
 * carga del panel por esto.
 */
function notionObtenerClientePorPageId_(pageId) {
  var config = getNotionClientesConfig_();
  if (!config || !pageId) return null;
  try {
    var pagina = notionFetch_('/pages/' + pageId, 'get', null, config.token);
    var p = pagina.properties;
    return {
      pageId: pagina.id,
      nit: leerValorPropiedad_(p[CLIENTES_PROP.DOCUMENTO]),
      tipoDocumento: leerValorPropiedad_(p[CLIENTES_PROP.TIPO_DOCUMENTO]),
      empresa: leerValorPropiedad_(p[CLIENTES_PROP.EMPRESA])
    };
  } catch (err) {
    return null;
  }
}
