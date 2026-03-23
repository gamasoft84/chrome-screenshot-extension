// background.js - Service Worker

// ─── Mensajes desde el popup ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'capture') {
    // Lanzar async y mantener canal abierto con `return true`
    handleCapture(message.tabId, message.windowId, message.url, message.mode)
      .then(result  => sendResponse(result))
      .catch(err    => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// ─── Region selection flow ─────────────────────────────────────────────
// Stores pending region capture callbacks keyed by tabId
const pendingRegion = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startRegionCapture') {
    const { tabId, windowId, url } = message;
    // Inject selector into page
    chrome.scripting.executeScript({ target: { tabId }, files: ['region_selector.js'] })
      .catch(() => {});
    // Store callback - will be resolved when regionSelected arrives
    pendingRegion[tabId] = { windowId, url };
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'regionSelected') {
    const tabId = sender.tab?.id;
    const pending = pendingRegion[tabId];
    if (!pending) return;
    delete pendingRegion[tabId];

    if (message.cancelled) return;

    captureRegion(tabId, pending.windowId, pending.url, message.region)
      .then(result => {
        // Notify popup via storage (popup may be closed)
        chrome.storage.session.set({ lastCapture: result });
      })
      .catch(err => console.error('[Region capture]', err));
  }
});

async function captureRegion(tabId, windowId, pageUrl, region) {
  const { x, y, width, height, dpr } = region;

  // Capture what's currently visible
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const img     = await dataUrlToImageBitmap(dataUrl);

  // Crop to selected region (region coords are already in CSS pixels relative to viewport)
  const cropX = Math.round(x      * dpr);
  const cropY = Math.round(y      * dpr);
  const cropW = Math.round(width  * dpr);
  const cropH = Math.round(height * dpr);

  const canvas = new OffscreenCanvas(cropW, cropH);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  img.close();

  const filename = await generateFilename(pageUrl);
  const blob     = await canvas.convertToBlob({ type: 'image/png' });
  const finalUrl = await blobToBase64(blob);

  await chrome.downloads.download({
    url: finalUrl,
    filename: `screenshots/${filename}`,
    saveAs: false,
    conflictAction: 'uniquify'
  });

  return { success: true, filename };
}

// ─── Hotkey Ctrl+Shift+S ──────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-screenshot') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const { captureMode = 'full' } = await chrome.storage.local.get('captureMode');
  const result = await handleCapture(tab.id, tab.windowId, tab.url, captureMode);
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: showPageToast,
    args: [result.success, result.filename || result.error || '']
  }).catch(() => {});
});

// ─── Lógica principal ─────────────────────────────────────────────────────────
async function handleCapture(tabId, windowId, pageUrl, mode = 'full') {
  // Inyectar content script (silencioso si ya está)
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content_capture.js'] })
    .catch(() => {});
  await sleep(80);

  let dataUrl;
  try {
    if (mode === 'full') {
      dataUrl = await captureFullPage(tabId, windowId);
    } else {
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    }
  } catch (err) {
    // Ocultar overlay si quedó visible
    await sendToTab(tabId, { action: 'hideProgress' }).catch(() => {});
    throw err;
  }

  const filename = await generateFilename(pageUrl);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `screenshots/${filename}`,
    saveAs: false,
    conflictAction: 'uniquify'
  });
  return { success: true, filename };
}

// ─── Throttle para captureVisibleTab (límite Chrome: 2/seg) ──────────────────
// Usamos una cola serializada con mínimo 600ms entre llamadas (margen seguro).
const CAPTURE_INTERVAL_MS = 600;
let   lastCaptureTime     = 0;

