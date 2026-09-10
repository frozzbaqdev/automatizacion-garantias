/**
 * Lógica de escritura/lectura de Notion para el panel interno de gestión de
 * garantías (ver Gestionar.html / JavaScriptGestion.html). Solo la usa el
 * equipo de Frozz a través del link guardado en GESTIONAR GARANTIA (ver
 * notionActualizarLinkGestion_ en Notion.js), nunca el cliente.
 *
 * Cada acción lee el estado actual de la página (notionObtenerGarantiaPorPageId_)
 * antes de escribir: tanto para validar que la transición de etapa pedida es
 * la que toca (nunca se permite saltar etapas, ver ETAPAS_ORDEN en Notion.js),
 * como para tener a mano los datos de contacto que necesitan los correos de
 * CorreoGestion.js.
 */

var PRIORIDAD_OPCIONES = ['Baja', 'Media', 'Alta', 'Urgente'];

/**
 * Lee una garantía completa por su pageId (GET /pages/{id}), resolviendo
 * además los nombres/números legibles de sus relaciones (cliente, orden de
 * trabajo, líder y operario responsable) para que el panel no tenga que
 * hacer esas consultas por separado. Siempre devuelve { ok: true, ticket }
 * si el pageId existe; si no existe o hay un problema de red, notionFetch_
 * lanza y el llamador (Code.js) lo convierte en { ok: false, error }.
 */
function notionObtenerGarantiaPorPageId_(pageId) {
  var config = getNotionConfig_();
  var pagina = notionFetch_('/pages/' + pageId, 'get', null, config.token);
  var p = pagina.properties;

  var ticket = {
    pageId: pagina.id,
    numero: leerTexto_(p[PROP.NUMERO_GARANTIA]),
    fecha: leerFecha_(p[PROP.FECHA]),
    prioridad: leerSelect_(p[PROP.PRIORIDAD]),
    estado: leerStatus_(p[PROP.ESTADO]),
    etapa: leerSelect_(p[PROP.ETAPA]),
    aprobacionGarantia: leerSelect_(p[PROP.APROBACION]),
    comentarios: leerTexto_(p[PROP.COMENTARIOS]),
    clientePageId: leerRelacionPrimeraId_(p[PROP.CLIENTE]),
    ordenTrabajoPageId: leerRelacionPrimeraId_(p[PROP.ORDEN_TRABAJO]),
    liderPageId: leerRelacionPrimeraId_(p[PROP.LIDER]),
    operarioPageId: leerRelacionPrimeraId_(p[PROP.OPERARIO]),
    motivo: leerMultiSelect_(p[PROP.MOTIVO]),
    descripcionGeneral: leerTexto_(p[PROP.DESCRIPCION]),
    fechaEstimadaEntrega: leerFecha_(p[PROP.FECHA_ESTIMADA_ENTREGA]),
    planDeAccion: leerUrl_(p[PROP.PLAN_ACCION]),
    documentosSoporte: leerUrl_(p[PROP.DOCUMENTOS_SOPORTE]),
    nombreContacto: leerTexto_(p[PROP.NOMBRE_CONTACTO]),
    telefonoContacto: leerTelefono_(p[PROP.TELEFONO_CONTACTO]),
    correoContacto: leerCorreo_(p[PROP.CORREO_CONTACTO]),
    // Correo manual del líder responsable (ver PROP.CORREO_LIDER en
    // Notion.js): solo tiene valor cuando ese líder no tiene "Correo
    // corporativo" en PERSONAL ACTIVO y alguien lo ingresó a mano en el
    // panel de gestión (ver Gestionar.html).
    liderCorreo: leerCorreo_(p[PROP.CORREO_LIDER]),
    clienteEmpresa: '',
    clienteNit: '',
    ordenTrabajo: '',
    liderNombre: '',
    operarioNombre: '',
    // Correo al que de verdad se le debe escribir al líder: el de PERSONAL
    // ACTIVO si lo tiene, o si no el que se guardó a mano arriba (ver
    // enviarCorreoAsignacionLider_ en CorreoGestion.js, llamado desde
    // iniciarGestionGarantia en Code.js).
    liderCorreoEfectivo: ''
  };

  if (ticket.clientePageId) {
    var cliente = notionObtenerClientePorPageId_(ticket.clientePageId);
    if (cliente) {
      ticket.clienteEmpresa = cliente.empresa;
      ticket.clienteNit = cliente.nit;
    }
  }
  if (ticket.ordenTrabajoPageId) {
    ticket.ordenTrabajo = notionObtenerNumeroOrdenTrabajo_(ticket.ordenTrabajoPageId);
  }
  if (ticket.liderPageId) {
    ticket.liderNombre = notionObtenerNombrePersonal_(ticket.liderPageId);
    ticket.liderCorreoEfectivo = notionObtenerCorreoPersonal_(ticket.liderPageId) || ticket.liderCorreo;
  }
  if (ticket.operarioPageId) {
    ticket.operarioNombre = notionObtenerNombrePersonal_(ticket.operarioPageId);
  }

  return { ok: true, ticket: ticket };
}

