/** 正文字号档位。数值是相对标准字号的倍数，存进 localStorage */
export const FONT_SCALES = [0.92, 1, 1.12, 1.25, 1.4] as const

export type FontScale = (typeof FONT_SCALES)[number]

export const isFontScale = (value: number): value is FontScale =>
  (FONT_SCALES as readonly number[]).includes(value)

/**
 * 把字号倍数写到根节点上，正文相关的字号都用 `--ds-text-scale` 乘。
 * 用 CSS 变量而不是 zoom：zoom 会把侧栏、图标、间距一起放大，
 * 小屏上直接挤成两行；这里只想让读的字变大，控件尺寸保持不变。
 */
export const applyFontScale = (scale: number) => {
  const value = isFontScale(scale) ? scale : 1
  document.documentElement.style.setProperty('--ds-text-scale', String(value))
}
