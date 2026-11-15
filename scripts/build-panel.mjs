#!/usr/bin/env node
/**
 * Build the web app and deploy the result into the DSH panel plugin.
 *
 * Two accidents this script exists to prevent:
 *   1. Building but forgetting to copy: the plugin serves its own
 *      integration/dsh-chat-demo/dist, so a fresh root dist alone changes nothing
 *      and the panel keeps showing the previous build.
 *   2. Serving a stale build: old hashed assets left behind in the plugin dist
 *      keep answering requests for hashed URLs, and the panel can come up from
 *      an index.html that predates the branch that was just built.
 *
 * Usage: pnpm build:panel
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'dist')
const target = join(root, 'integration', 'dsh-chat-demo', 'dist')

const run = (args) => {
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) {
    console.error(`\nbuild:panel — command failed: npx ${args.join(' ')}`)
    process.exit(result.status ?? 1)
  }
}

rmSync(source, { recursive: true, force: true })
run(['rspack', 'build', '-c', 'rspack.config.ts'])

if (!existsSync(source)) {
  console.error('build:panel — rspack reported success but dist/ is missing')
  process.exit(1)
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })

const index = join(target, 'index.html')
if (!existsSync(index)) {
  console.error('build:panel — copied dist has no index.html')
  process.exit(1)
}
const html = readFileSync(index, 'utf8')
const assets = [...html.matchAll(/static\/(?:js|css)\/main\.[a-f0-9]+\.(?:js|css)/g)].map((m) => m[0])
const missing = assets.filter((asset) => !existsSync(join(target, asset)))
if (assets.length === 0 || missing.length > 0) {
  console.error(`build:panel — index.html references assets that were not copied: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`\nbuild:panel — deployed to ${target}`)
for (const asset of assets) console.log(`  ${asset}  ${statSync(join(target, asset)).size} bytes`)