function notionSiguienteEtapa_(etapaActual) {
  var indice = ETAPAS_ORDEN.indexOf(etapaActual);
  if (indice === -1 || indice >= ETAPAS_ORDEN.length - 1) return '';
  return ETAPAS_ORDEN[indice + 1];
}

/**
 * Valida que liderPageId y operarioPageId sean, ambos, personal activo real
 * (defensa en profundidad: el panel solo ofrece los que ya listó
 * notionListarPersonalActivo_, pero no hay que confiar en el pageId que
 * llega del navegador sin volver a chequearlo, mismo criterio que ya usa
 * crearTicketInterno_ con el NIT/orden de trabajo en Code.js). Recibe
 * `personalActivo` ya cargado (en vez de volver a pedirlo) para que el
 * llamador pueda reutilizar esa misma lista al resolver el correo del
 * líder (ver validarCorreoLider_ más abajo).
 */
function validarPersonalAsignado_(personalActivo, liderPageId, operarioPageId) {
  var idsValidos = personalActivo.map(function (persona) { return persona.pageId; });
  return idsValidos.indexOf(liderPageId) !== -1 && idsValidos.indexOf(operarioPageId) !== -1;
}

/**
 * Si el líder responsable elegido no tiene "Correo corporativo" en PERSONAL
 * ACTIVO, exige y valida un correo manual (datos.liderCorreo) para guardarlo
 * en GARANTIAS.CORREO LIDER RESPONSABLE (ver PROP.CORREO_LIDER en
 * Notion.js) — es el correo al que se le avisará que se le asignó la
 * garantía (ver enviarCorreoAsignacionLider_ en CorreoGestion.js). Si el
 * líder sí tiene correo corporativo, no se toca ese campo de GARANTIAS.
 * Devuelve { ok: true } o { ok: false, error }.
 */
function validarCorreoLider_(personalActivo, liderPageId, liderCorreoManual, properties) {
  var liderInfo = personalActivo.filter(function (persona) { return persona.pageId === liderPageId; })[0];
  if (liderInfo && liderInfo.correo) {
    return { ok: true };
  }

  var correo = String(liderCorreoManual || '').trim();
  if (!correo) {
    return { ok: false, error: 'El líder responsable seleccionado no tiene correo registrado. Ingresa uno para poder notificarle la asignación.' };
  }
  if (!/^\S+@\S+\.\S+$/.test(correo)) {
    return { ok: false, error: 'Ingresa un correo válido para el líder responsable.' };
  }

  properties[PROP.CORREO_LIDER] = email_(correo);
  return { ok: true };
}

/**
 * Primer paso del panel: pide prioridad + líder + operario responsable
 * (+ fecha estimada de entrega y plan de acción, opcionales) y pasa la
 * garantía de "Sin empezar" a "En curso". La ETAPA ya quedó en "Revisión
 * inicial" desde que se creó el ticket (ver notionCrearTicket en
 * Notion.js), así que aquí no se toca.
 */
