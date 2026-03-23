// region_selector.js
// Inyectado en la página para permitir seleccionar una región con el mouse.
// Devuelve { x, y, width, height } en coordenadas de página (con scroll).

(function () {
  if (document.getElementById('__ss_region_overlay__')) return;

  let startX, startY, isDragging = false;

  // ── Overlay oscuro que cubre toda la página ──────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__ss_region_overlay__';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2147483647;
    background: rgba(0,0,0,0.45);
    cursor: crosshair;
    user-select: none;
  `;

  // ── Tooltip de instrucción ───────────────────────────────────────────────
  const tip = document.createElement('div');
  tip.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: #1a1a2e; border: 1px solid #6c63ff; border-radius: 8px;
    padding: 8px 18px; font-family: sans-serif; font-size: 13px;
    color: #e8e8f0; pointer-events: none; white-space: nowrap;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  `;
  tip.textContent = '📐 Arrastra para seleccionar la región — ESC para cancelar';
  overlay.appendChild(tip);

  // ── Rectángulo de selección ──────────────────────────────────────────────
  const rect = document.createElement('div');
  rect.style.cssText = `
    position: fixed; border: 2px solid #6c63ff;
    background: rgba(108,99,255,0.12);
    box-shadow: 0 0 0 1px rgba(108,99,255,0.4);
    pointer-events: none; display: none;
    box-sizing: border-box;
  `;
  overlay.appendChild(rect);

  // ── Label de dimensiones ─────────────────────────────────────────────────
  const label = document.createElement('div');
  label.style.cssText = `
    position: fixed; background: #6c63ff; color: #fff;
    font-family: monospace; font-size: 11px; padding: 2px 6px;
    border-radius: 3px; pointer-events: none; display: none;
  `;
  overlay.appendChild(label);

  document.body.appendChild(overlay);

  // ── Eventos de mouse ─────────────────────────────────────────────────────
  overlay.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    rect.style.display = 'block';
    label.style.display = 'block';
    updateRect(e.clientX, e.clientY);
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    updateRect(e.clientX, e.clientY);
  });

  overlay.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;

    const x1 = Math.min(startX, e.clientX);
    const y1 = Math.min(startY, e.clientY);
    const x2 = Math.max(startX, e.clientX);
    const y2 = Math.max(startY, e.clientY);
    const w  = x2 - x1;
    const h  = y2 - y1;

    cleanup();

    if (w < 10 || h < 10) {
      // Selección demasiado pequeña, cancelar
      chrome.runtime.sendMessage({ action: 'regionSelected', cancelled: true });
      return;
    }

    // Coordenadas absolutas en la página (incluye scroll actual)
    chrome.runtime.sendMessage({
      action: 'regionSelected',
      cancelled: false,
      region: {
        x:      Math.round(x1),
        y:      Math.round(y1),
        width:  Math.round(w),
        height: Math.round(h),
        dpr:    window.devicePixelRatio || 1
      }
    });
  });

  // ESC para cancelar
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', onKey);
      chrome.runtime.sendMessage({ action: 'regionSelected', cancelled: true });
    }
  });

  function updateRect(cx, cy) {
    const x1 = Math.min(startX, cx);
    const y1 = Math.min(startY, cy);
    const w  = Math.abs(cx - startX);
    const h  = Math.abs(cy - startY);

    rect.style.left   = x1 + 'px';
    rect.style.top    = y1 + 'px';
    rect.style.width  = w  + 'px';
    rect.style.height = h  + 'px';

    label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
    label.style.left  = (x1 + w + 6) + 'px';
    label.style.top   = (y1 + h + 4) + 'px';
  }

  function cleanup() {
    overlay.remove();
  }
})();
