/**
 * Notificación por correo cuando algo falla en el portal de Garantías.
 * El equipo técnico se entera al instante, sin depender de que el cliente
 * reporte el problema o de revisar logs de Apps Script (que requieren un
 * proyecto de Google Cloud aparte, ver README).
 */

var CORREOS_NOTIFICACION_ERRORES = [
  'jflorez@frozzcolombia.com',
  'mmendoza@frozzcolombia.com'
];

/**
 * Envía el correo de alerta. `nombreFuncion` identifica el punto de
 * entrada donde se atrapó el error (ej. "crearTicket"); `err` es el
 * objeto Error capturado. En el runtime V8 de Apps Script, err.stack ya
 * incluye la función y la línea exactas donde ocurrió cada salto de la
 * traza (ej. "at crearTicket (Code:150:11)"), así que no hay que armar
 * esa información a mano.
 *
 * `contexto` es opcional: un objeto plano con datos adicionales (ej. el
 * NIT o número de garantía que se estaba procesando) para que el equipo
 * no tenga que adivinar qué solicitud fue.
 *
 * Nunca debe lanzar: si el envío de correo falla, se registra en los
 * logs de ejecución y sigue de largo — un problema notificando el error
 * no puede tumbar el flujo que ya estaba fallando.
 */
function notificarErrorPorCorreo_(nombreFuncion, err, contexto) {
  try {
    var lineas = [
      'Se produjo un error en el portal de Garantías Frozz.',
      '',
      'Función donde ocurrió: ' + nombreFuncion + '()',
      'Mensaje: ' + (err && err.message ? err.message : String(err)),
      '',
      'Traza completa (incluye la función y el número de línea exactos):',
      (err && err.stack) ? err.stack : '(no disponible)'
    ];

    if (contexto && Object.keys(contexto).length) {
      lineas.push('', 'Datos de la solicitud que estaba procesando:');
      Object.keys(contexto).forEach(function (clave) {
        lineas.push('  ' + clave + ': ' + contexto[clave]);
      });
    }

    lineas.push('', 'Fecha: ' + Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy-MM-dd HH:mm:ss'));

    MailApp.sendEmail({
      to: CORREOS_NOTIFICACION_ERRORES.join(','),
      subject: '[Frozz Garantías] Error en ' + nombreFuncion + '()',
      body: lineas.join('\n')
    });
  } catch (errEnvio) {
    Logger.log('No se pudo enviar el correo de notificación de error: ' + errEnvio.message);
  }
}

/**
 * Ejecutar UNA sola vez desde el editor de Apps Script (Ejecutar >
 * probarNotificacionError) para autorizar el permiso de envío de correo
 * (https://www.googleapis.com/auth/script.send_mail) y confirmar que la
 * cuenta que tiene desplegado el portal (USER_DEPLOYING) sí puede mandar
 * estos correos. Si acabas de autorizar Drive con esta misma cuenta y ya
 * te había funcionado, es posible que igual haga falta revocar el acceso
 * en https://myaccount.google.com/permissions y volver a correr esta
 * función para que pida el permiso de correo también.
 */
function probarNotificacionError() {
  notificarErrorPorCorreo_('probarNotificacionError', new Error('Este es un correo de prueba, no representa un error real.'));
  Logger.log('Correo de prueba enviado a: ' + CORREOS_NOTIFICACION_ERRORES.join(', '));
}
