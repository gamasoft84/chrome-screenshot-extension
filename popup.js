// popup.js

let currentTab = null;
let autoInterval = null;
let isAuto = false;

// Obtener pestaña activa al abrir el popup
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTab = tabs[0];
    document.getElementById('currentUrl').textContent = currentTab.url;
    updateCounters();
  }
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
function captureScreen(isAutoCapture = false) {
  if (!currentTab) return;

  const btn = document.getElementById('btnCapture');
  if (!isAutoCapture) {
    btn.disabled = true;
    btn.textContent = '⏳ Capturando...';
  }

  // Enviar mensaje al background script
  chrome.runtime.sendMessage(
    { action: 'capture', tabId: currentTab.id, url: currentTab.url },
    (response) => {
      if (response && response.success) {
        updateCounters();
        addToHistory(response.filename);
        showToast(`✅ Guardado: ${response.filename}`);
      } else {
        showToast('❌ Error al capturar');
      }

      if (!isAutoCapture) {
        btn.disabled = false;
        btn.textContent = '📸 Capturar ahora';
      }
    }
  );
}

// Actualizar contadores desde storage
function updateCounters() {
  chrome.storage.local.get(null, (data) => {
    const urlKey = urlToKey(currentTab?.url || '');
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
