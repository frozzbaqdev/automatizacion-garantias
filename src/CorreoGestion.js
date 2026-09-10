/**
 * Correos relacionados con la gestión interna de una garantía: hacia el
 * cliente (aprobación, rechazo, cierre — panel de Gestionar.html /
 * GestionGarantia.js) y hacia el equipo de Frozz (aviso de garantía nueva,
 * aviso de asignación a un líder responsable — Code.js). Reutiliza el logo
 * y la paleta de CorreoCliente.js (LOGO_FROZZ_BASE64, saludoSegunHora_,
 * escaparHtml_) para que se vean como la misma familia de correos del portal.
 *
 * Quien llama a estas funciones (Code.js) debe envolverlas en try/catch: la
 * garantía ya quedó creada/actualizada en Notion antes de llegar aquí, así
 * que un problema enviando el correo no debe deshacer la acción ya hecha.
 */

// Correos internos que deben revisar, asignar responsables e iniciar cada
// garantía nueva (ver enviarCorreoNuevaGarantiaEquipo_, disparado desde
// crearTicketInterno_ en Code.js). Cambiar aquí si los destinatarios cambian.
var CORREOS_EQUIPO_NUEVA_GARANTIA = [
  'mmendoza@frozzcolombia.com',
  'lmojica@frozzcolombia.com'
];

function logoFrozzBlob_() {
  return Utilities.newBlob(
    Utilities.base64Decode(LOGO_FROZZ_BASE64),
    'image/png',
    'logo-frozz.png'
  );
}

/**
 * Arma la tabla HTML del correo: mismo encabezado con degradado + logo y
 * mismo pie que construirHtmlConfirmacionTicket_ en CorreoCliente.js,
 * `contenidoHtml` es el cuerpo específico de cada correo (parámetros de
 * abajo).
 */
function construirEnvoltorioCorreoGestion_(contenidoHtml) {
  return ''
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF4FA;padding:32px 16px;">'
    + '<tr><td align="center">'
    + '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;border:1px solid #DCE6EF;">'

    + '<tr><td bgcolor="#0A3D7A" style="background:linear-gradient(120deg,#0A3D7A 0%,#1467C7 55%,#4FC3E8 100%);padding:32px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;">'
    + '<tr><td style="padding:12px 24px;">'
    + '<img src="cid:logoFrozz" width="130" alt="Frozz Colombia" style="display:block;border:0;outline:none;">'
    + '</td></tr>'
    + '</table>'
    + '</td></tr></table>'
    + '</td></tr>'

    + '<tr><td style="padding:32px;">' + contenidoHtml + '</td></tr>'

    + '<tr><td bgcolor="#F5F8FB" style="background:#F5F8FB;padding:18px 32px;text-align:center;border-top:1px solid #DCE6EF;">'
    + '<p style="margin:0;font-size:11.5px;line-height:1.5;color:#5B6B7C;">Este es un mensaje automático del portal de Garantías de Frozz Colombia. Por favor no responda directamente a este correo.</p>'
    + '</td></tr>'

    + '</table>'
    + '</td></tr>'
    + '</table>';
}

/**
 * Caja de acento (número de ticket, comentario, etc.) del mismo estilo que
 * la caja "Número de ticket" de construirHtmlConfirmacionTicket_, pero con
 * color configurable según el tipo de correo.
 */
function construirCajaCorreo_(etiqueta, texto, colorFondo, colorBorde, colorTexto) {
  return ''
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + colorFondo + ';border:1px solid ' + colorBorde + ';border-radius:12px;margin:0 0 24px;">'
    + '<tr><td style="padding:16px 20px;">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:' + colorTexto + ';margin-bottom:6px;">' + escaparHtml_(etiqueta) + '</div>'
    + '<div style="font-size:14.5px;line-height:1.6;color:#0B2038;white-space:pre-wrap;text-align:justify;">' + escaparHtml_(texto) + '</div>'
    + '</td></tr>'
    + '</table>';
}

/**
 * Botón/hipervínculo del correo, con el mismo degradado y tipografía que
 * `.btn` en Styles.html (los correos no pueden depender de esa hoja de
 * estilos, así que se reproduce inline con los mismos colores).
 */
