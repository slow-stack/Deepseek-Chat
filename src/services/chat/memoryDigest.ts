import { streamMessage } from '../api/client.js'
import { modelFor } from '../api/endpoints.js'
import type { ChatModel, MessageParam } from '../api/types.js'
import { lastAutoDigestAt, markAutoDigestAt, useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import { estimateTokens } from './compaction.js'
import * as db from './db.js'
import { exportLocalMemories, saveLocalMemory } from './memoryStore.js'
import { recordTokenUsage } from './tokenLedger.js'
import { getReplyText } from './reply.js'
import type { Session, SessionSummary } from './types.js'

/**
 * 把导入进来的一堆历史会话整理成记忆。
 *
 * 为什么不在导入时自动抽：几百条会话一次跑完既费钱，抽出来的东西也没人看过。
 * 所以做成「你挑、能中途停、记得做到哪」的队列——已经整理过的会话靠固定 id 认出来，
 * 下次只做剩下的，不会重复花钱。
 */

/** 一次默认勾选几条；用户也可以全选 */
export const DIGEST_DEFAULT_PICK = 20

/** 单条会话喂给模型的字数上限：超长会话取头尾，中间省掉并注明 */
const DIGEST_INPUT_CHARS = 8000

const DIGEST_MODEL: ChatModel = 'deepseek-flash'
const digestModel = (): ChatModel => modelFor('summary', DIGEST_MODEL) as ChatModel

/** 整理产出的记忆 id；库里已有它，就说明这条会话整理过了 */
export const digestMemoryId = (sessionId: string) => `digest:${sessionId}`

const promptFor = (locale: string): string =>
  locale === 'en'
    ? 'Read the conversation below and extract what is worth remembering long term: facts about the person, their preferences, decisions, ongoing projects and unfinished business. Write 1 to 6 short lines, one point per line, no bullets, no numbering, no preamble. Ignore small talk. If nothing is worth keeping, output exactly NONE.'
    : '读下面的对话，抽出值得长期记住的东西：关于这个人本身的事实、偏好、决定、在做的项目、没做完的事。写 1 到 6 行短句，一行一个，不要项目符号、不要编号、不要任何开场白。闲聊一律略过。如果确实没有值得留的，只输出 NONE。'

const DIGEST_SYSTEM =
  '这是一次不进入角色的后台整理请求：不要继续对话，不要以助手口吻回应，只按格式输出抽取结果。'

/**
 * 拼一条会话的正文。超长时取头尾各一半：开头通常定调，结尾通常有结论，
 * 中间的细节对「记忆」而言信息密度最低。
 */
const sessionText = (session: Session): string => {
  const lines = getVisibleMessages(session)
    .map((message) =>
      message.role === 'user' ? `用户：${message.content}` : `助手：${getReplyText(message).trim()}`
    )
    .filter((line) => line.trim().length > 0)
  const text = lines.join('\n\n')
  if (text.length <= DIGEST_INPUT_CHARS) {
    return text
  }
  const half = Math.floor(DIGEST_INPUT_CHARS / 2)
  return `${text.slice(0, half)}\n\n（中间省略）\n\n${text.slice(-half)}`
}

/** 已经整理过的会话 id 集合 */
const digestedIds = async (): Promise<Set<string>> =>
  new Set((await exportLocalMemories()).map((record) => record.id))

/** 还没整理过的会话，最近改过的排前面 */
export const listDigestPending = async (): Promise<SessionSummary[]> => {
  const done = await digestedIds()
  return (await db.loadSessionSummaries())
    .filter((summary) => !done.has(digestMemoryId(summary.id)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export type DigestProgress = {
  total: number
  /** 已处理完几条（含失败） */
  done: number
  /** 正在处理的会话标题 */
  current: string | null
}

export type DigestOutcome = {
  saved: number
  /** 模型判断没什么可记的 */
  skipped: number
  failed: number
  /** 这批大约花了多少 token：能取到服务端用量就取真的，取不到按字符估算 */
  tokens: number
  /** 用户中途停了 */
  stopped: boolean
}

/** 模型让它「没什么可记」时可能带标点或大小写差异，这里只认整段就是那一个词 */
const isNothing = (text: string): boolean => /^none\W*$/i.test(text.trim())

/**
 * 整理一批会话：逐条 await，中途 abort 就停下，已完成的照常留在库里。
 * 单条失败不打断整批——失败的条目不写记忆，下次还会出现在待整理里。
 */
export const digestSessions = async (
  sessions: SessionSummary[],
  signal: AbortSignal,
  onProgress: (progress: DigestProgress) => void
): Promise<DigestOutcome> => {
  const { apiKey, locale } = useSettings.getState()
  const outcome: DigestOutcome = { saved: 0, skipped: 0, failed: 0, tokens: 0, stopped: false }
  const progress: DigestProgress = { total: sessions.length, done: 0, current: null }
  // 没有密钥就整批不做：免得每条都发一次必定失败的请求
  if (!apiKey) {
    onProgress({ total: sessions.length, done: sessions.length, current: null })
    return { ...outcome, failed: sessions.length }
  }

  for (const summary of sessions) {
    if (signal.aborted) {
      outcome.stopped = true
      break
    }
    progress.current = summary.title
    onProgress({ ...progress })
    try {
      const session = await db.loadSession(summary.id)
      if (!session) {
        outcome.failed += 1
        continue
      }
      const body = sessionText(session)
      if (!body.trim()) {
        outcome.skipped += 1
        continue
      }
      const messages: MessageParam[] = [
        { role: 'user', content: `${promptFor(locale)}\n\n【对话】\n${body}` },
      ]
      let text = ''
      let used = 0
      const events = streamMessage(
        apiKey,
        {
          model: digestModel(),
          system: DIGEST_SYSTEM,
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
          used =
            event.usage.input_tokens +
            event.usage.cache_creation_input_tokens +
            event.usage.cache_read_input_tokens +
            event.usage.output_tokens
          // 落账：整理花了多少，按条记进台账
          void recordTokenUsage('digest', event.usage)
        }
      }
      outcome.tokens += used > 0 ? used : estimateTokens(body)
      const trimmed = text.trim()
      if (!trimmed || isNothing(trimmed)) {
        outcome.skipped += 1
        continue
      }
      await saveLocalMemory({
        id: digestMemoryId(session.id),
        title: session.title || summary.title,
        content: trimmed,
        occurredAt: new Date(session.updatedAt || Date.now()).toISOString(),
        type: 'digest',
        tags: [],
        // 会话在哪个项目，沉淀出来的记忆就归哪个项目
        projectId: session.projectId ?? summary.projectId ?? null,
      })
      outcome.saved += 1
    } catch {
      if (signal.aborted) {
        outcome.stopped = true
        break
      }
      outcome.failed += 1
    } finally {
      progress.done += 1
      onProgress({ ...progress })
    }
  }
  progress.current = null
  onProgress({ ...progress })
  return outcome
}

/**
 * 打开应用时顺手补一段：把上次整理之后还没做过的会话沉淀成记忆。
 *
 * 为什么要有它：导入几百条历史会话之后，用户不会记得回来按「整理历史会话」，
 * 那些会话就一直只是干躺在列表里，记忆库看起来永远像空的。
 *
 * 三条闸门，缺一不可：插件开着、自动整理开关开着、距上次够久。
 * 一次最多做 memoryAutoDigestBatch 条——它跑在后台，不能一口气烧掉一大笔。
 * 没密钥、没待整理的会话都直接返回，一次请求都不发。
 */
export type AutoDigestResult = { ran: boolean; saved: number; skipped: number; failed: number }

// 回到前台会触发一次，手机上切来切去容易连着触发几次；一次整理可能跑几十秒，
// 期间 gap 还没被 markAutoDigestAt 更新，不挡住就会同时跑两份、烧两份钱。
let autoDigestInFlight: Promise<AutoDigestResult> | null = null

const runAutoDigest = async (): Promise<AutoDigestResult> => {
  const state = useSettings.getState()
  const idle: AutoDigestResult = { ran: false, saved: 0, skipped: 0, failed: 0 }
  if (!state.memoryPluginEnabled || !state.memoryAutoDigest || !state.apiKey) {
    return idle
  }
  const last = lastAutoDigestAt()
  const gap = state.memoryAutoDigestHours * 60 * 60 * 1000
  if (last > 0 && Date.now() - last < gap) {
    return idle
  }
  const pending = await listDigestPending()
  if (pending.length === 0) {
    // 没有新东西也记一次时间：免得每次开应用都去扫一遍会话表
    markAutoDigestAt(Date.now())
    return idle
  }
  const batch = pending.slice(0, state.memoryAutoDigestBatch)
  const controller = new AbortController()
  const outcome = await digestSessions(batch, controller.signal, () => {})
  // 记在跑完之后：中途关掉应用的话下次还会补，不会漏
  markAutoDigestAt(Date.now())
  return {
    ran: true,
    saved: outcome.saved,
    skipped: outcome.skipped,
    failed: outcome.failed,
  }
}

export const autoDigest = (): Promise<AutoDigestResult> => {
  if (autoDigestInFlight) {
    return autoDigestInFlight
  }
  autoDigestInFlight = runAutoDigest().finally(() => {
    autoDigestInFlight = null
  })
  return autoDigestInFlight
}
