/** 正文字号，直接就是 px。范围与默认值参照 DSH 设置页：10–22，默认 14 */
export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 22
export const DEFAULT_FONT_SIZE = 14

/** 缩放变量的基准：所有 calc(Npx * var(--ds-text-scale)) 都是按 14px 标准档写的 */
const FONT_SIZE_BASE = 14

export const isFontSize = (value: number): boolean =>
  Number.isInteger(value) && value >= FONT_SIZE_MIN && value <= FONT_SIZE_MAX

export const clampFontSize = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_FONT_SIZE
  }
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/**
 * 把字号写到根节点上。全站的字号与行高都写成 `calc(Npx * var(--ds-text-scale, 1))`，
 * 所以这里只需要给出一个倍数。
 *
 * 用 CSS 变量而不是 zoom：zoom 会把侧栏宽度、图标、内边距一起放大，
 * 小屏上直接挤成两行；这里只想让读的字变大，控件尺寸保持不变。
 */
export const applyFontSize = (px: number) => {
  const value = clampFontSize(px)
  document.documentElement.style.setProperty('--ds-text-scale', String(value / FONT_SIZE_BASE))
}
