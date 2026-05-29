import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// 构建 Electron 主进程
await esbuild.build({
  entryPoints: [resolve(root, 'electron/main.ts')],
  outfile: resolve(root, 'dist-electron/main.cjs'),
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  bundle: true,
  external: ['electron', 'sql.js'],
  minify: false,
  sourcemap: false,
})

// 构建 Preload 脚本
await esbuild.build({
  entryPoints: [resolve(root, 'electron/preload.ts')],
  outfile: resolve(root, 'dist-electron/preload.cjs'),
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  minify: false,
  sourcemap: false,
})

console.log('✓ Electron build complete')
