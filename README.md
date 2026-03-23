# Auto Screenshot Saver — Extensión de Chrome

Captura y guarda automáticamente screenshots con el nombre de la URL activa y un consecutivo.

## Ejemplos de nombres generados

| URL visitada | Archivo guardado |
|---|---|
| `https://github.com/usuario/repo` | `github.com_usuario_repo_001.png` |
| `https://github.com/usuario/repo` | `github.com_usuario_repo_002.png` |
| `https://news.ycombinator.com/` | `news.ycombinator.com_001.png` |
| `https://example.com/blog/post-1` | `example.com_blog_post-1_001.png` |

Todos los archivos se guardan en la carpeta `screenshots/` dentro de tu carpeta de Descargas.

---

## Instalación (modo desarrollador)

1. **Descarga o clona** esta carpeta con todos los archivos
2. Crea una carpeta `icons/` y agrega íconos PNG de 16x16, 48x48 y 128x128 px
   - Puedes usar cualquier imagen PNG y renombrarla `icon16.png`, `icon48.png`, `icon128.png`
   - O generar íconos simples online en: https://favicon.io
3. Abre Chrome y ve a: `chrome://extensions/`
4. Activa **"Modo desarrollador"** (toggle arriba a la derecha)
5. Haz clic en **"Cargar descomprimida"**
6. Selecciona esta carpeta completa
7. ¡Listo! El ícono aparecerá en la barra del navegador

---

## Estructura de archivos

```
chrome-screenshot-extension/
├── manifest.json       ← Configuración y permisos
├── background.js       ← Lógica de captura y descarga
├── popup.html          ← Interfaz del popup
├── popup.js            ← Lógica del popup
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Funciones

- **Captura manual**: Botón "Capturar ahora"
- **Captura automática**: Toggle con intervalo configurable en segundos
- **Consecutivo por URL**: Cada dominio/ruta tiene su propio contador independiente
- **Historial**: Muestra las últimas 5 capturas en el popup
- **Limpiar contadores**: Botón para resetear todos los consecutivos

---

## Posibles mejoras

- Capturar página completa (no solo la parte visible) usando la librería `html2canvas`
- Exportar a otros formatos (JPEG, WebP)
- Elegir carpeta de destino personalizada
- Modo "observar cambios": solo captura si la página cambió visualmente
- Subir directamente a Google Drive o Dropbox vía API
