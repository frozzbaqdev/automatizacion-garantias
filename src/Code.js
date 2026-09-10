/**
 * Portal de Garantías Frozz.
 * Sirve la interfaz web y expone las funciones que el cliente HTML
 * invoca vía google.script.run.
 */

function doGet(e) {
  try {
    var pagina = e && e.parameter && e.parameter.page;

    if (pagina === 'manifest') {
      return ContentService
        .createTextOutput(JSON.stringify(construirManifest_()))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Panel interno de gestión (ver Gestionar.html): el pageId de Notion en
    // "id" es el único identificador real de acceso, nunca se le muestra al
    // cliente en ninguna vista pública (ver PROJECT_CONTEXT.md sobre el
    // modelo de seguridad "sin login" de todo el portal). "ticket" es solo
    // una referencia legible para el equipo (el número que ya trae la URL
    // guardada en GESTIONAR GARANTIA); Gestionar.html siempre recarga el
    // ticket real desde Notion usando "id" antes de mostrar nada.
    if (pagina === 'gestionar') {
      var pageId = String((e.parameter && e.parameter.id) || '').trim();
      var template = HtmlService.createTemplateFromFile('Gestionar');
      template.pageId = pageId;
      // Reutiliza el mismo logo (en base64) que ya usan los correos del
      // portal (ver LOGO_FROZZ_BASE64 en CorreoCliente.js), en vez de
      // duplicarlo dentro de Gestionar.html.
      template.logoBase64 = LOGO_FROZZ_BASE64;
      return template.evaluate()
        .setTitle('Frozz Garantías · Gestión')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
    }

    return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('Frozz Garantías')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  } catch (err) {
    notificarErrorPorCorreo_('doGet', err);
    return HtmlService.createHtmlOutput('<p>Ocurrió un problema cargando el portal. Ya se notificó al equipo técnico.</p>');
  }
}

function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

function construirManifest_() {
  return {
    name: 'Frozz Garantías',
    short_name: 'Garantías',
    start_url: '.',
    display: 'standalone',
    background_color: '#EEF4FA',
    theme_color: '#0A3D7A',
    icons: []
  };
}

/**
 * Ejecutar UNA sola vez desde el editor de Apps Script (no está expuesta al
 * portal público) para guardar las credenciales de Notion de forma segura.
 */
function configurarCredenciales(token, databaseId) {
  PropertiesService.getScriptProperties().setProperties({
    NOTION_TOKEN: token,
    NOTION_DATABASE_ID: databaseId
  });
}

function buscarClientePorNit(nit, tipoDocumento) {
  try {
    return notionBuscarClientePorNit_(nit, tipoDocumento);
  } catch (err) {
    notificarErrorPorCorreo_('buscarClientePorNit', err, { nit: nit, tipoDocumento: tipoDocumento });
    return { ok: false, error: 'No se pudo validar el documento: ' + err.message };
  }
}

function listarOrdenesTrabajoPorCliente(clientePageId) {
  try {
    return notionListarOrdenesTrabajoPorCliente_(clientePageId);
  } catch (err) {
    notificarErrorPorCorreo_('listarOrdenesTrabajoPorCliente', err, { clientePageId: clientePageId });
    return { ok: false, error: 'No se pudieron cargar las órdenes de trabajo: ' + err.message };
  }
}

var ADJUNTOS_MAX_CANTIDAD = 5;
var ADJUNTOS_MAX_BYTES_C_U = 8 * 1024 * 1024;

/**
 * Valida cantidad y peso de los adjuntos que llegan del navegador.
 * Devuelve un mensaje de error, o '' si todo está bien. La usan tanto
 * crearTicketInterno_ como subirDocumentacionGarantia (defensa en
 * profundidad en los dos puntos de entrada que reciben archivos).
 */
function validarArchivosAdjuntos_(archivos) {
  if (archivos.length > ADJUNTOS_MAX_CANTIDAD) {
    return 'Puedes adjuntar máximo ' + ADJUNTOS_MAX_CANTIDAD + ' archivos.';
  }
  for (var i = 0; i < archivos.length; i++) {
    var archivo = archivos[i] || {};
    if (!archivo.nombre || !archivo.tipoMime || !archivo.datosBase64) {
      return 'Uno de los archivos adjuntos no se pudo procesar. Intenta adjuntarlo de nuevo.';
    }
    var bytesAproximados = Math.floor(archivo.datosBase64.length * 3 / 4);
    if (bytesAproximados > ADJUNTOS_MAX_BYTES_C_U) {
      return 'El archivo "' + archivo.nombre + '" supera el tamaño máximo permitido (8 MB).';
    }
  }
  return '';
}

function crearTicket(datos) {
  try {
    return crearTicketInterno_(datos);
  } catch (err) {
    // No se manda el objeto `datos` completo: puede traer archivos
    // adjuntos en base64 de varios MB, demasiado pesados para un correo.
    notificarErrorPorCorreo_('crearTicket', err, {
      clienteNit: datos && datos.clienteNit,
      correoContacto: datos && datos.correoContacto,
      cantidadArchivos: datos && Array.isArray(datos.archivos) ? datos.archivos.length : 0
    });
    return { ok: false, error: 'Ocurrió un problema inesperado al crear la garantía. Ya se notificó al equipo técnico.' };
  }
}

function crearTicketInterno_(datos) {
  datos = datos || {};
  var clienteNit = String(datos.clienteNit || '').trim();
  var clienteTipoDocumento = String(datos.clienteTipoDocumento || '').trim();
  var clienteEmpresa = String(datos.clienteEmpresa || '').trim();
  var ordenTrabajoPageId = String(datos.ordenTrabajoPageId || '').trim();
  var nombreContacto = String(datos.nombreContacto || '').trim();
  var telefonoContacto = String(datos.telefonoContacto || '').trim();
  var correoContacto = String(datos.correoContacto || '').trim();
  var motivo = String(datos.motivo || '').trim();
  var descripcionGeneral = String(datos.descripcionGeneral || '').trim();
  var archivos = Array.isArray(datos.archivos) ? datos.archivos : [];

  if (!clienteNit || !clienteTipoDocumento || !clienteEmpresa || !nombreContacto || !telefonoContacto || !correoContacto || !motivo || !descripcionGeneral) {
    return { ok: false, error: 'Todos los campos son obligatorios.' };
  }

  // La documentación de soporte es opcional (ver Drive.js), pero si llegan
  // adjuntos se revalida cantidad y peso en el backend: el frontend ya los
  // limita, pero no hay que confiar únicamente en esa validación.
  var errorArchivos = validarArchivosAdjuntos_(archivos);
  if (errorArchivos) {
    return { ok: false, error: errorArchivos };
  }

  if (TIPO_DOCUMENTO_OPCIONES.indexOf(clienteTipoDocumento) === -1) {
    return { ok: false, error: 'Selecciona un tipo de documento válido.' };
  }

  if (MOTIVO_OPCIONES.indexOf(motivo) === -1) {
    return { ok: false, error: 'Selecciona un motivo válido.' };
  }

  if (!/^\S+@\S+\.\S+$/.test(correoContacto)) {
    return { ok: false, error: 'Ingresa un correo válido.' };
  }

  // Se revalida el documento (tipo + número) contra CLIENTES en el backend
  // (defensa en profundidad): el frontend ya lo verificó antes de mostrar el
  // resto del formulario, pero no hay que confiar en datos que llegan del
  // cliente sin volver a chequearlos.
  var validacionCliente;
  try {
    validacionCliente = notionBuscarClientePorNit_(clienteNit, clienteTipoDocumento);
  } catch (err) {
    notificarErrorPorCorreo_('crearTicket (validación de cliente)', err, { clienteNit: clienteNit });
    return { ok: false, error: 'No se pudo validar el documento: ' + err.message };
  }
  if (!validacionCliente.ok) {
    return validacionCliente;
  }

  // La orden de trabajo es opcional, pero si el usuario eligió una se
  // revalida en el backend que sí pertenezca al cliente verificado (misma
  // defensa en profundidad que el NIT: el frontend solo lista las OT del
  // cliente, pero no hay que confiar en el pageId que llega del cliente).
  if (ordenTrabajoPageId) {
    var ordenesCliente;
    try {
      ordenesCliente = notionListarOrdenesTrabajoPorCliente_(validacionCliente.cliente.pageId);
    } catch (err) {
      notificarErrorPorCorreo_('crearTicket (validación de orden de trabajo)', err, { ordenTrabajoPageId: ordenTrabajoPageId });
      return { ok: false, error: 'No se pudo validar la orden de trabajo: ' + err.message };
    }
    var perteneceAlCliente = ordenesCliente.ok && ordenesCliente.ordenes.some(function (ot) {
      return ot.pageId === ordenTrabajoPageId;
    });
    if (!perteneceAlCliente) {
      return { ok: false, error: 'La orden de trabajo seleccionada no es válida para este cliente.' };
    }
  }

  var resultado;
  try {
    resultado = notionCrearTicket({
      clientePageId: validacionCliente.cliente.pageId,
      ordenTrabajoPageId: ordenTrabajoPageId,
      nombreContacto: nombreContacto,
      telefonoContacto: telefonoContacto,
      correoContacto: correoContacto,
      motivo: motivo,
      descripcionGeneral: descripcionGeneral
    });
  } catch (err) {
    notificarErrorPorCorreo_('crearTicket (creación en Notion)', err, { clienteNit: clienteNit });
    return { ok: false, error: 'No se pudo crear la garantía: ' + err.message };
  }

  // La garantía ya quedó registrada en Notion en este punto: es el hecho
  // que le importa al cliente y lo que hace que "se haya guardado". La
  // carpeta de Drive y la subida de adjuntos NO se hacen aquí — se movieron
  // a subirDocumentacionGarantia(), que el frontend llama en una segunda
  // llamada aparte justo después de recibir este resultado (ver
  // JavaScript.html). Antes esto se hacía en línea, dentro de este mismo
  // try/catch: con adjuntos grandes o varios archivos, esa subida
  // secuencial podía demorar tanto que la respuesta de crearTicket ni
  // siquiera llegaba a tiempo al navegador (aunque el ticket ya existiera
  // en Notion), lo que se sentía como "está lento" o "no guardó" aunque sí
  // había guardado.

  // Link al panel interno de gestión (ver Gestionar.html), guardado en
  // GESTIONAR GARANTIA para que el equipo de Frozz lo encuentre directo
  // desde la fila en Notion. Tampoco debe hacer fallar la creación de la
  // garantía: si falla, el ticket ya existe y el equipo puede entrar a
  // gestionarlo buscándolo manualmente mientras se resuelve.
  var urlGestion = ScriptApp.getService().getUrl()
    + '?page=gestionar&id=' + encodeURIComponent(resultado.pageId)
    + '&ticket=' + encodeURIComponent(resultado.numero);
  try {
    notionActualizarLinkGestion_(resultado.pageId, urlGestion);
  } catch (err) {
    notificarErrorPorCorreo_('crearTicket (link de gestión)', err, { numeroGarantia: resultado.numero });
    Logger.log('No se pudo guardar el link de gestión para ' + resultado.numero + ': ' + err.message);
  }

  // Aviso interno de garantía nueva (ver CORREOS_EQUIPO_NUEVA_GARANTIA en
  // CorreoGestion.js), para que el equipo la revise, asigne responsables y
  // la inicie. Tampoco debe hacer fallar la creación de la garantía.
  try {
    enviarCorreoNuevaGarantiaEquipo_({
      numeroGarantia: resultado.numero,
      urlGestion: urlGestion,
      clienteEmpresa: clienteEmpresa,
      motivo: motivo
    });
  } catch (err) {
    notificarErrorPorCorreo_('crearTicket (correo al equipo de garantía nueva)', err, { numeroGarantia: resultado.numero });
  }

  // Correo de confirmación para el cliente. Tampoco debe hacer fallar la
  // creación de la garantía: si el envío falla, el cliente igual ve su
  // número de ticket en pantalla, y el equipo se entera del problema por
  // el correo de notificarErrorPorCorreo_.
  try {
    enviarCorreoConfirmacionTicket_({
      nombreContacto: nombreContacto,
      correoContacto: correoContacto,
      numeroGarantia: resultado.numero
    });
  } catch (err) {
    notificarErrorPorCorreo_('crearTicket (correo de confirmación al cliente)', err, {
      correoContacto: correoContacto,
      numeroGarantia: resultado.numero
    });
  }

  return resultado;
}

/**
 * Segundo paso de la creación de una garantía: crea la carpeta de Drive
 * (siempre, aunque no haya adjuntos, para que el equipo tenga dónde dejar
 * documentación después) y sube los archivos de soporte. El frontend la
 * llama justo después de que crearTicket() responde con éxito (ver
 * JavaScript.html), sin bloquear la pantalla de "garantía creada" que ya
 * ve el cliente. La garantía en Notion ya existe en este punto, así que un
 * problema aquí (Drive lento, un adjunto que falla, etc.) no debe volver a
 * fallar la creación: solo queda registrado para que el equipo lo revise.
 */
function subirDocumentacionGarantia(pageId, numeroGarantia, archivos) {
  var pageIdLimpio = String(pageId || '').trim();
  var numeroLimpio = String(numeroGarantia || '').trim();
  archivos = Array.isArray(archivos) ? archivos : [];

  if (!pageIdLimpio || !numeroLimpio) {
    return { ok: false, error: 'No se pudo identificar la garantía para adjuntar la documentación.' };
  }

  var errorArchivos = validarArchivosAdjuntos_(archivos);
  if (errorArchivos) {
    return { ok: false, error: errorArchivos };
  }

  try {
    var urlCarpeta = crearCarpetaGarantia_(numeroLimpio, archivos);
    notionActualizarDocumentosSoporte_(pageIdLimpio, urlCarpeta);
    return { ok: true, urlCarpeta: urlCarpeta };
  } catch (err) {
    notificarErrorPorCorreo_('subirDocumentacionGarantia', err, {
      numeroGarantia: numeroLimpio,
      cantidadArchivos: archivos.length
    });
    Logger.log('No se pudo crear la carpeta de Drive para ' + numeroLimpio + ': ' + err.message);
    try {
      notionRegistrarErrorDocumentacion_(pageIdLimpio, err.message);
    } catch (errInterno) {
      Logger.log('Tampoco se pudo registrar el error en COMENTARIOS: ' + errInterno.message);
    }
    return { ok: false, error: 'La garantía se creó, pero no se pudo guardar la documentación adjunta. El equipo de Frozz ya fue notificado.' };
  }
}

function buscarTicketPorId(numero, nit, tipoDocumento) {
  try {
    var tipoDocumentoLimpio = String(tipoDocumento || '').trim();
    if (!tipoDocumentoLimpio) {
      return { ok: false, error: 'Selecciona el tipo de documento de la empresa.' };
    }
    if (TIPO_DOCUMENTO_OPCIONES.indexOf(tipoDocumentoLimpio) === -1) {
      return { ok: false, error: 'Selecciona un tipo de documento válido.' };
    }

    var nitLimpio = limpiarNit_(nit);
    if (!nitLimpio) {
      return { ok: false, error: 'Ingresa el número de documento de la empresa.' };
    }

    var validacionCliente = notionBuscarClientePorNit_(nit, tipoDocumentoLimpio);
    if (!validacionCliente.ok) {
      return validacionCliente;
    }

    var resultado = notionBuscarPorId(numero);
    if (!resultado.ok) {
      return resultado;
    }

    if (resultado.ticket.clientePageId !== validacionCliente.cliente.pageId) {
      return { ok: false, error: 'No se encontró ninguna garantía con ese número para el documento ingresado.' };
    }

    resultado.ticket.clienteEmpresa = validacionCliente.cliente.empresa;
    resultado.ticket.clienteNit = validacionCliente.cliente.nit;

    if (resultado.ticket.ordenTrabajoPageId) {
      resultado.ticket.ordenTrabajo = notionObtenerNumeroOrdenTrabajo_(resultado.ticket.ordenTrabajoPageId);
    }

    return resultado;
  } catch (err) {
    notificarErrorPorCorreo_('buscarTicketPorId', err, { numero: numero, nit: nit, tipoDocumento: tipoDocumento });
    return { ok: false, error: 'No se pudo consultar la garantía: ' + err.message };
  }
}

/* =====================================================================
 * Panel interno de gestión de garantías (ver Gestionar.html).
 * Solo se llega aquí por el link guardado en GESTIONAR GARANTIA (nunca
 * expuesto al cliente), pero igual cada función valida su propio input y
 * las transiciones de etapa en GestionGarantia.js, en vez de confiar en
 * que el navegador que llama es siempre el panel legítimo.
 * ===================================================================== */

function obtenerGarantiaParaGestion(pageId) {
  try {
    var pageIdLimpio = String(pageId || '').trim();
    if (!pageIdLimpio) {
      return { ok: false, error: 'El link de gestión no es válido.' };
    }
    return notionObtenerGarantiaPorPageId_(pageIdLimpio);
  } catch (err) {
    notificarErrorPorCorreo_('obtenerGarantiaParaGestion', err, { pageId: pageId });
    return { ok: false, error: 'No se pudo cargar la garantía: ' + err.message };
  }
}

function listarPersonalActivo() {
  try {
    return { ok: true, personal: notionListarPersonalActivo_() };
  } catch (err) {
    notificarErrorPorCorreo_('listarPersonalActivo', err);
    return { ok: false, error: 'No se pudo cargar el personal activo: ' + err.message };
  }
}

function iniciarGestionGarantia(pageId, datos) {
  try {
    var resultado = notionIniciarGestionGarantia_(pageId, datos);
    if (!resultado.ok) return resultado;

    // Aviso informativo al líder responsable recién asignado. Tampoco debe
    // hacer fallar la acción ya aplicada en Notion.
    try {
      if (resultado.ticket.liderCorreoEfectivo) {
        enviarCorreoAsignacionLider_({
          nombreLider: resultado.ticket.liderNombre,
          correoLider: resultado.ticket.liderCorreoEfectivo,
          numeroGarantia: resultado.ticket.numero,
          motivo: resultado.ticket.motivo,
          descripcionGeneral: resultado.ticket.descripcionGeneral,
          clienteEmpresa: resultado.ticket.clienteEmpresa,
          ordenTrabajo: resultado.ticket.ordenTrabajo,
          prioridad: resultado.ticket.prioridad
        });
      }
    } catch (errCorreo) {
      notificarErrorPorCorreo_('iniciarGestionGarantia (correo al líder responsable)', errCorreo, { pageId: pageId });
    }

    return resultado;
  } catch (err) {
    notificarErrorPorCorreo_('iniciarGestionGarantia', err, { pageId: pageId });
    return { ok: false, error: 'No se pudo iniciar la gestión: ' + err.message };
  }
}

function avanzarEtapaGarantia(pageId, etapaDestino) {
  try {
    return notionAvanzarEtapaGarantia_(pageId, etapaDestino);
  } catch (err) {
    notificarErrorPorCorreo_('avanzarEtapaGarantia', err, { pageId: pageId, etapaDestino: etapaDestino });
    return { ok: false, error: 'No se pudo avanzar de etapa: ' + err.message };
  }
}

function aprobarGarantia(pageId, comentario) {
  try {
    var resultado = notionAprobarGarantia_(pageId, comentario);
    if (!resultado.ok) return resultado;

    try {
      enviarCorreoAprobacionGarantia_({
        nombreContacto: resultado.ticket.nombreContacto,
        correoContacto: resultado.ticket.correoContacto,
        numeroGarantia: resultado.ticket.numero,
        comentario: resultado.ticket.comentarios
      });
    } catch (errCorreo) {
      notificarErrorPorCorreo_('aprobarGarantia (correo al cliente)', errCorreo, { numeroGarantia: resultado.ticket.numero });
    }

    return resultado;
  } catch (err) {
    notificarErrorPorCorreo_('aprobarGarantia', err, { pageId: pageId });
    return { ok: false, error: 'No se pudo aprobar la garantía: ' + err.message };
  }
}

function rechazarGarantia(pageId, comentario) {
  try {
    var resultado = notionRechazarGarantia_(pageId, comentario);
    if (!resultado.ok) return resultado;

    try {
      enviarCorreoRechazoGarantia_({
        nombreContacto: resultado.ticket.nombreContacto,
        correoContacto: resultado.ticket.correoContacto,
        numeroGarantia: resultado.ticket.numero,
        comentario: resultado.ticket.comentarios
      });
    } catch (errCorreo) {
      notificarErrorPorCorreo_('rechazarGarantia (correo al cliente)', errCorreo, { numeroGarantia: resultado.ticket.numero });
    }

    return resultado;
  } catch (err) {
    notificarErrorPorCorreo_('rechazarGarantia', err, { pageId: pageId });
    return { ok: false, error: 'No se pudo rechazar la garantía: ' + err.message };
  }
}

function finalizarGarantia(pageId) {
  try {
    var resultado = notionFinalizarGarantia_(pageId);
    if (!resultado.ok) return resultado;

    try {
      enviarCorreoCierreGarantia_({
        nombreContacto: resultado.ticket.nombreContacto,
        correoContacto: resultado.ticket.correoContacto,
        numeroGarantia: resultado.ticket.numero
      });
    } catch (errCorreo) {
      notificarErrorPorCorreo_('finalizarGarantia (correo al cliente)', errCorreo, { numeroGarantia: resultado.ticket.numero });
    }

    return resultado;
  } catch (err) {
    notificarErrorPorCorreo_('finalizarGarantia', err, { pageId: pageId });
    return { ok: false, error: 'No se pudo finalizar la garantía: ' + err.message };
  }
}

function guardarAsignacionGarantia(pageId, datos) {
  try {
    return notionGuardarAsignacionGarantia_(pageId, datos);
  } catch (err) {
    notificarErrorPorCorreo_('guardarAsignacionGarantia', err, { pageId: pageId });
    return { ok: false, error: 'No se pudo guardar la asignación: ' + err.message };
  }
}
