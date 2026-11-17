#!/usr/bin/env node
/**
 * 生成 iOS 主屏启动图（apple-touch-startup-image）。
 *
 * 为什么需要：iOS 从主屏启动时不吃 manifest 的 background_color，App 起来之前
 * 会先铺一层白，夜里看就是一下白闪。给这几个尺寸各配一张深色图，把这段盖住。
 *
 * 图里只画开屏那个气泡图形，不画名字：index.html 的开屏是图形先到位、名字再淡入，
 * 启动图里若先画上名字，交接时名字会先消失再淡回来，闪一下。只留图形，启动图退场
 * 与开屏进场位置重合，看不出接缝。
 *
 * 只做 4 个常见尺寸的竖屏（Amarre 定的量），其它机型与横屏启动退回系统默认底色。
 * 需要 ImageMagick（渲染 SVG 用的是它带的 librsvg）。
 *
 * 用法: node scripts/make-splash.mjs
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'public', 'icons')

/** 与 manifest 的 background_color 一致 */
const BG = '#131315'

/** 深色开屏的取色，与 index.html 里 html[data-boot='dark'] 那几条一一对应 */
const BUBBLE = '#edeae3'
const LINE_W = '#131315'
const LINE_B = '#7c93ff'

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

/** 开屏那个图形在 CSS 里是 120px 见方，居中 */
const MARK_CSS = 120

/** 按 390pt 宽的开屏排版算比例 */
const BASE_W = 390

const svgFor = ({ w, h, ratio }) => {
  const pxW = w * ratio
  const pxH = h * ratio
  const s = (w / BASE_W) * ratio

  const mark = MARK_CSS * s
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">
  <rect width="${pxW}" height="${pxH}" fill="${BG}"/>
  <svg x="${(pxW - mark) / 2}" y="${(pxH - mark) / 2}" width="${mark}" height="${mark}"
       viewBox="18 21 72 72" fill="none">
    <rect x="24" y="28" width="60" height="42" rx="14" fill="${BUBBLE}"/>
    <path d="M46 69 L33 86 L58 69 Z" fill="${BUBBLE}"/>
    <path d="M40 45 H70" stroke="${LINE_W}" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M40 57 H57" stroke="${LINE_B}" stroke-width="6.5" stroke-linecap="round"/>
  </svg>
</svg>
`
}

mkdirSync(outDir, { recursive: true })

for (const target of TARGETS) {
  const pxW = target.w * target.ratio
  const pxH = target.h * target.ratio
  const name = `splash-${pxW}x${pxH}.png`
  const svgPath = join(outDir, `${name}.svg`)
  const pngPath = join(outDir, name)

  writeFileSync(svgPath, svgFor(target), 'utf8')

  // 纯色底 + 一个图形，压成 8 位调色板 PNG 肉眼无损，体积从几十 KB 落到几 KB。
  const render = spawnSync(
    'magick',
    [svgPath, '-resize', `${pxW}x${pxH}!`, '-strip', '-colors', '32', `PNG8:${pngPath}`],
    { encoding: 'utf8' }
  )
  if (render.status !== 0) {
    console.error(`make-splash — ${name} 渲染失败\n${render.stderr ?? ''}`)
    process.exit(render.status ?? 1)
  }

  // 中间那份 SVG 是过程产物，只有 PNG 会进 dist
  unlinkSync(svgPath)

  console.log(`${name}  ${target.w}x${target.h}@${target.ratio}x  ${target.note}`)
}
