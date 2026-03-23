// content_capture.js
// Captura: URL banner + header + body, sin footer ni elementos fixed/sticky.

(function () {
  if (window.__screenshotListenerAttached__) return;
  window.__screenshotListenerAttached__ = true;

  let hiddenElements = [];  // elementos ocultados temporalmente
  let overlayEl      = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === 'prepareCapture') {
      const result = prepareCapture();
      sendResponse(result);
      return true;
    }

    if (message.action === 'restoreCapture') {
      restoreCapture();
      sendResponse({ done: true });
      return true;
    }

    if (message.action === 'getPageDimensions') {
      sendResponse({
        scrollWidth:    document.documentElement.scrollWidth,
        scrollHeight:   document.documentElement.scrollHeight,
        viewportWidth:  window.innerWidth,
        viewportHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        originalScrollX: window.scrollX,
        originalScrollY: window.scrollY
      });
      return true;
    }

    if (message.action === 'scrollTo') {
      window.scrollTo(message.x, message.y);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        sendResponse({ done: true, actualX: window.scrollX, actualY: window.scrollY });
      }));
      return true;
    }

    if (message.action === 'restoreScroll') {
      window.scrollTo(message.x, message.y);
      sendResponse({ done: true });
      return true;
    }

    if (message.action === 'showProgress') {
      showOverlay(message.pct, message.text);
      sendResponse({ done: true });
      return true;
    }

    if (message.action === 'hideProgress') {
      hideOverlay();
      sendResponse({ done: true });
      return true;
    }

    if (message.action === 'setOverlayVisible') {
      if (overlayEl) overlayEl.style.display = message.visible ? 'flex' : 'none';
      sendResponse({ done: true });
      return true;
    }
  });

  // ── Preparar DOM para captura limpia ─────────────────────────────────────
  function prepareCapture() {
    hiddenElements = [];

    const all = Array.from(document.querySelectorAll('*'));

    for (const el of all) {
      if (el.id === '__ss_overlay__' || el.id === '__ss_urlbar__') continue;

      const tag      = el.tagName.toLowerCase();
      const computed = getComputedStyle(el);
      const pos      = computed.position;
      const display  = computed.display;
      if (display === 'none') continue;

      // 1. Ocultar footers por tag semántico o clases/ids comunes
      const isFooter = tag === 'footer'
        || /\b(footer|pie|bottom-bar|site-footer|page-footer)\b/i.test(el.id + ' ' + el.className);

      // 2. Ocultar todos los fixed y sticky (headers flotantes, cookie banners, chat widgets…)
      const isFloating = (pos === 'fixed' || pos === 'sticky');

      if (isFooter || isFloating) {
        hiddenElements.push({ el, originalDisplay: el.style.display });
        el.style.setProperty('display', 'none', 'important');
      }
    }

    // 3. Inyectar banda de URL en la parte superior
    injectUrlBar();

    // Devolver altura limpia del documento tras ocultar elementos
    return {
      cleanHeight: document.documentElement.scrollHeight,
      cleanWidth:  document.documentElement.scrollWidth,
      hiddenCount: hiddenElements.length
    };
  }

  function restoreCapture() {
    // Restaurar elementos ocultos
    for (const { el, originalDisplay } of hiddenElements) {
      el.style.display = originalDisplay;
    }
    hiddenElements = [];

    // Quitar banda URL
    const bar = document.getElementById('__ss_urlbar__');
    if (bar) bar.remove();
    const style = document.getElementById('__ss_urlbar_style__');
    if (style) style.remove();
  }

  function injectUrlBar() {
    const existing = document.getElementById('__ss_urlbar__');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = '__ss_urlbar_style__';
    style.textContent = `
      #__ss_urlbar__ {
        display: flex !important;
        align-items: center;
        gap: 8px;
        padding: 7px 14px;
        background: #1a1a2e;
        border-bottom: 2px solid #6c63ff;
        font-family: monospace;
        font-size: 12px;
        color: #a78bfa;
        position: relative;
        z-index: 2147483646;
        box-sizing: border-box;
        width: 100%;
      }
      #__ss_urlbar__ .ss-icon { font-size: 14px; flex-shrink: 0; }
      #__ss_urlbar__ .ss-url  { color: #e8e8f0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #__ss_urlbar__ .ss-ts   { margin-left: auto; flex-shrink: 0; color: #555; font-size: 11px; }
    `;
    document.head.appendChild(style);

    const now = new Date();
    const ts  = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const bar = document.createElement('div');
    bar.id = '__ss_urlbar__';
    bar.innerHTML = `
      <span class="ss-icon">📸</span>
      <span class="ss-url">${location.href}</span>
      <span class="ss-ts">${ts}</span>
    `;

    // Insertar como primer hijo del body
    document.body.insertBefore(bar, document.body.firstChild);
  }

  // ── Overlay de progreso ──────────────────────────────────────────────────
  function showOverlay(pct, text) {
    if (!overlayEl) {
      const style = document.createElement('style');
      style.id = '__ss_style__';
      style.textContent = `@keyframes __ssIn__{from{opacity:0}to{opacity:1}}#__ss_overlay__{animation:__ssIn__ 0.2s ease}`;
      document.head.appendChild(style);

      overlayEl = document.createElement('div');
      overlayEl.id = '__ss_overlay__';
      overlayEl.style.cssText = `
        position:fixed;inset:0;z-index:2147483647;
        background:rgba(10,10,20,0.78);
        display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;pointer-events:none;`;
      overlayEl.innerHTML = `
        <div style="background:#1a1a2e;border:1px solid #6c63ff;border-radius:14px;
                    padding:24px 36px;text-align:center;min-width:230px;">
          <div style="font-size:30px;margin-bottom:10px;">📸</div>
          <div id="__ss_text__" style="font-size:13px;font-weight:600;color:#e8e8f0;margin-bottom:14px;">Preparando…</div>
          <div style="background:#0f0f13;border-radius:6px;overflow:hidden;height:6px;width:190px;margin:0 auto;">
            <div id="__ss_bar__" style="height:100%;width:0%;background:linear-gradient(90deg,#6c63ff,#a78bfa);transition:width 0.25s ease;border-radius:6px;"></div>
          </div>
          <div id="__ss_pct__" style="font-size:11px;color:#6c63ff;margin-top:8px;">0%</div>
        </div>`;
      document.body.appendChild(overlayEl);
    }
    const b = document.getElementById('__ss_bar__');
    const p = document.getElementById('__ss_pct__');
    const t = document.getElementById('__ss_text__');
    if (b) b.style.width  = pct + '%';
    if (p) p.textContent  = pct + '%';
    if (t && text) t.textContent = text;
  }

  function hideOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    const s = document.getElementById('__ss_style__');
    if (s) s.remove();
  }
})();
