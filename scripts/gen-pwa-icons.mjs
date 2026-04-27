// Rasterize the PWA SVG icons into PNG so Android Chrome's installability
// check (which requires PNG) passes. Run via `node scripts/gen-pwa-icons.mjs`.
import sharp from 'sharp'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

async function rasterize(svgName, pngName, size) {
  const svg = await readFile(resolve(publicDir, svgName))
  const png = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer()
  await writeFile(resolve(publicDir, pngName), png)
  console.log(`✓ ${pngName} (${size}x${size})`)
}

await rasterize('icon-192.svg', 'icon-192.png', 192)
await rasterize('icon-512.svg', 'icon-512.png', 512)
await rasterize('icon-maskable.svg', 'icon-maskable-512.png', 512)
await rasterize('icon-512.svg', 'apple-touch-icon.png', 180)
