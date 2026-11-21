import { nativeImage } from 'electron'
import { limiter } from '../store/cache'
import {
  fitWithin,
  hasTransparency,
  JPEG_QUALITY,
  outputFormat,
  type ImageShrinker
} from './shrink-policy'

// Electron's image codec (PNG and JPEG; other formats are kept as downloaded). Decoding runs
// on the main process: one image at a time, yielding in between so IPC stays responsive.

const oneAtATime = limiter(1)
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve))

export const shrinkWithNativeImage: ImageShrinker = (data, kind) =>
  oneAtATime(async () => {
    await yieldToEventLoop()
    const image = nativeImage.createFromBuffer(Buffer.from(data))
    if (image.isEmpty()) return null
    const size = image.getSize()
    const target = fitWithin(size.width, size.height, kind)
    const resized = target ? image.resize({ ...target, quality: 'best' }) : image
    const format = outputFormat(kind, hasTransparency(resized.toBitmap()))
    // An image already in place (right size, same format) is kept untouched.
    if (!target && format === 'png' && isPng(data)) return null
    if (!target && format === 'jpeg' && isJpeg(data)) return null
    const encoded = format === 'png' ? resized.toPNG() : resized.toJPEG(JPEG_QUALITY)
    if (encoded.length >= data.length) return null
    return { data: encoded, extension: format === 'png' ? '.png' : '.jpg' }
  })

const isPng = (data: Uint8Array) => data[0] === 0x89 && data[1] === 0x50
const isJpeg = (data: Uint8Array) => data[0] === 0xff && data[1] === 0xd8
