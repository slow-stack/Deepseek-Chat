import { streamMessage } from '../api/client.js'
import { modelFor } from '../api/endpoints.js'
import type { ChatModel, MessageParam } from '../api/types.js'
import { getContextRounds, getReplyText } from './reply.js'
import { recordTokenUsage } from './tokenLedger.js'
import type {
  AssistantMessage,
  Message,
  SessionCompaction,
  UserMessage,
} from './types.js'

/**
 * 上下文窗口（token）。只用来把占用换算成比例、决定什么时候压缩，
 * 不参与请求本身；服务端上限变化时改这里。
 */
export const CONTEXT_WINDOW = 128_000

/** 摘要请求用的模型与身份说明，和主对话保持一致 */
const SUMMARY_MODEL: ChatModel = 'deepseek-flash'
/** 设置里给摘要单独配了模型就用那个，否则用内置默认 */
const summaryModel = (): ChatModel => modelFor('summary', SUMMARY_MODEL) as ChatModel
/**
 * 摘要是一次后台整理，不是对话：必须明确禁止模型接着往下聊，
 * 否则它会以助手口吻写一段回复而不是摘要。
 */
const SUMMARY_SYSTEM =
  '你是对话归档器。这是一次不进入角色的后台整理请求：不要继续对话，不要以助手口吻回应，只输出摘要正文。'

/** 摘要长度上限：一段话，够模型接上上下文即可 */
const SUMMARY_MAX_CHARS = 1200
/** 本地摘要里每轮保留的开头字数 */
const ROUND_PREVIEW_CHARS = 120
/**
 * 压缩之后上下文要再长这么多（占窗口比例）才值得再压一次。
 * 没有这道门槛时，会话刚好停在阈值附近，会每轮都发一次摘要请求。
 */
const MIN_GROWTH_RATIO = 0.15

/** 摘要方式：local 本地拼段，model 调模型 */
export type CompactionMode = 'local' | 'model'

/** 压缩相关设置，从 settings 传进来，避免这里依赖 zustand 实例 */
export type CompactionSettings = {
  compactThreshold: number
  compactKeepRounds: number
  compactMode: CompactionMode
}

/**
 * 粗略估算 token：中日韩字符约 0.6 token，其余字符约 0.3 token。
 * 只在没有服务端用量（新会话、导入的历史）时兜底。
 */
export const estimateTokens = (text: string): number => {
  let wide = 0
  for (const char of text) {
    if (char >= '\u2E80') {
      wide += 1
    }
  }
  return Math.ceil(wide * 0.6 + (text.length - wide) * 0.3)
}

/** 一条回复里记录的用量之和，即这一轮结束时上下文有多少 token */
const usageTokens = ({ usage }: AssistantMessage): number | null =>
  usage
    ? usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens +
      usage.output_tokens
    : null

/** 最近一条带用量的回复的上下文 token；都没有则按字符估算 */
export const getContextTokens = (messages: Message[]): number => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') {
      continue
    }
    const tokens = usageTokens(message)
    if (tokens !== null) {
      return tokens
    }
  }
  return messages.reduce(
    (sum, message) =>
      sum + estimateTokens(message.role === 'user' ? message.content : getReplyText(message)),
    0
  )
}

/** 占用比例，0 到 1 */
export const getContextRatio = (tokens: number): number =>
  Math.min(1, Math.max(0, tokens / CONTEXT_WINDOW))

/**
 * 压缩之后实际会带上的 token 估算：摘要 + 锚点之后的轮次。
 * 没有压缩记录时直接用真实用量或全文估算。
 * 指示器用它，压缩完数字才会真的掉下来——用上一轮的用量会因为还没发过新请求而停在原位。
 */
export const getEffectiveContextTokens = (
  messages: Message[],
  compaction?: SessionCompaction
): number => {
  const anchor = compaction
    ? messages.findIndex((message) => message.id === compaction.upTo)
    : -1
  if (!compaction || anchor < 0) {
    return getContextTokens(messages)
  }
  const rest = getContextRounds(messages.slice(anchor + 1))
  const body = rest
    .map(([user, reply]) => `${questionText(user)}${getReplyText(reply)}`)
    .join('')
  return estimateTokens(compaction.summary) + estimateTokens(body) + 16
}

/** 达到阈值才压缩 */
export const shouldCompact = (tokens: number, threshold: number): boolean =>
  tokens >= CONTEXT_WINDOW * threshold

/**
 * 已经压过一次之后，锚点之后新攒下的内容够不够多。
 *
 * 只用估算量比，不拿真实用量减估算值：两者算法不同，相减没有意义。
 * 锚点已经找不到（消息被编辑或切了分支）时按「可以再压」处理。
 */
const grewEnough = (messages: Message[], previous: SessionCompaction): boolean => {
  const anchor = messages.findIndex((message) => message.id === previous.upTo)
  if (anchor < 0) {
    return true
  }
  const rest = getContextRounds(messages.slice(anchor + 1))
  const body = rest
    .map(([user, reply]) => `${questionText(user)}${getReplyText(reply)}`)
    .join('')
  return estimateTokens(body) >= CONTEXT_WINDOW * MIN_GROWTH_RATIO
}

const questionText = (user: UserMessage): string =>
  user.content.trim() || (user.files.length > 0 ? '（附图）' : '')

const roundText = (user: UserMessage, reply: AssistantMessage): string =>
  `问：${questionText(user)}\n答：${getReplyText(reply).trim()}`

