import { useSettings } from '../settings.js'
import { saveLocalMemory } from './memoryStore.js'
import type { AssistantMessage, Session, UserMessage } from './types.js'

/**
 * 会话级记忆闸门（2026-11-15 桉桉要的 Chatbox 式开关）。
 *
 * 语义：会话上 `memoryEnabled === false` 时，这条会话
 *   - 不写入记忆库（蒸馏、笔记、任何入库路径都得先问这里）；
 *   - 不从记忆库取上下文（检索结果不该拼进它的 prompt）。
 * 关掉的会话照常聊天，只是与记忆系统彻底无关。
 *
 * 约定：**所有**碰记忆库的代码都从这里过，不要直接读 `session.memoryEnabled`。
 * 现在 chat 侧还没有记忆通道（没有写入方也没有读取方），所以这里是先立闸门：
 * 将来接 mneme 时，写入方与读取方各调一次，闸门才真正挡住东西。
 */
export const isMemoryEnabled = (session: Pick<Session, 'memoryEnabled'> | undefined): boolean =>
  session?.memoryEnabled !== false

/**
 * 记忆插件是总开关：插件在设置里关着时，这套记忆等于没装——
 * 不写入、不读取、侧栏与聊天框也不长任何入口。
 */
const isMemoryPluginOn = (): boolean => useSettings.getState().memoryPluginEnabled

/** 写库前调用；返回 false 时必须整段跳过入库，不能当成「降权写入」。 */
export const canWriteMemory = (session: Pick<Session, 'memoryEnabled'> | undefined): boolean =>
  isMemoryPluginOn() && isMemoryEnabled(session)

/** 取记忆上下文前调用；返回 false 时不要请求记忆库，也不要拼接检索结果。 */
export const canReadMemory = (session: Pick<Session, 'memoryEnabled'> | undefined): boolean =>
  isMemoryPluginOn() && isMemoryEnabled(session)

/**
 * 入库路由：默认进本机那个记忆库（装上就有、离线可用、不经过任何服务），
 * 只有在高级设置里填了记忆服务地址时才改走远端。
 * 任何失败都静默——记忆是旁路，不能把已经答完的回复变成错误。
 */

/** 标题必须是纯文本以外的「唯一键」，同时不能撞上写入准入的密钥 / PII 形状判据。 */
const memoryTitleOf = (session: Pick<Session, 'id'>, reply: Pick<AssistantMessage, 'id'>) =>
  `chat:${session.id}:${reply.id}`

/** 一轮对话的纯文本：首行是会话标题（标题本身参与去重，不能放这里）。 */
const memoryContentOf = (
  session: Pick<Session, 'title'>,
  question: UserMessage,
  replyText: string
) => [session.title, `用户：${question.content}`, `助手：${replyText}`].join('\n').trim()

export type MemoryWriteResult =
  | { ok: true; action: string }
  | { ok: false; reason: 'disabled' | 'empty' | 'unreachable' | 'rejected'; message?: string }

/**
 * 把一轮已完成的对话写进记忆库。挂在本轮收尾处，失败一律不抛：记忆是旁路，
 * 不能因为写不进库把一个已经答完的回复变成错误。
 *
 * 只写 `status === 'done'` 的回复——停止、报错、还没 stream 完的半截话都不入库。
 */
export const saveTurnToMemory = async (
  session: Session | undefined,
  question: UserMessage,
  reply: AssistantMessage,
  replyText: string
): Promise<MemoryWriteResult> => {
  if (!canWriteMemory(session)) {
    return { ok: false, reason: 'disabled' }
  }
  if (!replyText.trim()) {
    return { ok: false, reason: 'empty' }
  }
  const body = {
    title: memoryTitleOf(session as Session, reply),
    content: memoryContentOf(session as Session, question, replyText),
    occurred_at: new Date(reply.createdAt || Date.now()).toISOString(),
  }
  const { memoryServiceUrl, memoryServiceToken } = useSettings.getState()
  if (!memoryServiceUrl) {
    // 默认这条路：直接写进本机记忆库，不联网、不需要任何配置
    try {
      await saveLocalMemory({
        title: body.title,
        content: body.content,
        occurredAt: body.occurred_at,
        type: 'conversation',
        tags: [],
      })
      return { ok: true, action: 'saved' }
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
  }
  const base = memoryServiceUrl.replace(/\/+$/, '')
  const endpoint = `${base}/memories`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (memoryServiceToken) {
    headers.authorization = `Bearer ${memoryServiceToken}`
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const parsed: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      // 422 是写入准入拒了这条内容（判定为敏感），不是网络问题——重试没有意义。
      const message =
        parsed && typeof parsed === 'object' && 'error' in parsed ? String(parsed.error) : undefined
      return {
        ok: false,
        reason: response.status === 422 ? 'rejected' : 'unreachable',
        message,
      }
    }
    const action =
      parsed && typeof parsed === 'object' && 'action' in parsed ? String(parsed.action) : 'saved'
    return { ok: true, action }
  } catch {
    return { ok: false, reason: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}
