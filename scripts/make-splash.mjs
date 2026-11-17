#!/usr/bin/env node
/**
 * 生成 iOS 主屏启动图（apple-touch-startup-image）。
 *
 * 为什么需要：iOS 从主屏启动时不吃 manifest 的 background_color，App 起来之前
 * 会先铺一层白，夜里看就是一下白闪。给这几个尺寸各配一张深色图，把这段盖住。
 *
 * 图里只放开屏那只鲸鱼，不放名字：index.html 的开屏是图形先到位、名字再淡入，
 * 启动图里若先画上名字，交接时名字会先消失再淡回来，闪一下。只留图形，启动图退场
 * 与开屏进场位置重合，看不出接缝。
 *
 * 只做 4 个常见尺寸的竖屏（Amarre 定的量），其它机型与横屏启动退回系统默认底色。
 * 需要 ImageMagick。
 *
 * 用到的鲸鱼图在 scripts/assets/whale-mark.png，和 public/icons/boot-mark.png 是同一张。
 *
 * 用法: node scripts/make-splash.mjs
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'public', 'icons')
const markPath = join(root, 'scripts', 'assets', 'whale-mark.png')

/** 与 manifest 的 background_color、index.html 的 html[data-boot='dark'] 一致 */
const BG = '#131315'

/**
 * (width, height, ratio) 决定 device-width / device-height 的 media query，
 * 必须与 src/index.html 里写的完全一致。
 */
const TARGETS = [
  { w: 430, h: 932, ratio: 3, note: 'iPhone 15/14 Pro Max' },
  { w: 393, h: 852, ratio: 3, note: 'iPhone 15/14 Pro' },
  { w: 390, h: 844, ratio: 3, note: 'iPhone 13/12' },
  { w: 414, h: 896, ratio: 2, note: 'iPhone 11 / XR' },
]

/** index.html 里 .boot-mark 是 165x120（比例同原图 400x291），居中 */
const MARK_W = 165
const MARK_H = 120

/** 按 390pt 宽的开屏排版算比例 */
const BASE_W = 390

for (const target of TARGETS) {
  const pxW = target.w * target.ratio
  const pxH = target.h * target.ratio
  const s = (target.w / BASE_W) * target.ratio

  const markW = Math.round(MARK_W * s)
  const markH = Math.round(MARK_H * s)
  const x = Math.round((pxW - markW) / 2)
  const y = Math.round((pxH - markH) / 2)

  const name = `splash-${pxW}x${pxH}.png`
  const pngPath = join(outDir, name)

  // 纯色底 + 一小块图形，压成 8 位调色板 PNG 肉眼无损；64 色够放下鲸鱼的过渡，
  // 32 色在深底上会出阶梯。
  const render = spawnSync(
    'magick',
    [
      '-size',
      `${pxW}x${pxH}`,
      `xc:${BG}`,
      '(',
      markPath,
      '-resize',
      `${markW}x${markH}!`,
      ')',
      '-geometry',
      `+${x}+${y}`,
      '-composite',
      '-strip',
      '-colors',
      '64',
      `PNG8:${pngPath}`,
    ],
    { encoding: 'utf8', shell: false }
  )
  if (render.status !== 0) {
    console.error(`make-splash — ${name} 渲染失败\n${render.stderr ?? ''}`)
    process.exit(render.status ?? 1)
  }

  console.log(`${name}  ${target.w}x${target.h}@${target.ratio}x  mark ${markW}x${markH}  ${target.note}`)
}
