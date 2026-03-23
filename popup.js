// popup.js

let currentTab = null;
let autoInterval = null;
let isAuto = false;
let captureMode = 'full'; // 'full' | 'visible'

function queryActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0] || null);
    });
  });
}

// Obtener pestaña activa al abrir el popup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTab = tabs[0];
    document.getElementById('currentUrl').textContent = currentTab.url;
    updateCounters();
  }
});

// Mostrar el hotkey configurado actualmente
loadHotkeyDisplay();

// Restaurar modo guardado
chrome.storage.local.get('captureMode', (data) => {
  if (data.captureMode) {
    captureMode = data.captureMode;
    updateModeButtons();
  }
});

function loadHotkeyDisplay() {
  chrome.commands.getAll((commands) => {
    const captureCmd = commands.find(c => c.name === 'capture-screenshot');
    const regionCmd = commands.find(c => c.name === 'capture-region');

    renderHotkeyBadge(document.getElementById('hotkeyBadgeCapture'), captureCmd?.shortcut);
    renderHotkeyBadge(document.getElementById('hotkeyBadgeRegion'), regionCmd?.shortcut);
  });
}

function renderHotkeyBadge(badgeEl, shortcut) {
  if (!badgeEl) return;
  if (shortcut) {
    const keys = shortcut.split('+');
    badgeEl.innerHTML = keys.map((k, i) =>
      `<span class="key">${k}</span>${i < keys.length - 1 ? '<span class="key-sep">+</span>' : ''}`
    ).join('');
  } else {
    badgeEl.innerHTML = '<span style="font-size:11px;color:#555;">Sin asignar</span>';
  }
}

// Botón para ir a la página de atajos de Chrome
document.getElementById('btnChangeHotkey').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  window.close();
});

// Selector de modo de captura
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    captureMode = btn.dataset.mode;
    chrome.storage.local.set({ captureMode });
    updateModeButtons();
  });
});

function updateModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === captureMode);
  });
  const btn = document.getElementById('btnCapture');
  btn.textContent = captureMode === 'full' ? '📸 Capturar página completa' : '📸 Capturar visible';
}

// Selección de región
document.getElementById('btnRegion').addEventListener('click', () => {
  queryActiveTab().then((tab) => {
    if (!tab) return;
    currentTab = tab;
    // Enviar mensaje al background para iniciar selector
    chrome.runtime.sendMessage({
      action: 'startRegionCapture',
      tabId:    tab.id,
      windowId: tab.windowId,
      url:      tab.url
    });
  });
  // Escuchar resultado via storage session
  chrome.storage.session.onChanged.addListener(function onCapture(changes) {
    if (changes.lastCapture) {
      chrome.storage.session.onChanged.removeListener(onCapture);
      const result = changes.lastCapture.newValue;
      if (result?.success) {
        updateCounters();
        addToHistory(result.filename);
        showToast(`✅ Región guardada: ${result.filename}`);
      }
    }
  });
  window.close(); // cerrar popup para que el selector sea visible
});

// Capturar al hacer clic
document.getElementById('btnCapture').addEventListener('click', () => {
  captureScreen();
});

// Toggle automático
document.getElementById('btnAutoToggle').addEventListener('click', () => {
  isAuto = !isAuto;
  const toggle = document.getElementById('toggleAuto');
  const intervalRow = document.getElementById('intervalRow');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  toggle.classList.toggle('on', isAuto);
  intervalRow.classList.toggle('visible', isAuto);

  if (isAuto) {
    const secs = parseInt(document.getElementById('intervalSecs').value) || 10;
    statusDot.classList.add('active');
    statusText.textContent = `Auto cada ${secs}s`;
    autoInterval = setInterval(() => captureScreen(true), secs * 1000);
    showToast(`⏱ Captura automática: cada ${secs} segundos`);
  } else {
    clearInterval(autoInterval);
    statusDot.classList.remove('active');
    statusText.textContent = 'Listo';
    showToast('Captura automática detenida');
  }
});

// Limpiar contadores
document.getElementById('btnClear').addEventListener('click', () => {
  chrome.storage.local.clear(() => {
    updateCounters();
    document.getElementById('historyList').innerHTML =
      '<div style="font-size:11px;color:#444;">Sin capturas aún</div>';
    showToast('Contadores limpiados');
  });
});

// Función principal de captura
async function captureScreen(isAutoCapture = false) {
  const tab = await queryActiveTab();
  if (!tab) return;
  currentTab = tab;

  const btn = document.getElementById('btnCapture');
  if (!isAutoCapture) {
    btn.disabled = true;
    btn.textContent = captureMode === 'full' ? '⏳ Capturando página...' : '⏳ Capturando...';
  }

  chrome.runtime.sendMessage(
    { action: 'capture', tabId: tab.id, windowId: tab.windowId, url: tab.url, mode: captureMode },
    (response) => {
      if (response && response.success) {
        updateCounters();
        addToHistory(response.filename);
        showToast(`✅ Guardado: ${response.filename}`);
      } else {
        const err = response?.error || 'Error desconocido';
        showToast(`❌ ${err}`);
        console.error('[Screenshot popup]', err);
      }

      if (!isAutoCapture) {
        btn.disabled = false;
        updateModeButtons();
      }
    }
  );
}

// Actualizar contadores desde storage
function updateCounters() {
  chrome.storage.local.get(null, (data) => {
    const url = currentTab?.url || '';
    const urlKey = urlToKey(url);
    const urlCount = data[urlKey] || 0;
    const total = Object.values(data)
      .filter(v => typeof v === 'number')
      .reduce((a, b) => a + b, 0);

    document.getElementById('countUrl').textContent = urlCount;
    document.getElementById('countTotal').textContent = total;
  });
}

// Agregar al historial visual
function addToHistory(filename) {
  const list = document.getElementById('historyList');
  const noCaptures = list.querySelector('div');
  if (noCaptures && noCaptures.style.color === 'rgb(68, 68, 68)') {
    list.innerHTML = '';
  }

  const item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = `
    <div class="history-dot"></div>
    <span class="history-name">${filename}</span>
  `;
  list.insertBefore(item, list.firstChild);

  // Mantener máximo 5 en el historial visual
  while (list.children.length > 5) {
    list.removeChild(list.lastChild);
  }
}

// Mostrar toast de notificación
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// Convertir URL a clave limpia para storage
function urlToKey(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 60);
  } catch {
    return 'unknown_page';
  }
}