function construirBotonCorreo_(texto, url) {
  return ''
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">'
    + '<tr><td align="center">'
    + '<a href="' + url + '" target="_blank" style="display:inline-block;background:linear-gradient(120deg,#0A3D7A 0%,#1467C7 55%,#4FC3E8 100%);color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:12px;">' + escaparHtml_(texto) + '</a>'
    + '</td></tr>'
    + '</table>';
}

/**
 * Lista de detalles etiqueta/valor (cliente, orden de trabajo, motivo,
 * prioridad, etc.) en una caja con el mismo estilo que construirCajaCorreo_.
 * Las filas sin valor se omiten (el llamador ya filtra, ver
 * enviarCorreoAsignacionLider_).
 */
function construirListaDetallesCorreo_(filas) {
  var filasHtml = filas.map(function (fila, i) {
    var borde = (i === filas.length - 1) ? '' : 'border-bottom:1px solid #E3EBF3;';
    return ''
      + '<tr>'
      + '<td style="padding:10px 0;' + borde + 'font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#5B6B7C;width:38%;vertical-align:top;">' + escaparHtml_(fila.etiqueta) + '</td>'
      + '<td style="padding:10px 0;' + borde + 'font-size:14px;line-height:1.5;color:#0B2038;">' + escaparHtml_(fila.valor) + '</td>'
      + '</tr>';
  }).join('');

  return ''
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;border:1px solid #DCE6EF;border-radius:12px;margin:0 0 24px;">'
    + '<tr><td style="padding:4px 20px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + filasHtml + '</table>'
    + '</td></tr>'
    + '</table>';
}

/**
 * Aviso interno de que se creó una garantía nueva, para que el equipo de
 * Frozz la revise, asigne responsables y la inicie desde el panel de
 * gestión. Se dispara desde crearTicketInterno_ (Code.js) justo después de
 * guardar el link de gestión, hacia CORREOS_EQUIPO_NUEVA_GARANTIA (constante
 * arriba en este archivo).
 */
function enviarCorreoNuevaGarantiaEquipo_(datos) {
  var numero = datos.numeroGarantia;
  var saludo = saludoSegunHora_();
  var asunto = 'Nueva solicitud de garantía · ' + numero;

  var detalles = construirListaDetallesCorreo_([
    { etiqueta: 'Cliente', valor: datos.clienteEmpresa || '—' },
    { etiqueta: 'Motivo', valor: datos.motivo || '—' }
  ]);

  var contenido = ''
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">' + saludo + '.</p>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Se acaba de registrar la solicitud de garantía <strong>' + escaparHtml_(numero) + '</strong>. Por favor revísala, asigna a los responsables e inícala desde el panel de gestión.</p>'
    + detalles
    + construirBotonCorreo_('Ir al panel de gestión', datos.urlGestion)
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#0B2038;">Cordialmente,<br><strong>Portal de Garantías</strong><br>Frozz Colombia</p>';

  var textoPlano = [
    saludo + '.',
    '',
    'Se acaba de registrar la solicitud de garantía ' + numero + '. Por favor revísala, asigna a los responsables e inícala desde el panel de gestión.',
    '',
    'Cliente: ' + (datos.clienteEmpresa || '—'),
    'Motivo: ' + (datos.motivo || '—'),
    '',
    'Panel de gestión: ' + datos.urlGestion,
    '',
    'Portal de Garantías',
    'Frozz Colombia'
  ].join('\n');

  MailApp.sendEmail({
    to: CORREOS_EQUIPO_NUEVA_GARANTIA.join(','),
    subject: asunto,
    body: textoPlano,
    htmlBody: construirEnvoltorioCorreoGestion_(contenido),
    inlineImages: { logoFrozz: logoFrozzBlob_() },
    name: 'Frozz Colombia · Garantías'
  });
}

/**
 * Aviso informativo al líder responsable recién asignado (al darle
 * "Iniciar gestión" en el panel, ver iniciarGestionGarantia en Code.js), con
 * el detalle de la garantía que se le asignó. `datos.ordenTrabajo` es
 * opcional (no toda garantía tiene una).
 */
