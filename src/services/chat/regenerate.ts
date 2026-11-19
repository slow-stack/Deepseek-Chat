import { getReplyText } from './reply.js'
import type { AssistantMessage } from './types.js'

/**
 * 重新生成要真的换一版回答。
 *
 * 原来的做法只是拿同一份上下文重发一次：请求体里既没有采样参数（客户端从不发
 * temperature / seed），latestReminder 同一天又是完全相同的一串，于是重新生成发出的
 * 请求和上一次逐字节相同，模型多半原样复述。
 *
 * 两层一起改：
 * 1. 把「这一段你已经答过什么、这是第几次重来」写进 system，模型知道要避开已有内容；
 * 2. 重新生成时显式换一个 temperature 并随次数轮换——真正改变采样，而不只是改提示词。
 *    只改提示词时，同一个问题在默认温度下仍会写出高度相似的段落，用户看着就是「重复」。
 * 只带最后两版、单版截断，避免把上下文撑爆。
 */

/** 最多带几版旧回答 */
const MAX_PREVIOUS = 2
/** 单版最多保留多少字 */
const MAX_PREVIOUS_CHARS = 600

/**
 * 重新生成时依次使用的温度。必须留在 0~1：Anthropic 协议（DeepSeek 的 /anthropic/v1
 * 也走这套）对这个字段的合法区间是 0 到 1，越界会被服务端直接 400 拒绝。
 * 与服务端默认值不同就够了 —— 关键是每次重来的请求体不再逐字节相同。
 */
const REGENERATE_TEMPERATURES = [0.8, 0.95, 1, 0.9] as const

const HEADER =
  '用户点了「重新生成」：下面是这一段你已经给过的回答。请换一个角度或换一种表述重新回答同一个问题，不要重复已有内容。'

/**
 * 重新生成用的温度。首次生成（没有旧版）返回 undefined，表示不动服务端默认值；
 * 有旧版时按第几次重来轮换，保证每次采样都不同。
 */
export const regenerateTemperature = (previousCount: number): number | undefined => {
  if (previousCount <= 0) {
    return undefined
  }
  return REGENERATE_TEMPERATURES[(previousCount - 1) % REGENERATE_TEMPERATURES.length]
}

/** 旧回答拼成的说明；没有可用的旧回答时返回空串（此时就是首次生成，不加料）。 */
export const buildRegenerateNote = (previous: readonly AssistantMessage[]): string => {
  const texts = previous
    .map((reply) => getReplyText(reply).trim())
    .filter((text) => text !== '')
  if (texts.length === 0) {
    return ''
  }
  const shown = texts.slice(-MAX_PREVIOUS)
  const attempt = previous.length + 1
  const lines = [
    `【第 ${attempt} 次生成同一问题】`,
    ...shown.map(
      (text, index) => `【第 ${texts.length - shown.length + index + 1} 版】${text.slice(0, MAX_PREVIOUS_CHARS)}`
    ),
  ]
  return [HEADER, ...lines].join('\n')
}

/** 把重新生成的说明接到 system 后面；没有说明就原样返回。 */
export const withRegenerateNote = (system: string, note: string | undefined): string =>
  note ? `${system}\n\n${note}` : system
