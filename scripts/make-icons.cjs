// Renders the app and tray icons: a games shelf (three cases standing on a plank, one coral
// case leaning against them with a gamepad), in the Certflix palette (ink + coral).
// Drawn as SVG and rasterized by Electron at each target size (crisp at every size):
//   npm run icons
// Outputs to resources/: icon.png (1024), tray.png (32), trayTemplate[@2x].png (macOS);
// and the sidebar logo to src/renderer/src/assets/logo.png (96, i.e. 32 px at 3x).

const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const out = join(root, 'resources')
const assets = join(root, 'src/renderer/src/assets')

// Case spines, left to right: [x, top, width, color]. All stand on the plank (y = 724).
const SPINES = [
  [200, 350, 104, '#363C55'],
  [316, 290, 104, '#4A4568'],
  [432, 322, 112, '#5A5F80']
]

function spine([x, top, w, color]) {
  const h = 724 - top
  return `
    <g>
      <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="14" fill="${color}"/>
      <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="14" fill="url(#spineShade)"/>
      <rect x="${x + 16}" y="${top + 46}" width="${w - 32}" height="56" rx="8" fill="#fff" fill-opacity=".12"/>
      <rect x="${x + 16}" y="${top + 120}" width="${(w - 32) * 0.6}" height="12" rx="6" fill="#fff" fill-opacity=".08"/>
      <rect x="${x + 16}" y="${724 - 84}" width="${w - 32}" height="14" rx="7" fill="#fff" fill-opacity=".07"/>
    </g>`
}

// Full-detail icon (1024 viewBox). `cropped` drops the transparent margin around the tile
// (in-app logo, where the tile fills its box).
function appIcon(size, cropped = false) {
  const viewBox = cropped ? '56 56 912 912' : '0 0 1024 1024'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#272739"/>
      <stop offset="1" stop-color="#0B0B12"/>
    </linearGradient>
    <radialGradient id="glow" cx=".66" cy=".46" r=".5">
      <stop offset="0" stop-color="#F5254A" stop-opacity=".42"/>
      <stop offset=".55" stop-color="#F5254A" stop-opacity=".1"/>
      <stop offset="1" stop-color="#F5254A" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="coral" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF7487"/>
      <stop offset="1" stop-color="#E41C41"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
      <stop offset=".45" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="spineShade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity=".10"/>
      <stop offset=".25" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".18"/>
    </linearGradient>
    <linearGradient id="plank" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6A6A8C"/>
      <stop offset="1" stop-color="#34344A"/>
    </linearGradient>
    <filter id="drop" x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000" flood-opacity=".5"/>
    </filter>
    <filter id="blur" x="-20%" y="-200%" width="140%" height="500%">
      <feGaussianBlur stdDeviation="18"/>
    </filter>
    <mask id="pad" maskUnits="userSpaceOnUse" x="-20" y="-320" width="260" height="170">
      <rect x="40" y="-288" width="152" height="74" rx="37" fill="#fff"/>
      <circle cx="66" cy="-212" r="27" fill="#fff"/>
      <circle cx="166" cy="-212" r="27" fill="#fff"/>
      <rect x="62" y="-257" width="34" height="12" rx="4" fill="#000"/>
      <rect x="73" y="-268" width="12" height="34" rx="4" fill="#000"/>
      <circle cx="152" cy="-259" r="8" fill="#000"/>
      <circle cx="168" cy="-243" r="8" fill="#000"/>
    </mask>
    <clipPath id="tile"><rect x="56" y="56" width="912" height="912" rx="210"/></clipPath>
  </defs>

  <rect x="56" y="56" width="912" height="912" rx="210" fill="url(#bg)"/>
  <g clip-path="url(#tile)">
    <rect x="0" y="0" width="1024" height="1024" fill="url(#glow)"/>
    <ellipse cx="512" cy="786" rx="360" ry="26" fill="#000" fill-opacity=".55" filter="url(#blur)"/>
  </g>
  <rect x="58" y="58" width="908" height="908" rx="208" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="4"/>

  <g filter="url(#drop)">
    ${SPINES.map(spine).join('')}
    <g transform="translate(600 722) rotate(-8)">
      <rect x="0" y="-470" width="210" height="470" rx="22" fill="url(#coral)"/>
      <rect x="0" y="-470" width="26" height="470" rx="13" fill="#000" fill-opacity=".14"/>
      <rect x="0" y="-470" width="210" height="470" rx="22" fill="url(#sheen)"/>
      <rect x="-20" y="-320" width="260" height="170" fill="#fff" mask="url(#pad)"/>
    </g>
    <rect x="168" y="716" width="688" height="42" rx="14" fill="url(#plank)"/>
    <rect x="180" y="719" width="664" height="5" rx="2.5" fill="#fff" fill-opacity=".22"/>
  </g>
</svg>`
}

// Simplified glyph for tiny sizes (100 viewBox), one color.
function glyph(color) {
  return `
    <g fill="${color}">
      <rect x="16" y="24" width="14" height="54" rx="3"/>
      <rect x="34" y="31" width="14" height="47" rx="3"/>
      <g transform="translate(60 77) rotate(-12)">
        <rect x="0" y="-50" width="22" height="50" rx="3.5"/>
      </g>
      <rect x="10" y="76" width="80" height="9" rx="3"/>
    </g>`
}

function trayIcon(size, template) {
  const body = template
    ? glyph('#000')
    : `<defs>
        <linearGradient id="c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FF5A70"/><stop offset="1" stop-color="#F5254A"/>
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="94" height="94" rx="24" fill="url(#c)"/>
      <g transform="translate(50 53) scale(.8) translate(-50 -53)">${glyph('#fff')}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">${body}</svg>`
}

// Runs in the page: rasterizes an SVG string onto a transparent canvas, returns a PNG data URL.
const rasterize = `async (svg, size) => {
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  canvas.getContext('2d').drawImage(img, 0, 0, size, size)
  return canvas.toDataURL('image/png')
}`

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true })
  const win = new BrowserWindow({ show: false })
  const html = join(app.getPath('temp'), 'shelf-icon.html')
  writeFileSync(html, '<!doctype html><html><body></body></html>')
  await win.loadFile(html)
  const files = [
    [join(out, 'icon.png'), 1024, appIcon(1024)],
    [join(out, 'tray.png'), 32, trayIcon(32, false)],
    [join(out, 'trayTemplate.png'), 22, trayIcon(22, true)],
    [join(out, 'trayTemplate@2x.png'), 44, trayIcon(44, true)],
    [join(assets, 'logo.png'), 96, appIcon(96, true)]
  ]
  for (const [file, size, svg] of files) {
    const dataUrl = await win.webContents.executeJavaScript(
      `(${rasterize})(${JSON.stringify(svg)}, ${size})`
    )
    writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('wrote', file)
  }
  app.quit()
})
