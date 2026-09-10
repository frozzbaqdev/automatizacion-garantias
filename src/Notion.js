/**
 * Capa de integración con la API de Notion.
 *
 * Tipos reales verificados contra la base "GARANTÍAS" (2026-09-03):
 *   - ID: Unique ID, prefijo "GAR" (autogenerado por Notion, ya no se usa
 *     como número de garantía visible para el cliente, ver #GARANTIA)
 *   - #GARANTIA: Title (es la propiedad título de esta base). Número de
 *     garantía real que ve el cliente,
 *     generado por el portal (no por Notion) con el formato "GARF" + 6
 *     dígitos aleatorios (ver generarNumeroGarantiaUnico_). Antes de crear
 *     cada ticket se verifica que ese número no exista ya en la base, para
 *     no repetirlo. El cliente consulta su garantía con este número, no con
 *     el ID.
 *   - FECHA CREACION SOLICITUD: Date (antes "FECHA", renombrada 2026-09-07;
 *     se sigue usando igual: fecha de creación del ticket)
 *   - FECHA ESTIMADA DE ENTREGA: Date. La ingresa el equipo de Frozz en el
 *     panel de gestión (tarjeta "Asignación", ver Gestionar.html), no el
 *     portal público. Opcional.
 *   - FECHA CIERRE SOLICITUD: Date. Se setea sola (nunca la llena una
 *     persona) al rechazar o finalizar una garantía, ver GestionGarantia.js.
 *   - PRIORIDAD: Select (Baja/Media/Alta/Urgente)
 *   - ESTADO: Status (Sin empezar/En curso/Listo)
 *   - ETAPA: Select (las 5 etapas del flujo: Revisión inicial, Diagnóstico,
 *     Aprobación, En ejecución, Finalizada — verificado el 2026-09-07)
 *   - MOTIVO: Multi-select (FALLA DE EQUIPO / FALLA POR PARTE DE CLIENTE / ERROR HUMANO)
 *   - DESCRIPCIÓN GENERAL: Rich text
 *   - PLAN DE ACCION: URL
 *   - NOMBRE/TELEFONO/CORREO REPRESENTANTE CLIENTE: Rich text / Phone / Email
 *   - CLIENTE: Relation real hacia CLIENTES (COMERCIAL) (acceso confirmado
 *     2026-09-04). Se guarda como { relation: [{ id: pageId }] }, con el
 *     pageId que devuelve notionBuscarClientePorNit_() en Clientes.js tras
 *     validar el NIT ingresado por el cliente.
 *   - ORDEN DE TRABAJO: Relation hacia ORDEN DE TRABAJO (ver OrdenTrabajo.js).
 *     Opcional: solo se envía si el usuario eligió una OT de la lista que
 *     se le muestra tras verificar su empresa.
 *   - LIDER RESPONSABLE, OPERARIO RESPONSABLE: Relation (a la base
 *     PERSONAL ACTIVO). El portal nunca los llena — quedan vacíos a
 *     propósito para que el equipo de Frozz los asigne directamente en
 *     Notion.
 */

var NOTION_VERSION = '2022-06-28';
var NOTION_API_BASE = 'https://api.notion.com/v1';

var PROP = {
  NUMERO_GARANTIA: '#GARANTIA',
  FECHA: 'FECHA CREACION SOLICITUD',
  FECHA_ESTIMADA_ENTREGA: 'FECHA ESTIMADA DE ENTREGA',
  FECHA_CIERRE: 'FECHA CIERRE SOLICITUD',
  PRIORIDAD: 'PRIORIDAD',
  ESTADO: 'ESTADO',
  ETAPA: 'ETAPA',
  CLIENTE: 'CLIENTE',
  ORDEN_TRABAJO: 'ORDEN DE TRABAJO',
  LIDER: 'LIDER RESPONSABLE',
  OPERARIO: 'OPERARIO RESPONSABLE',
  MOTIVO: 'MOTIVO',
  DESCRIPCION: 'DESCRIPCIÓN GENERAL',
  PLAN_ACCION: 'PLAN DE ACCION',
  DOCUMENTOS_SOPORTE: 'DOCUMENTOS SOPORTE',
  COMENTARIOS: 'COMENTARIOS',
  APROBACION: 'APROBACION GARANTIA',
  GESTIONAR: 'GESTIONAR GARANTIA',
  NOMBRE_CONTACTO: 'NOMBRE REPRESENTANTE CLIENTE',
  TELEFONO_CONTACTO: 'TELEFONO REPRESENTANTE CLIENTE',
  CORREO_CONTACTO: 'CORREO REPRESENTANTE CLIENTE',
  // Correo manual del líder responsable, solo se llena desde el panel de
  // gestión cuando ese líder no tiene "Correo corporativo" en PERSONAL
  // ACTIVO (ver notionIniciarGestionGarantia_ / notionGuardarAsignacionGarantia_
  // en GestionGarantia.js).
  CORREO_LIDER: 'CORREO LIDER RESPONSABLE'
};