async function captureVisibleTabThrottled(windowId) {
  const now  = Date.now();
  const wait = CAPTURE_INTERVAL_MS - (now - lastCaptureTime);
  if (wait > 0) await sleep(wait);
  lastCaptureTime = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

// ─── Captura full-page: scroll + stitch ───────────────────────────────────────
async function captureFullPage(tabId, windowId) {

  await sendToTab(tabId, { action: 'showProgress', pct: 2, text: 'Preparando…' }).catch(() => {});

  // Guardar scroll original
  const dimsFirst = await sendToTab(tabId, { action: 'getPageDimensions' });
  const { originalScrollX, originalScrollY } = dimsFirst;

  // Ir al inicio, preparar DOM (oculta footer/fixed, inyecta URL bar)
  await sendToTab(tabId, { action: 'scrollTo', x: 0, y: 0 });
  await sleep(100);
  await sendToTab(tabId, { action: 'prepareCapture' });
  await sleep(200);

  // Dimensiones limpias post-preparacion
  const dims = await sendToTab(tabId, { action: 'getPageDimensions' });
  const { scrollWidth, scrollHeight, viewportWidth, viewportHeight, devicePixelRatio: dpr } = dims;

  const MAX_PX = 16000;
  const capH   = Math.min(scrollHeight, Math.floor(MAX_PX / dpr));
  const capW   = Math.min(scrollWidth,  Math.floor(MAX_PX / dpr));

  const canvas = new OffscreenCanvas(Math.round(capW * dpr), Math.round(capH * dpr));
  const ctx    = canvas.getContext('2d');

  // Cuantos tiles necesitamos
  const stepsY = Math.ceil(capH / viewportHeight);

  let nextDrawY  = 0;  // proximo pixel del canvas donde dibujar
  let prevTargetY = 0;  // targetY del tile anterior para calcular delta

  for (let row = 0; row < stepsY; row++) {
    // Scroll exacto: tiles normales van de a viewportHeight, el ultimo al maximo posible
    const targetY = row < stepsY - 1
      ? row * viewportHeight
      : Math.max(0, capH - viewportHeight);

    const actual = await sendToTab(tabId, { action: 'scrollTo', x: 0, y: targetY });
    await sleep(150); // Dar tiempo al browser para repaint tras scroll

    // Captura limpia (sin overlay)
    await sendToTab(tabId, { action: 'setOverlayVisible', visible: false }).catch(() => {});
    await sleep(60); // Frame extra para que display:none aplique
    const tileUrl = await captureVisibleTabThrottled(windowId);
    await sendToTab(tabId, { action: 'setOverlayVisible', visible: true }).catch(() => {});

    const img   = await dataUrlToImageBitmap(tileUrl);
    const imgH  = img.height;
    const imgW  = img.width;

    if (row === 0) {
      // Primer tile completo
      ctx.drawImage(img, 0, 0);
      nextDrawY = imgH;
    } else {
      const canvasH         = Math.round(capH * dpr);
      const canvasRemaining = canvasH - nextDrawY;
      if (canvasRemaining <= 0) { img.close(); break; }

      // Cuantos px CSS scrolleo este tile vs el anterior
      const scrollDelta   = targetY - prevTargetY;          // en CSS px
      const newPixels     = Math.round(scrollDelta * dpr);  // en device px
      // Esos pixeles nuevos estan al FONDO de la imagen capturada
      const srcY          = imgH - newPixels;
      const pixelsToDraw  = Math.min(newPixels, canvasRemaining);

      if (pixelsToDraw > 0 && srcY >= 0) {
        ctx.drawImage(
          img,
          0, srcY,      imgW, pixelsToDraw,
          0, nextDrawY, imgW, pixelsToDraw
        );
        nextDrawY += pixelsToDraw;
      }
    }
    prevTargetY = targetY;
    img.close();

    await sendToTab(tabId, {
      action: 'showProgress',
      pct:  10 + Math.round(((row + 1) / stepsY) * 85),
      text: `Sección ${row + 1} de ${stepsY}…`
    }).catch(() => {});
  }

  // Restaurar
  await sendToTab(tabId, { action: 'restoreCapture' }).catch(() => {});
  await sendToTab(tabId, { action: 'restoreScroll', x: originalScrollX, y: originalScrollY });
  await sendToTab(tabId, { action: 'showProgress', pct: 99, text: 'Guardando…' }).catch(() => {});
  await sleep(80);
  await sendToTab(tabId, { action: 'hideProgress' }).catch(() => {});

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToBase64(blob);
}
// ─── Utilidades ───────────────────────────────────────────────────────────────

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Convierte dataURL → ImageBitmap usando fetch (disponible en Service Workers)
async function dataUrlToImageBitmap(dataUrl) {
  const res  = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);   // createImageBitmap sí existe en SW
}

