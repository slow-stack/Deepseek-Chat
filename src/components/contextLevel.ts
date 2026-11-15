/** 顶栏 chip 与设置页共用的展示口径：占用档位与 token 简写 */

/** 占用比例对应的视觉档位：正常、偏高、达到阈值 */
export const contextLevelOf = (
  ratio: number,
  threshold: number
): 'normal' | 'warm' | 'hot' => {
  if (ratio >= threshold) {
    return 'hot'
  }
  return ratio >= threshold * 0.75 ? 'warm' : 'normal'
}

/** 128000 显示成 128k，避免在窄药丸里塞六位数 */
export const formatContextTokens = (tokens: number) =>
  tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