var ETAPAS_ORDEN = [
  'Revisión inicial',
  'Diagnóstico',
  'Aprobación',
  'En ejecución',
  'Finalizada'
];

var MOTIVO_OPCIONES = [
  'FALLA DE EQUIPO',
  'FALLA POR PARTE DE CLIENTE',
  'ERROR HUMANO'
];

function getNotionConfig_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('NOTION_TOKEN');
  var databaseId = props.getProperty('NOTION_DATABASE_ID');
  if (!token || !databaseId) {
    throw new Error(
      'Faltan las credenciales de Notion. Ejecuta configurarCredenciales(token, databaseId) ' +
      'una vez desde el editor de Apps Script.'
    );
  }
  return { token: token, databaseId: databaseId };
}

function notionHeaders_(token) {
  return {
    Authorization: 'Bearer ' + token,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

/**
 * Llamada de bajo nivel a la API de Notion con un token explícito, para que
 * capas distintas de GARANTÍAS (ej. Clientes.js, que usa otra base) puedan
 * reutilizarla sin depender del databaseId de este archivo.
 */
function notionFetch_(path, method, payload, token) {
  var options = {
    method: method,
    headers: notionHeaders_(token),
    muteHttpExceptions: true
  };
  if (payload) {
    options.payload = JSON.stringify(payload);
  }
  var response = UrlFetchApp.fetch(NOTION_API_BASE + path, options);
  var code = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    body = {};
  }
  if (code < 200 || code >= 300) {
    var mensaje = (body && body.message) ? body.message : ('Error de Notion (' + code + ')');
    throw new Error(mensaje);
  }
  return body;
}

function notionRequest_(path, method, payload) {
  var config = getNotionConfig_();
  var body = notionFetch_(path, method, payload, config.token);
  return { body: body, databaseId: config.databaseId };
}

function rt_(texto) {
  return { rich_text: [{ text: { content: String(texto || '') } }] };
}

function title_(texto) {
  return { title: [{ text: { content: String(texto || '') } }] };
}

function sel_(nombre) {
  return { select: { name: nombre } };
}

function multiSel_(nombres) {
  var lista = Array.isArray(nombres) ? nombres : [nombres];
  return { multi_select: lista.map(function (n) { return { name: n }; }) };
}

function status_(nombre) {
  return { status: { name: nombre } };
}

function date_(isoDate) {
  return { date: { start: isoDate } };
}

function tel_(valor) {
  return { phone_number: String(valor || '') };
}

function email_(valor) {
  return { email: String(valor || '') };
}

function leerTexto_(propiedad) {
  if (!propiedad) return '';
  if (propiedad.rich_text) {
    return propiedad.rich_text.map(function (t) { return t.plain_text; }).join('');
  }
  if (propiedad.title) {
    return propiedad.title.map(function (t) { return t.plain_text; }).join('');
  }
  return '';
}

function leerSelect_(propiedad) {
  return (propiedad && propiedad.select) ? propiedad.select.name : '';
}

function leerStatus_(propiedad) {
  return (propiedad && propiedad.status) ? propiedad.status.name : '';
}

function leerFecha_(propiedad) {
  return (propiedad && propiedad.date) ? propiedad.date.start : '';
}

function leerMultiSelect_(propiedad) {
  if (!propiedad || !propiedad.multi_select) return '';
  return propiedad.multi_select.map(function (o) { return o.name; }).join(', ');
}

function leerUrl_(propiedad) {
  return (propiedad && propiedad.url) ? propiedad.url : '';
}

function leerTelefono_(propiedad) {
  return (propiedad && propiedad.phone_number) ? propiedad.phone_number : '';
}

function leerCorreo_(propiedad) {
  return (propiedad && propiedad.email) ? propiedad.email : '';
}

function leerFormula_(propiedad) {
  if (!propiedad || !propiedad.formula) return '';
  var f = propiedad.formula;
  if (f.type === 'string') return f.string || '';
  if (f.type === 'number') return (f.number === null || f.number === undefined) ? '' : String(f.number);
  return '';
}

/**
 * Genera un número de garantía con el formato "GARF" + 6 dígitos
 * aleatorios (cada dígito independiente, admite ceros a la izquierda).
 */
function generarNumeroGarantia_() {
  var digitos = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return 'GARF' + digitos;
}

function notionNumeroGarantiaExiste_(numero) {
  var filtro = {
    filter: {
      property: PROP.NUMERO_GARANTIA,
      title: { equals: numero }
    },
    page_size: 1
  };
  var resultado = notionRequest_('/databases/' + getNotionConfig_().databaseId + '/query', 'post', filtro);
  return (resultado.body.results || []).length > 0;
}

/**
 * Genera un número de garantía verificando contra la base GARANTÍAS que no
 * exista ya (columna #GARANTIA), para no crear dos tickets con el mismo
 * número. Con 6 dígitos aleatorios (un millón de combinaciones) una
 * colisión es muy poco probable, pero se revalida igual antes de crear.
 */
function generarNumeroGarantiaUnico_() {
  var intentosMaximos = 10;
  for (var i = 0; i < intentosMaximos; i++) {
    var numero = generarNumeroGarantia_();
    if (!notionNumeroGarantiaExiste_(numero)) {
      return numero;
    }
  }
  throw new Error('No se pudo generar un número de garantía único. Intenta de nuevo.');
}

/**
 * Normaliza el número de garantía que escribe el cliente para buscarlo
 * (mayúsculas, sin espacios) y valida que tenga el formato "GARF" + 6
 * dígitos. Devuelve '' si no es válido.
 */
function normalizarNumeroGarantia_(numeroBuscado) {
  var limpio = String(numeroBuscado || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^GARF\d{6}$/.test(limpio) ? limpio : '';
}

function relacion_(pageId) {
  return { relation: [{ id: pageId }] };
}

/**
 * Fecha de hoy en zona horaria de Bogotá, formato yyyy-MM-dd (el que espera
 * Notion para una propiedad Date). La reutilizan notionCrearTicket() y las
 * transiciones de cierre en GestionGarantia.js (rechazar/finalizar), para no
 * repetir el mismo Utilities.formatDate en cada sitio.
 */
function fechaHoy_() {
  return Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd');
}

function notionCrearTicket(datos) {
  var hoy = fechaHoy_();
  var numeroGarantia = generarNumeroGarantiaUnico_();

  var properties = {};
  properties[PROP.NUMERO_GARANTIA] = title_(numeroGarantia);
  properties[PROP.FECHA] = date_(hoy);
  properties[PROP.PRIORIDAD] = sel_('Baja');
  properties[PROP.ESTADO] = status_('Sin empezar');
  properties[PROP.ETAPA] = sel_(ETAPAS_ORDEN[0]);
  properties[PROP.CLIENTE] = relacion_(datos.clientePageId);
  if (datos.ordenTrabajoPageId) {
    properties[PROP.ORDEN_TRABAJO] = relacion_(datos.ordenTrabajoPageId);
  }
  properties[PROP.MOTIVO] = multiSel_(datos.motivo);
  properties[PROP.DESCRIPCION] = rt_(datos.descripcionGeneral);
  properties[PROP.NOMBRE_CONTACTO] = rt_(datos.nombreContacto);
  properties[PROP.TELEFONO_CONTACTO] = tel_(datos.telefonoContacto);
  properties[PROP.CORREO_CONTACTO] = email_(datos.correoContacto);
  // LIDER RESPONSABLE y OPERARIO RESPONSABLE se dejan sin enviar a propósito:
  // el equipo de Frozz los asigna directamente en Notion.

  var resultado = notionRequest_('/pages', 'post', {
    parent: { database_id: resultadoDatabaseId_() },
    properties: properties
  });

  return {
    ok: true,
    numero: numeroGarantia,
    pageId: resultado.body.id
  };
}

function resultadoDatabaseId_() {
  return getNotionConfig_().databaseId;
}

/**
 * Wrapper genérico para actualizar propiedades de una página de GARANTÍAS
 * (PATCH /pages/{id}). Lo reutilizan tanto las funciones de abajo como
 * GestionGarantia.js, para no repetir el mismo patch a mano en cada sitio.
 */
function notionActualizarPropiedades_(pageId, properties) {
  notionFetch_('/pages/' + pageId, 'patch', { properties: properties }, getNotionConfig_().token);
}

/**
 * Guarda en DOCUMENTOS SOPORTE (propiedad url) el link de la carpeta de
 * Drive creada para la garantía (ver crearCarpetaGarantia_ en Drive.js).
 * Se llama después de crear el ticket, así que recibe el pageId que ya
 * devolvió notionCrearTicket().
 */
function notionActualizarDocumentosSoporte_(pageId, urlCarpeta) {
  var properties = {};
  properties[PROP.DOCUMENTOS_SOPORTE] = { url: urlCarpeta };
  notionActualizarPropiedades_(pageId, properties);
}

/**
 * Guarda en GESTIONAR GARANTIA (propiedad url) el link al panel interno de
 * gestión (ver Gestionar.html), para que el equipo de Frozz lo encuentre
 * directamente en la fila de Notion. Se llama después de crear el ticket,
 * igual que notionActualizarDocumentosSoporte_.
 */
function notionActualizarLinkGestion_(pageId, urlGestion) {
  var properties = {};
  properties[PROP.GESTIONAR] = { url: urlGestion };
  notionActualizarPropiedades_(pageId, properties);
}

/**
 * Deja un rastro en COMENTARIOS cuando falla la creación de la carpeta de
 * Drive de una garantía, para poder diagnosticar el problema consultando
 * la página en Notion sin necesidad de tener configurado un proyecto de
 * Google Cloud para ver los logs de Apps Script (ver crearTicket en
 * Code.js, que llama a esto solo si crearCarpetaGarantia_ ya falló).
 */
function notionRegistrarErrorDocumentacion_(pageId, mensaje) {
  var properties = {};
  properties[PROP.COMENTARIOS] = rt_('[Error automático] No se pudo crear la carpeta de documentos: ' + mensaje);
  notionActualizarPropiedades_(pageId, properties);
}

/**
 * Devuelve el pageId del primer elemento de una propiedad "relation"
 * (CLIENTE solo debería tener uno, pero Notion siempre entrega un arreglo).
 */
function leerRelacionPrimeraId_(propiedad) {
  if (!propiedad || !propiedad.relation || !propiedad.relation.length) return '';
  return propiedad.relation[0].id;
}

function notionBuscarPorId(numeroBuscado) {
  var numero = normalizarNumeroGarantia_(numeroBuscado);
  if (!numero) {
    return { ok: false, error: 'Ingresa un número de garantía válido.' };
  }

  var filtro = {
    filter: {
      property: PROP.NUMERO_GARANTIA,
      title: { equals: numero }
    },
    page_size: 1
  };

  var resultado = notionRequest_('/databases/' + getNotionConfig_().databaseId + '/query', 'post', filtro);
  var resultados = resultado.body.results || [];
  if (resultados.length === 0) {
    return { ok: false, error: 'No se encontró ninguna garantía con ese número.' };
  }

  var pagina = resultados[0];
  var p = pagina.properties;

  return {
    ok: true,
    ticket: {
      numero: leerTexto_(p[PROP.NUMERO_GARANTIA]),
      fecha: leerFecha_(p[PROP.FECHA]),
      prioridad: leerSelect_(p[PROP.PRIORIDAD]),
      estado: leerStatus_(p[PROP.ESTADO]),
      etapa: leerSelect_(p[PROP.ETAPA]),
      // aprobacionGarantia/comentarios solo se llenan al aprobar o rechazar
      // en el panel de gestión (ver GestionGarantia.js): COMENTARIOS nunca
      // guarda otra cosa, así que es seguro devolverlos siempre y dejar que
      // el frontend decida cuándo mostrarlos (ver renderStepper en
      // JavaScript.html).
      aprobacionGarantia: leerSelect_(p[PROP.APROBACION]),
      comentarios: leerTexto_(p[PROP.COMENTARIOS]),
      clientePageId: leerRelacionPrimeraId_(p[PROP.CLIENTE]),
      ordenTrabajoPageId: leerRelacionPrimeraId_(p[PROP.ORDEN_TRABAJO]),
      motivo: leerMultiSelect_(p[PROP.MOTIVO]),
      descripcionGeneral: leerTexto_(p[PROP.DESCRIPCION]),
      planDeAccion: leerUrl_(p[PROP.PLAN_ACCION]),
      nombreContacto: leerTexto_(p[PROP.NOMBRE_CONTACTO]),
      telefonoContacto: leerTelefono_(p[PROP.TELEFONO_CONTACTO]),
      correoContacto: leerCorreo_(p[PROP.CORREO_CONTACTO])
    }
  };
}