function notionIniciarGestionGarantia_(pageId, datos) {
  datos = datos || {};
  var prioridad = String(datos.prioridad || '').trim();
  var liderPageId = String(datos.liderPageId || '').trim();
  var operarioPageId = String(datos.operarioPageId || '').trim();
  var fechaEstimadaEntrega = String(datos.fechaEstimadaEntrega || '').trim();
  var planAccionUrl = String(datos.planAccionUrl || '').trim();

  if (PRIORIDAD_OPCIONES.indexOf(prioridad) === -1) {
    return { ok: false, error: 'Selecciona una prioridad válida.' };
  }
  if (!liderPageId || !operarioPageId) {
    return { ok: false, error: 'Selecciona el líder y el operario responsable.' };
  }
  if (!fechaEstimadaEntrega) {
    return { ok: false, error: 'Ingresa la fecha estimada de entrega.' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEstimadaEntrega)) {
    return { ok: false, error: 'La fecha estimada de entrega no es válida.' };
  }
  if (planAccionUrl && !/^https?:\/\//i.test(planAccionUrl)) {
    return { ok: false, error: 'El plan de acción debe ser un link válido (debe empezar con http:// o https://).' };
  }

  var actual = notionObtenerGarantiaPorPageId_(pageId).ticket;
  if (actual.estado !== 'Sin empezar') {
    return { ok: false, error: 'Esta garantía ya fue iniciada.' };
  }

  var personalActivo = notionListarPersonalActivo_();
  if (!validarPersonalAsignado_(personalActivo, liderPageId, operarioPageId)) {
    return { ok: false, error: 'El líder o el operario seleccionado ya no está activo.' };
  }

  var properties = {};
  properties[PROP.ESTADO] = status_('En curso');
  properties[PROP.PRIORIDAD] = sel_(prioridad);
  properties[PROP.LIDER] = relacion_(liderPageId);
  properties[PROP.OPERARIO] = relacion_(operarioPageId);
  properties[PROP.FECHA_ESTIMADA_ENTREGA] = fechaEstimadaEntrega ? date_(fechaEstimadaEntrega) : { date: null };
  properties[PROP.PLAN_ACCION] = { url: planAccionUrl || null };

  var validacionCorreo = validarCorreoLider_(personalActivo, liderPageId, datos.liderCorreo, properties);
  if (!validacionCorreo.ok) {
    return validacionCorreo;
  }

  notionActualizarPropiedades_(pageId, properties);

  return notionObtenerGarantiaPorPageId_(pageId);
}

/**
 * Avanza de "Revisión inicial" a "Diagnóstico", o de "Diagnóstico" a
 * "Aprobación". Nunca permite saltar etapas: etapaDestino tiene que ser
 * exactamente la siguiente en ETAPAS_ORDEN a partir de la etapa actual. El
 * resto de transiciones (entrar/salir de "Aprobación", cerrar en
 * "En ejecución") tienen su propia función porque no son un simple avance.
 */
function notionAvanzarEtapaGarantia_(pageId, etapaDestino) {
  var actual = notionObtenerGarantiaPorPageId_(pageId).ticket;
  if (actual.estado === 'Sin empezar') {
    return { ok: false, error: 'Primero inicia la gestión de esta garantía.' };
  }
  if (actual.estado === 'Listo') {
    return { ok: false, error: 'Esta garantía ya está cerrada.' };
  }
  if (['Revisión inicial', 'Diagnóstico'].indexOf(actual.etapa) === -1) {
    return { ok: false, error: 'No se puede avanzar de etapa desde "' + actual.etapa + '" con esta acción.' };
  }

  var siguiente = notionSiguienteEtapa_(actual.etapa);
  if (!siguiente || siguiente !== String(etapaDestino || '').trim()) {
    return { ok: false, error: 'Solo puedes avanzar a la siguiente etapa del flujo.' };
  }

  var properties = {};
  properties[PROP.ETAPA] = sel_(siguiente);
  notionActualizarPropiedades_(pageId, properties);

  return notionObtenerGarantiaPorPageId_(pageId);
}

function notionAprobarGarantia_(pageId, comentario) {
  var texto = String(comentario || '').trim();
  if (!texto) {
    return { ok: false, error: 'Escribe un comentario explicando por qué apruebas esta garantía.' };
  }

  var actual = notionObtenerGarantiaPorPageId_(pageId).ticket;
  if (actual.etapa !== 'Aprobación' || actual.estado !== 'En curso') {
    return { ok: false, error: 'Esta garantía no está en la etapa de aprobación.' };
  }

  var properties = {};
  properties[PROP.ETAPA] = sel_('En ejecución');
  properties[PROP.APROBACION] = sel_('APROBADO');
  properties[PROP.COMENTARIOS] = rt_(texto);
  notionActualizarPropiedades_(pageId, properties);

  var resultado = notionObtenerGarantiaPorPageId_(pageId);
  resultado.ticket.comentarios = texto;
  return resultado;
}

