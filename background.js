// background.js - Service Worker

let tramitesPromise = null;

function getTramitesLiberados() {
  if (!tramitesPromise) {
    const jsonUrl = chrome.runtime.getURL('data/tramites_liberados.json');
    tramitesPromise = fetch(jsonUrl).then((r) => r.json());
  }
  return tramitesPromise;
}

/** Misma URL lógica que en JSON: origen + pathname, sin hash, sin / final. */
function normalizeUrlForTramiteMatch(urlString) {
  try {
    const u = new URL(urlString);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.origin}${path}`.toLowerCase();
  } catch {
    return '';
  }
}

function findTramiteForUrl(pageUrl, tramites) {
  const key = normalizeUrlForTramiteMatch(pageUrl);
  for (const t of tramites) {
    if (normalizeUrlForTramiteMatch(t.URL) === key) return t;
  }
  return null;
}

function safeFilenameSegment(value) {
  return String(value)
    .replace(/[^a-z0-9._-]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Escuchar mensajes del popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture') {
    handleCapture(message.tabId, message.url, sendResponse);
    return true; // Mantener canal abierto para respuesta async
  }
});

async function handleCapture(tabId, pageUrl, sendResponse) {
  try {
    // 1. Generar nombre base desde la URL
    const filename = await generateFilename(pageUrl);

    // 2. Capturar screenshot de la pestaña visible
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 95
    });

    // 3. Descargar la imagen con el nombre generado
    await chrome.downloads.download({
      url: dataUrl,
      filename: `screenshots/${filename}`,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    sendResponse({ success: true, filename });

  } catch (error) {
    console.error('Error en captura:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Generar nombre de archivo: [departamento_idtipo_]dominio_ruta_001.png
async function generateFilename(pageUrl) {
  const tramites = await getTramitesLiberados();
  const tramiteMatch = findTramiteForUrl(pageUrl, tramites);

  let departamento = null;
  let idTipoTramite = null;
  let prefix = '';

  if (tramiteMatch) {
    departamento = tramiteMatch.departmento;
    idTipoTramite = tramiteMatch.id_tipo_tramite;
    prefix = `${safeFilenameSegment(departamento)}_${safeFilenameSegment(idTipoTramite)}_`;
  }

  // Crear clave limpia desde la URL
  const urlKey = urlToStorageKey(pageUrl);

  // Obtener y actualizar el consecutivo
  const data = await chrome.storage.local.get(urlKey);
  const count = (data[urlKey] || 0) + 1;
  await chrome.storage.local.set({ [urlKey]: count });

  // Formatear número con ceros: 001, 002, ...
  const consecutive = String(count).padStart(3, '0');

  // Nombre legible desde la URL
  const readableName = urlToReadableName(pageUrl);
  const filename = `${prefix}${readableName}_${consecutive}.png`;
  console.log('readableName', readableName);
  console.log('consecutive', consecutive);
  if (departamento != null) {
    console.log('tramite departamento', departamento, 'id_tipo_tramite', idTipoTramite);
  }
  console.log('filename', filename);
  console.log('BY GAMASOFT');
  console.log('--------------------------------');
  return filename;
}

// Convertir URL a nombre de archivo legible
function urlToReadableName(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');
    const path = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 2)        // Máximo 2 segmentos del path
      .join('_');

    const base = path ? `${host}_${path}` : host;

    // Limpiar caracteres no válidos para nombres de archivo
    return base
      .replace(/[^a-z0-9._-]/gi, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toLowerCase()
      .slice(0, 50);      // Máximo 50 caracteres

  } catch {
    return 'screenshot';
  }
}

// Clave para localStorage (idéntica a popup.js)
function urlToStorageKey(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60);
  } catch {
    return 'unknown_page';
  }
}
