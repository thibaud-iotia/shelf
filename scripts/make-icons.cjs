// Renders the app and tray icons from the Certflix brand (logo "S" of the sidebar).
// Run with Electron so the real Space Grotesk font is used:
//   npx electron scripts/make-icons.cjs
// Outputs to resources/: icon.png (1024), tray.png (32), trayTemplate[@2x].png (macOS).

const { app, BrowserWindow } = require('electron')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const root = resolve(__dirname, '..')
const out = join(root, 'resources')
const font = pathToFileURL(join(root, 'src/renderer/src/assets/fonts/space-grotesk-latin.woff2'))

// Drawn on a canvas (transparent background), exported as a PNG data URL.
const draw = `async (size, template) => {
  const face = new FontFace('SG', 'url(${font})', { weight: '700' })
  await face.load()
  document.fonts.add(face)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const inset = template ? 0 : size * 0.06
  const box = size - inset * 2
  if (!template) {
    const gradient = ctx.createLinearGradient(inset, inset, inset + box, inset + box)
    gradient.addColorStop(0, '#FF5A70')
    gradient.addColorStop(1, '#F5254A')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.roundRect(inset, inset, box, box, box * 0.24)
    ctx.fill()
  }
  ctx.fillStyle = template ? '#000' : '#fff'
  ctx.font = '700 ' + Math.round(size * (template ? 0.95 : 0.62)) + 'px SG'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText('S')
  const y = size / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
  ctx.fillText('S', size / 2, y)
  return canvas.toDataURL('image/png')
}`

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true })
  const win = new BrowserWindow({ show: false })
  const html = join(app.getPath('temp'), 'shelf-icon.html')
  writeFileSync(html, '<!doctype html><html><body></body></html>')
  await win.loadFile(html)
  const files = [
    ['icon.png', 1024, false],
    ['tray.png', 32, false],
    ['trayTemplate.png', 22, true],
    ['trayTemplate@2x.png', 44, true]
  ]
  for (const [name, size, template] of files) {
    const dataUrl = await win.webContents.executeJavaScript(`(${draw})(${size}, ${template})`)
    writeFileSync(join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'))
    console.log('wrote', name)
  }
  app.quit()
})
