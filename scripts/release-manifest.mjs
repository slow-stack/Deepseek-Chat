#!/usr/bin/env node
/**
 * 发版清单生成：算 APK 的 sha256 与字节数，写进 release/latest.json。
 *
 * 手抄 sha256 迟早出错，一错就是「校验失败装不上」，所以这一步跟着 APK 一起出来：
 *
 *   node scripts/release-manifest.mjs --apk <apk 路径> --version 0.2.4
 *
 * 只改 versionName / downloadUrl / sha256 / size 四个字段；
 * highlights 与 notes 是人工写的，脚本不碰。不改就传 --dry-run 先看看会写成什么。
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = resolve(HERE, '..', 'release', 'latest.json')
const REPO = 'slow-stack/Deepseek-Chat'

/** 边读边算，不把 7 MB 全塞进内存 */
const sha256Of = (path) =>
  new Promise((resolveHash, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })

const parseArgs = (argv) => {
  const options = { dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--apk') {
      options.apk = argv[++i]
    } else if (arg === '--version') {
      options.version = argv[++i]
    } else if (arg === '--manifest') {
      options.manifest = argv[++i]
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }
  return options
}

const usage = `用法:
  node scripts/release-manifest.mjs --apk <apk 路径> --version <版本号> [--manifest <latest.json>] [--dry-run]

说明:
  --apk       打完的 APK，用来算 sha256 与字节数
  --version   版本号（不带 v），如 0.2.4；downloadUrl 会自动指向这个 tag 的附件
  --manifest  要改的清单，默认 release/latest.json
  --dry-run   只打印会写成什么，不落盘
`

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(usage)
    return
  }
  if (!options.apk) {
    process.stderr.write('缺少 --apk\n\n' + usage)
    process.exitCode = 2
    return
  }

  const apkPath = resolve(process.cwd(), options.apk)
  const manifestPath = options.manifest ? resolve(process.cwd(), options.manifest) : MANIFEST

  const apkStat = await stat(apkPath).catch(() => null)
  if (!apkStat || !apkStat.isFile()) {
    process.stderr.write(`找不到 APK: ${apkPath}\n`)
    process.exitCode = 2
    return
  }
  if (!/\.apk$/i.test(apkPath)) {
    process.stderr.write(`这不是 APK 文件: ${apkPath}\n`)
    process.exitCode = 2
    return
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const version = options.version ?? manifest.versionName
  if (!version || typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version)) {
    process.stderr.write(`版本号不合法: ${version}\n`)
    process.exitCode = 2
    return
  }

  const sha256 = await sha256Of(apkPath)
  const size = apkStat.size
  const fileName = apkPath.split(/[\\/]/).pop()
  const next = {
    ...manifest,
    versionName: version,
    downloadUrl: `https://github.com/${REPO}/releases/download/v${version}/${fileName}`,
    sha256,
    size,
  }

  process.stdout.write(
    [
      `APK        ${fileName}`,
      `字节数     ${size}`,
      `SHA-256    ${sha256}`,
      `版本号     ${version}`,
      `下载地址   ${next.downloadUrl}`,
      '',
    ].join('\n')
  )

  if (options.dryRun) {
    process.stdout.write('--dry-run：没有写入。\n')
    return
  }
  await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  process.stdout.write(`已写入 ${manifestPath}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error?.message ?? error}\n`)
  process.exitCode = 1
})
