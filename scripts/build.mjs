#!/usr/bin/env node
/**
 * 生产构建：清掉 dist，再以 NODE_ENV=production 跑 rspack。
 *
 * 原来 package.json 里写的是 `rm -rf dist && NODE_ENV=production rspack build`，
 * 这是 POSIX 写法；Windows 的 cmd 不认 `NODE_ENV=... ` 这种前置赋值，构建会直接失败。
 * 这里改用和 build-panel.mjs 一样的做法：用 Node 删目录、把 NODE_ENV 放进子进程环境，
 * 两个平台的行为就一致了。
 *
 * 用法: npm run build
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

rmSync(join(root, 'dist'), { recursive: true, force: true })

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['rspack', 'build', '-c', 'rspack.config.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
    shell: process.platform === 'win32',
  }
)

if (result.status !== 0) {
  console.error('\nbuild — rspack failed')
}
process.exit(result.status ?? 1)
