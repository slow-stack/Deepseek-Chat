import { getReplyText } from './reply.js'
import type { AssistantMessage } from './types.js'

/**
 * 重新生成要真的换一版回答。
 *
 * 原来的做法只是拿同一份上下文重发一次：请求体里既没有采样参数（客户端从不发
 * temperature / seed），latestReminder 同一天又是完全相同的一串，于是重新生成发出的
 * 请求和上一次逐字节相同，模型多半原样复述。
 *
 * 这里把「这一段你已经答过什么、这是第几次重来」写进 system：模型知道要避开已有内容，
 * 而且即使两次答得一模一样，带上次数标记后请求也不会再重复。
 * 只带最后两版、单版截断，避免把上下文撑爆。
 */

/** 最多带几版旧回答 */
const MAX_PREVIOUS = 2
/** 单版最多保留多少字 */
const MAX_PREVIOUS_CHARS = 600

const HEADER =
  '用户点了「重新生成」：下面是这一段你已经给过的回答。请换一个角度或换一种表述重新回答同一个问题，不要重复已有内容。'

/** 旧回答拼成的说明；没有可用的旧回答时返回空串（此时就是首次生成，不加料）。 */
export const buildRegenerateNote = (previous: readonly AssistantMessage[]): string => {
  const texts = previous
    .map((reply) => getReplyText(reply).trim())
    .filter((text) => text !== '')
  if (texts.length === 0) {
    return ''
  }
  const shown = texts.slice(-MAX_PREVIOUS)
  const attempt = texts.length + 1
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