function notionRechazarGarantia_(pageId, comentario) {
  var texto = String(comentario || '').trim();
  if (!texto) {
    return { ok: false, error: 'Escribe un comentario explicando por qué rechazas esta garantía.' };
  }

  var actual = notionObtenerGarantiaPorPageId_(pageId).ticket;
  if (actual.etapa !== 'Aprobación' || actual.estado !== 'En curso') {
    return { ok: false, error: 'Esta garantía no está en la etapa de aprobación.' };
  }

  var properties = {};
  properties[PROP.APROBACION] = sel_('RECHAZADO');
  properties[PROP.COMENTARIOS] = rt_(texto);
  properties[PROP.ESTADO] = status_('Listo');
  properties[PROP.FECHA_CIERRE] = date_(fechaHoy_());
  // ETAPA pasa a "Rechazada" solo para que quede registrado en la base de
  // datos: esta etapa no forma parte de ETAPAS_ORDEN (el flujo visible de
  // 5 pasos), así que el stepper del cliente y el del panel de gestión
  // nunca la muestran (ambos se apoyan en aprobacionGarantia === 'RECHAZADO'
  // para pintar el rechazo en la etapa "Aprobación", que es la única desde
  // la que se puede rechazar).
  properties[PROP.ETAPA] = sel_('Rechazada');
  notionActualizarPropiedades_(pageId, properties);

  var resultado = notionObtenerGarantiaPorPageId_(pageId);
  resultado.ticket.comentarios = texto;
  return resultado;
}

function notionFinalizarGarantia_(pageId) {
  var actual = notionObtenerGarantiaPorPageId_(pageId).ticket;
  if (actual.etapa !== 'En ejecución' || actual.estado !== 'En curso') {
    return { ok: false, error: 'Esta garantía no está en la etapa de ejecución.' };
  }

  var properties = {};
  properties[PROP.ETAPA] = sel_('Finalizada');
  properties[PROP.ESTADO] = status_('Listo');
  properties[PROP.FECHA_CIERRE] = date_(fechaHoy_());
  notionActualizarPropiedades_(pageId, properties);

  return notionObtenerGarantiaPorPageId_(pageId);
}

/**
 * Edita prioridad/líder/operario/plan de acción en cualquier momento
 * después de iniciada la gestión, sin pasar por el flujo de etapas (ver
 * tarjeta "Asignación" en Gestionar.html).
 */
function notionGuardarAsignacionGarantia_(pageId, datos) {
  datos = datos || {};
  var prioridad = String(datos.prioridad || '').trim();
  var liderPageId = String(datos.liderPageId || '').trim();
  var operarioPageId = String(datos.operarioPageId || '').trim();
  var planAccionUrl = String(datos.planAccionUrl || '').trim();
  var fechaEstimadaEntrega = String(datos.fechaEstimadaEntrega || '').trim();

  if (PRIORIDAD_OPCIONES.indexOf(prioridad) === -1) {
    return { ok: false, error: 'Selecciona una prioridad válida.' };
  }
  if (!liderPageId || !operarioPageId) {
    return { ok: false, error: 'Selecciona el líder y el operario responsable.' };
  }
  if (planAccionUrl && !/^https?:\/\//i.test(planAccionUrl)) {
    return { ok: false, error: 'El plan de acción debe ser un link válido (debe empezar con http:// o https://).' };
  }
  if (fechaEstimadaEntrega && !/^\d{4}-\d{2}-\d{2}$/.test(fechaEstimadaEntrega)) {
    return { ok: false, error: 'La fecha estimada de entrega no es válida.' };
  }

  var actual = notionObtenerGarantiaPorPageId_(pageId).ticket;
  if (actual.estado === 'Sin empezar') {
    return { ok: false, error: 'Primero inicia la gestión de esta garantía.' };
  }

  var personalActivo = notionListarPersonalActivo_();
  if (!validarPersonalAsignado_(personalActivo, liderPageId, operarioPageId)) {
    return { ok: false, error: 'El líder o el operario seleccionado ya no está activo.' };
  }

  var properties = {};
  properties[PROP.PRIORIDAD] = sel_(prioridad);
  properties[PROP.LIDER] = relacion_(liderPageId);
  properties[PROP.OPERARIO] = relacion_(operarioPageId);
  properties[PROP.PLAN_ACCION] = { url: planAccionUrl || null };
  properties[PROP.FECHA_ESTIMADA_ENTREGA] = fechaEstimadaEntrega ? date_(fechaEstimadaEntrega) : { date: null };

  var validacionCorreo = validarCorreoLider_(personalActivo, liderPageId, datos.liderCorreo, properties);
  if (!validacionCorreo.ok) {
    return validacionCorreo;
  }

  notionActualizarPropiedades_(pageId, properties);

  return notionObtenerGarantiaPorPageId_(pageId);
}
