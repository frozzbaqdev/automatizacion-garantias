/**
 * Integración con Google Drive para guardar la documentación de soporte
 * (fotos, PDFs, etc.) que el cliente adjunta al crear una garantía.
 *
 * Cada garantía obtiene su propia subcarpeta, nombrada con el número de
 * garantía (ej. "GARF330467"), dentro de la carpeta raíz de Garantías:
 *   https://drive.google.com/drive/folders/1LvjDprSS-_eLPygtLqdI5Ar0L9syhUVq
 *
 * La carpeta se crea siempre, así el cliente no adjunte ningún archivo (el
 * campo de documentación es opcional, ver Index.html / JavaScript.html).
 *
 * IMPORTANTE: esa carpeta raíz vive dentro de una Unidad compartida
 * (Shared Drive). El servicio DriveApp (el "normal" de Apps Script) puede
 * leer carpetas de una unidad compartida sin problema, pero sus llamadas
 * de escritura (createFolder, createFile) no envían el parámetro
 * supportsAllDrives=true que la API de Drive exige para modificar
 * contenido ahí, y sin él Drive las rechaza como si fuera un problema de
 * permisos aunque la cuenta sí tenga acceso. Por eso aquí no se usa
 * DriveApp para crear nada: se llama directo a la API REST de Drive v3
 * con UrlFetchApp, indicando supportsAllDrives=true. El permiso de Drive
 * (oauthScopes en appsscript.json) también debe estar declarado
 * explícitamente ahí — dejarlo a la detección automática de Apps Script
 * puede terminar pidiendo solo alcance de lectura.
 */

var DRIVE_CARPETA_RAIZ_ID = '1LvjDprSS-_eLPygtLqdI5Ar0L9syhUVq';
var DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
var DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

function driveFetch_(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  options.headers.Authorization = 'Bearer ' + ScriptApp.getOAuthToken();
  options.muteHttpExceptions = true;

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    body = {};
  }
  if (code < 200 || code >= 300) {
    var mensaje = (body && body.error && body.error.message) ? body.error.message : ('Error de Drive (' + code + ')');
    throw new Error(mensaje);
  }
  return body;
}

/**
 * Crea la subcarpeta de la garantía y sube los archivos adjuntos (si los
 * hay). `archivos` es un arreglo de { nombre, tipoMime, datosBase64 }
 * armado en el navegador a partir de los File que eligió el cliente.
 *
 * Quien llama a esta función (subirDocumentacionGarantia en Code.js) debe
 * envolverla en try/catch: la garantía ya quedó registrada en Notion antes
 * de llegar aquí, así que un problema al guardar los adjuntos en Drive no
 * debe impedir que el cliente reciba su número de garantía.
 */
function crearCarpetaGarantia_(numeroGarantia, archivos) {
  var carpeta = driveFetch_(
    DRIVE_API_BASE + '/files?supportsAllDrives=true&fields=id,webViewLink',
    {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        name: numeroGarantia,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [DRIVE_CARPETA_RAIZ_ID]
      })
    }
  );

  subirArchivosADriveEnParalelo_(carpeta.id, archivos || []);

  return carpeta.webViewLink;
}

/**
 * Sube todos los archivos adjuntos (ya en base64) a una carpeta de Drive a
 * la vez, con UrlFetchApp.fetchAll(): antes se subían uno por uno de forma
 * secuencial, lo que multiplicaba la latencia por la cantidad de adjuntos
 * (hasta 5 archivos de 8 MB c/u). fetchAll lanza las peticiones en paralelo
 * y espera todas juntas, así que el costo total es el del archivo más
 * lento, no la suma de todos.
 */
function subirArchivosADriveEnParalelo_(carpetaId, archivos) {
  if (!archivos.length) return;

  var solicitudes = archivos.map(function (archivo) {
    return construirSolicitudSubidaArchivo_(carpetaId, archivo);
  });

  var respuestas = UrlFetchApp.fetchAll(solicitudes);

  for (var i = 0; i < respuestas.length; i++) {
    var code = respuestas[i].getResponseCode();
    if (code < 200 || code >= 300) {
      var body = {};
      try { body = JSON.parse(respuestas[i].getContentText()); } catch (e) { body = {}; }
      var mensaje = (body && body.error && body.error.message) ? body.error.message : ('Error de Drive (' + code + ')');
      throw new Error('No se pudo subir "' + archivos[i].nombre + '": ' + mensaje);
    }
  }
}

/**
 * Arma la petición "multipart/related" para subir un archivo, sin
 * ejecutarla todavía: la primera parte es el JSON de metadatos (nombre +
 * carpeta destino) y la segunda es el contenido del archivo, marcado con
 * Content-Transfer-Encoding: base64 para poder mandar tal cual el base64
 * que ya llegó del navegador, sin tener que decodificarlo y reconstruir
 * bytes crudos a mano. Se devuelve como objeto de opciones para que
 * UrlFetchApp.fetchAll() pueda dispararla junto con las demás en paralelo.
 */
function construirSolicitudSubidaArchivo_(carpetaId, archivo) {
  var boundary = 'frozzgarantias-' + Utilities.getUuid();
  var metadata = JSON.stringify({ name: archivo.nombre, parents: [carpetaId] });

  var cuerpoMultipart =
    '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    metadata + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: ' + archivo.tipoMime + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    archivo.datosBase64 + '\r\n' +
    '--' + boundary + '--';

  return {
    url: DRIVE_UPLOAD_BASE + '/files?uploadType=multipart&supportsAllDrives=true',
    method: 'post',
    contentType: 'multipart/related; boundary="' + boundary + '"',
    payload: cuerpoMultipart,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
}