// Convierte Blob → dataURL SIN FileReader (que NO existe en Service Workers)
async function blobToBase64(blob) {
  const buffer  = await blob.arrayBuffer();
  const bytes   = new Uint8Array(buffer);
  let   binary  = '';
  // Procesar en chunks para evitar stack overflow en páginas muy grandes
  const CHUNK   = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

// ─── Toast inyectado en la página ─────────────────────────────────────────────
function showPageToast(success, text) {
  const old = document.getElementById('__ss_toast__');
  if (old) old.remove();
  const s = document.createElement('style');
  s.textContent = `@keyframes __ssI__{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`;
  document.head.appendChild(s);
  const t = document.createElement('div');
  t.id = '__ss_toast__';
  t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;
    background:#1a1a2e;border:1px solid ${success?'#6c63ff':'#e05050'};border-radius:10px;
    padding:12px 18px;font-family:sans-serif;font-size:13px;
    box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;
    animation:__ssI__ .25s ease;`;
  t.innerHTML = `<span style="font-size:18px">${success?'📸':'❌'}</span><div>
    <div style="font-weight:600;color:#e8e8f0">${success?'Captura guardada':'Error al capturar'}</div>
    <div style="font-size:11px;color:${success?'#6c63ff':'#e05050'};margin-top:2px">${text}</div></div>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── Helpers nombre de archivo ────────────────────────────────────────────────
let tramitesLiberadosPromise = null;

function getTramitesLiberados() {
  if (!tramitesLiberadosPromise) {
    const jsonUrl = chrome.runtime.getURL('data/tramites_liberados.json');
    tramitesLiberadosPromise = fetch(jsonUrl).then((r) => r.json());
  }
  return tramitesLiberadosPromise;
}

function safeFilenameSegment(value) {
  return String(value)
    .replace(/[^a-z0-9._-]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

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
  if (!Array.isArray(tramites) || !pageUrl) return null;

  // 1) Coincidencia exacta tal cual viene en el JSON.
  const direct = tramites.find((t) => t && t.URL === pageUrl);
  if (direct) return direct;

  // 2) Fallback: misma origin+pathname (sin hash, sin barra final).
  const key = normalizeUrlForTramiteMatch(pageUrl);
  return tramites.find((t) => normalizeUrlForTramiteMatch(t.URL) === key) || null;
}

async function generateFilename(pageUrl) {
  const key   = urlToStorageKey(pageUrl);
  const data  = await chrome.storage.local.get(key);
  const count = (data[key] || 0) + 1;
  await chrome.storage.local.set({ [key]: count });

  let folderPath = '';
  let filenamePrefix = '';
  try {
    const tramites = await getTramitesLiberados();
    const match = findTramiteForUrl(pageUrl, tramites);
    if (match) {
      // En el JSON el campo se llama `departmento`.
      const departamento = match.departmento;
      const idTipoTramite = match.id_tipo_tramite;
      const safeDepartamento = safeFilenameSegment(departamento);
      const safeIdTipoTramite = safeFilenameSegment(idTipoTramite);
      folderPath = `${safeDepartamento}/${safeIdTipoTramite}/`;
      filenamePrefix = `${safeDepartamento}_${safeIdTipoTramite}_`;
    }
  } catch (e) {
    // Si falla la carga del JSON, seguimos con el naming tradicional.
  }

  return `${folderPath}${filenamePrefix}${urlToReadableName(pageUrl)}_${String(count).padStart(3,'0')}.png`;
}

function urlToReadableName(url) {
  try {
    const u    = new URL(url);
    const host = u.hostname.replace('www.','');
    const path = u.pathname.split('/').filter(Boolean).slice(0,2).join('_');
    return (path ? `${host}_${path}` : host)
      .replace(/[^a-z0-9._-]/gi,'_').replace(/_+/g,'_')
      .replace(/^_|_$/g,'').toLowerCase().slice(0,50);
  } catch { return 'screenshot'; }
}

function urlToStorageKey(url) {
  try {
    const u = new URL(url);
    return (u.hostname+u.pathname).replace(/[^a-z0-9]/gi,'_').toLowerCase().slice(0,60);
  } catch { return 'unknown_page'; }
}