/** 一批轮次的原文，供「展开原文」查看 */
export const describeRounds = (
  rounds: readonly (readonly [UserMessage, AssistantMessage])[]
): string => rounds.map(([user, reply]) => roundText(user, reply)).join('\n\n')

/** 本地摘要：把每轮的开头拼成一段，不发额外请求 */
export const buildLocalSummary = (
  previous: string | undefined,
  rounds: readonly (readonly [UserMessage, AssistantMessage])[]
): string => {
  const lines = rounds.map(([user, reply]) => {
    const question = questionText(user).slice(0, ROUND_PREVIEW_CHARS)
    const answer = getReplyText(reply).trim().slice(0, ROUND_PREVIEW_CHARS)
    return `- ${question} → ${answer}`
  })
  const head = previous?.trim() ?? ''
  return `${head ? `${head}\n\n` : ''}${lines.join('\n')}`.slice(0, SUMMARY_MAX_CHARS)
}

/** 调模型压缩：一次普通请求，取正文并把用量记进 token 台账 */
const requestModelSummary = async (
  previous: string | undefined,
  rounds: readonly (readonly [UserMessage, AssistantMessage])[],
  apiKey: string,
  signal: AbortSignal
): Promise<string> => {
  const head = previous?.trim()
  const messages: MessageParam[] = [
    {
      role: 'user',
      content: [
        head ? `【已有摘要】\n${head}` : '',
        '【需要并入的新对话】',
        rounds.map(([user, reply]) => roundText(user, reply)).join('\n\n'),
        `把以上内容合并成一段不超过 ${SUMMARY_MAX_CHARS} 字的中文摘要，保留事实、结论与没做完的事，不要评价，不要分点。`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
  let text = ''
  const events = streamMessage(
    apiKey,
    {
      model: summaryModel(),
      system: SUMMARY_SYSTEM,
      messages,
      thinking: { type: 'disabled' },
      safety_check: { level: 'high' },
      tools: [],
    },
    signal
  )
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
    if (event.type === 'message_delta' && event.usage) {
      void recordTokenUsage('compaction', event.usage)
    }
  }
  return text.trim().slice(0, SUMMARY_MAX_CHARS)
}

export type CompactionPlan = {
  /** 这次要压掉的轮次 */
  rounds: [UserMessage, AssistantMessage][]
  /** 压到哪里：最后一条被压掉的回复 id */
  upTo: string
  /** 本次新增的轮次数 */
  added: number
}

/**
 * 选出这次要压掉的轮次：已有压缩之前的轮次不再重复计入，
 * 最近 keepRounds 轮完整保留，只有更早的才可能被压掉。
 * 没有可压的轮次时返回 null——避免阈值到了却反复压缩同一批内容。
 */
export const selectCompactionRounds = (
  history: Message[],
  keepRounds: number,
  upTo?: string
): CompactionPlan | null => {
  const start = upTo === undefined ? 0 : history.findIndex((message) => message.id === upTo) + 1
  const rounds = getContextRounds(start > 0 ? history.slice(start) : history)
  if (rounds.length <= keepRounds) {
    return null
  }
  const compacting = rounds.slice(0, rounds.length - keepRounds)
  const last = compacting.at(-1)
  return last ? { rounds: compacting, upTo: last[1].id, added: compacting.length } : null
}

/**
 * 判断是否该压缩并给出方案。token 数优先取最近一轮的真实用量：
 * 那是「这次请求大约会带多少上下文」最准的估计。
 *
 * 已经压过一次时，要先看「压完之后又长了多少」，长不够就不再压：
 * 否则会话卡在阈值附近，每轮都会白发一次摘要请求。
 */
export const planCompaction = (
  history: Message[],
  settings: Pick<CompactionSettings, 'compactThreshold' | 'compactKeepRounds'>,
  previous?: SessionCompaction
): CompactionPlan | null => {
  const tokens = getContextTokens(history)
  if (!shouldCompact(tokens, settings.compactThreshold)) {
    return null
  }
  if (previous && !grewEnough(history, previous)) {
    return null
  }
  return selectCompactionRounds(history, settings.compactKeepRounds, previous?.upTo)
}

/**
 * 生成新的压缩记录：摘要覆盖「旧摘要 + 本次新压掉的轮次」，
 * 原文累积保存，所以「展开原文」看得到全部被压掉的内容。
 */
export const buildCompaction = async (
  plan: CompactionPlan,
  mode: CompactionMode,
  apiKey: string,
  signal: AbortSignal,
  previous?: SessionCompaction
): Promise<SessionCompaction> => {
  const originalText = describeRounds(plan.rounds)
  let summary = buildLocalSummary(previous?.summary, plan.rounds)
  if (mode === 'model' && apiKey) {
    try {
      const generated = await requestModelSummary(
        previous?.summary,
        plan.rounds,
        apiKey,
        signal
      )
      if (generated) {
        summary = generated
      }
    } catch {
      // 摘要请求失败不打断对话，退回本地摘要
      summary = buildLocalSummary(previous?.summary, plan.rounds)
    }
  }
  return {
    summary,
    upTo: plan.upTo,
    originalText: previous?.originalText ? `${previous.originalText}\n\n${originalText}` : originalText,
    mode,
    rounds: (previous?.rounds ?? 0) + plan.added,
    createdAt: Date.now(),
  }
}