function enviarCorreoAsignacionLider_(datos) {
  var nombre = datos.nombreLider || 'equipo';
  var numero = datos.numeroGarantia;
  var saludo = saludoSegunHora_();
  var asunto = 'Se te asignó la garantía ' + numero + ' como líder responsable';

  var filas = [
    { etiqueta: 'Cliente', valor: datos.clienteEmpresa || '—' },
    { etiqueta: 'Orden de trabajo', valor: datos.ordenTrabajo || '' },
    { etiqueta: 'Motivo', valor: datos.motivo || '—' },
    { etiqueta: 'Prioridad', valor: datos.prioridad || '—' }
  ].filter(function (fila) { return fila.valor; });

  var contenido = ''
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">' + saludo + ', <strong>' + escaparHtml_(nombre) + '</strong>.</p>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Se te asignó como <strong>líder responsable</strong> de la garantía <strong>' + escaparHtml_(numero) + '</strong>. A continuación el detalle de la solicitud:</p>'
    + construirListaDetallesCorreo_(filas)
    + construirCajaCorreo_('Descripción de la solicitud', datos.descripcionGeneral, '#EEF4FA', '#DCE6EF', '#0A3D7A')
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#0B2038;">Cordialmente,<br><strong>Portal de Garantías</strong><br>Frozz Colombia</p>';

  var textoPlano = [
    saludo + ', ' + nombre + '.',
    '',
    'Se te asignó como líder responsable de la garantía ' + numero + '.',
    '',
    'Cliente: ' + (datos.clienteEmpresa || '—'),
    'Orden de trabajo: ' + (datos.ordenTrabajo || '—'),
    'Motivo: ' + (datos.motivo || '—'),
    'Prioridad: ' + (datos.prioridad || '—'),
    '',
    'Descripción de la solicitud:',
    datos.descripcionGeneral,
    '',
    'Portal de Garantías',
    'Frozz Colombia'
  ].join('\n');

  MailApp.sendEmail({
    to: datos.correoLider,
    subject: asunto,
    body: textoPlano,
    htmlBody: construirEnvoltorioCorreoGestion_(contenido),
    inlineImages: { logoFrozz: logoFrozzBlob_() },
    name: 'Frozz Colombia · Garantías'
  });
}

function enviarCorreoAprobacionGarantia_(datos) {
  var nombre = datos.nombreContacto || 'cliente';
  var numero = datos.numeroGarantia;
  var saludo = saludoSegunHora_();
  var asunto = 'Tu solicitud de garantía fue aprobada · ' + numero;

  var contenido = ''
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">' + saludo + ', <strong>' + escaparHtml_(nombre) + '</strong>.</p>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Le informamos que su solicitud de garantía <strong>' + escaparHtml_(numero) + '</strong> fue <strong style="color:#1E8F6F;">aprobada</strong> y continúa a la etapa de <strong>En ejecución</strong>.</p>'
    + construirCajaCorreo_('Comentario del equipo de Frozz', datos.comentario, '#DFF3EC', '#B7E1D2', '#1E8F6F')
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">En breve nuestro equipo técnico dará inicio a la ejecución de esta garantía. Puede consultar el avance en cualquier momento desde nuestro portal.</p>'
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#0B2038;">Cordialmente,<br><strong>Equipo de Garantías</strong><br>Frozz Colombia</p>';

  var textoPlano = [
    saludo + ', ' + nombre + '.',
    '',
    'Le informamos que su solicitud de garantía ' + numero + ' fue aprobada y continúa a la etapa de En ejecución.',
    '',
    'Comentario del equipo de Frozz:',
    datos.comentario,
    '',
    'Puede consultar el avance en cualquier momento desde nuestro portal.',
    '',
    'Cordialmente,',
    'Equipo de Garantías',
    'Frozz Colombia'
  ].join('\n');

  MailApp.sendEmail({
    to: datos.correoContacto,
    subject: asunto,
    body: textoPlano,
    htmlBody: construirEnvoltorioCorreoGestion_(contenido),
    inlineImages: { logoFrozz: logoFrozzBlob_() },
    name: 'Frozz Colombia · Garantías'
  });
}

function enviarCorreoRechazoGarantia_(datos) {
  var nombre = datos.nombreContacto || 'cliente';
  var numero = datos.numeroGarantia;
  var saludo = saludoSegunHora_();
  var asunto = 'Resultado de tu solicitud de garantía · ' + numero;

  var contenido = ''
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">' + saludo + ', <strong>' + escaparHtml_(nombre) + '</strong>.</p>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Le informamos que, luego de revisar su solicitud de garantía <strong>' + escaparHtml_(numero) + '</strong>, nuestro equipo técnico determinó que no procede.</p>'
    + construirCajaCorreo_('Motivo del rechazo', datos.comentario, '#FBE6E3', '#EBB6AE', '#C23A2E')
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Si considera que esta decisión requiere revisión adicional, puede comunicarse con nuestro equipo de garantías.</p>'
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#0B2038;">Cordialmente,<br><strong>Equipo de Garantías</strong><br>Frozz Colombia</p>';

  var textoPlano = [
    saludo + ', ' + nombre + '.',
    '',
    'Le informamos que, luego de revisar su solicitud de garantía ' + numero + ', nuestro equipo técnico determinó que no procede.',
    '',
    'Motivo del rechazo:',
    datos.comentario,
    '',
    'Si considera que esta decisión requiere revisión adicional, puede comunicarse con nuestro equipo de garantías.',
    '',
    'Cordialmente,',
    'Equipo de Garantías',
    'Frozz Colombia'
  ].join('\n');

  MailApp.sendEmail({
    to: datos.correoContacto,
    subject: asunto,
    body: textoPlano,
    htmlBody: construirEnvoltorioCorreoGestion_(contenido),
    inlineImages: { logoFrozz: logoFrozzBlob_() },
    name: 'Frozz Colombia · Garantías'
  });
}

function enviarCorreoCierreGarantia_(datos) {
  var nombre = datos.nombreContacto || 'cliente';
  var numero = datos.numeroGarantia;
  var saludo = saludoSegunHora_();
  var asunto = 'Tu garantía fue cerrada · ' + numero;

  var contenido = ''
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">' + saludo + ', <strong>' + escaparHtml_(nombre) + '</strong>.</p>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Le confirmamos que su solicitud de garantía <strong>' + escaparHtml_(numero) + '</strong> fue finalizada exitosamente y su caso ha quedado cerrado.</p>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF4FA;border:1px solid #DCE6EF;border-radius:12px;margin:0 0 24px;">'
    + '<tr><td style="padding:18px 20px;text-align:center;">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#5B6B7C;">Ticket cerrado</div>'
    + '<div style="font-size:24px;font-weight:700;letter-spacing:0.03em;color:#0A3D7A;font-family:\'Courier New\',Courier,monospace;margin-top:4px;">' + escaparHtml_(numero) + '</div>'
    + '</td></tr>'
    + '</table>'
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#0B2038;text-align:justify;">Agradecemos su confianza en Frozz Colombia. Si en el futuro necesita reportar una nueva garantía, puede hacerlo en cualquier momento desde nuestro portal.</p>'
    + '<p style="margin:0;font-size:15px;line-height:1.6;color:#0B2038;">Cordialmente,<br><strong>Equipo de Garantías</strong><br>Frozz Colombia</p>';

  var textoPlano = [
    saludo + ', ' + nombre + '.',
    '',
    'Le confirmamos que su solicitud de garantía ' + numero + ' fue finalizada exitosamente y su caso ha quedado cerrado.',
    '',
    'Agradecemos su confianza en Frozz Colombia. Si en el futuro necesita reportar una nueva garantía, puede hacerlo en cualquier momento desde nuestro portal.',
    '',
    'Cordialmente,',
    'Equipo de Garantías',
    'Frozz Colombia'
  ].join('\n');

  MailApp.sendEmail({
    to: datos.correoContacto,
    subject: asunto,
    body: textoPlano,
    htmlBody: construirEnvoltorioCorreoGestion_(contenido),
    inlineImages: { logoFrozz: logoFrozzBlob_() },
    name: 'Frozz Colombia · Garantías'
  });
}
