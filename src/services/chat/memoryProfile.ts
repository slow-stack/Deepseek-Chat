import { streamMessage } from '../api/client.js'
import { modelFor } from '../api/endpoints.js'
import type { ChatModel, MessageParam } from '../api/types.js'
import { useSettings } from '../settings.js'
import { saveLocalMemory } from './memoryStore.js'
import type { MemoryRecord } from './memoryTypes.js'

/**
 * 用户画像与记忆摘要：把散落的记忆条目整理成一段「一眼能读完」的人话。
 *
 * 参考 ChatGPT 的记忆摘要页：不是一堆条目，而是按主题分节的第二人称叙述
 * （「你是……」「你在做……」）。数据源用库里已有的记忆条目，不回读会话原文——
 * 蒸馏时已经花过一次钱，这里只是把要点重新组织一遍，成本很小。
 *
 * 画像（profile:main）与摘要（summary:main）都是固定 id 覆盖写：
 * 每次生成都是全量重写，旧版本不留。
 */

const PROFILE_MODEL: ChatModel = 'deepseek-flash'
const profileModel = (): ChatModel => modelFor('summary', PROFILE_MODEL) as ChatModel

/** 单条记忆喂给模型的字数上限 */
const ITEM_CHARS = 300

/** 最多带多少条进 prompt；库大了先取最近的 */
const MAX_ITEMS = 120

export const PROFILE_MEMORY_ID = 'profile:main'
export const SUMMARY_MEMORY_ID = 'summary:main'

const PROFILE_SYSTEM =
  '这是一次不进入角色的后台整理请求：不要继续对话，不要以助手口吻回应，只按格式输出整理结果。'

const profilePrompt = (locale: string): string =>
  locale === 'en'
    ? 'Below are saved memory notes about a person. Organize them into a profile written in second person ("you..."), grouped by theme with short Markdown headings (## Overview, ## Themes...). Keep only what the notes support; do not invent. Keep the whole thing under 600 words. Output Markdown only.'
    : '下面是关于一个人的记忆条目。请整理成一篇第二人称（「你……」）的用户画像，按主题分节，每节一个简短的 Markdown 标题（## 概览、## 学业、## 项目……）。只整理条目里有依据的内容，不要编造。全文控制在 600 字以内，直接输出 Markdown，不要开场白。'

const summaryPrompt = (locale: string): string =>
  locale === 'en'
    ? 'Below are saved memory notes about a person. Write a compact memory digest in second person ("you..."): a short overview paragraph first, then themed sections with short Markdown headings. Keep only what the notes support. Under 800 words. Output Markdown only.'
    : '下面是关于一个人的记忆条目。请写一份紧凑的记忆摘要，第二人称（「你……」）：先一小段概览，再按主题分节，每节一个简短的 Markdown 标题。只整理条目里有依据的内容。全文 800 字以内，直接输出 Markdown，不要开场白。'

/** 挑要喂给模型的条目：按时间倒序取最近的，单条截断 */
const feedItems = (records: MemoryRecord[]): string => {
  const sorted = [...records].sort((a, b) => {
    const ta = Date.parse(a.occurredAt ?? a.createdAt ?? '') || 0
    const tb = Date.parse(b.occurredAt ?? b.createdAt ?? '') || 0
    return tb - ta
  })
  const lines: string[] = []
  for (const record of sorted.slice(0, MAX_ITEMS)) {
    const title = record.title?.trim()
    const body = record.content.trim().replace(/\s*\n\s*/g, ' ').slice(0, ITEM_CHARS)
    const when = record.occurredAt ?? record.createdAt
    const date = when ? new Date(when) : null
    const stamp = date && !Number.isNaN(date.getTime()) ? `${date.toISOString().slice(0, 10)} ` : ''
    lines.push(`- ${stamp}${title ? `${title}：` : ''}${body}`)
  }
  return lines.join('\n')
}

/** 一段整理请求的公共部分：拼 prompt、流式取回全文 */
const runProfile = async (
  prompt: string,
  records: MemoryRecord[],
  signal: AbortSignal,
  onDelta?: (delta: string) => void
): Promise<string> => {
  const { apiKey } = useSettings.getState()
  if (!apiKey) {
    throw new Error('no api key')
  }
  const feed = feedItems(records)
  if (!feed.trim()) {
    throw new Error('no memories')
  }
  const messages: MessageParam[] = [{ role: 'user', content: `${prompt}\n\n【记忆条目】\n${feed}` }]
  let text = ''
  const events = streamMessage(
    apiKey,
    {
      model: profileModel(),
      system: PROFILE_SYSTEM,
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
      onDelta?.(event.delta.text)
    }
  }
  return text.trim()
}

/**
 * 生成并保存用户画像。失败抛错给界面提示；成功返回全文。
 * id 固定 profile:main，覆盖写——每次都是重新整理，不是追加。
 */
export const generateProfile = async (
  records: MemoryRecord[],
  signal: AbortSignal,
  onDelta?: (delta: string) => void
): Promise<string> => {
  const { locale } = useSettings.getState()
  const text = await runProfile(profilePrompt(locale), records, signal, onDelta)
  if (!text) {
    throw new Error('empty profile')
  }
  await saveLocalMemory({
    id: PROFILE_MEMORY_ID,
    title: '用户画像',
    content: text,
    occurredAt: new Date().toISOString(),
    type: 'profile',
    tags: [],
    projectId: null,
  })
  return text
}

/** 生成并保存记忆摘要。同 profile，id 固定 summary:main。 */
export const generateSummary = async (
  records: MemoryRecord[],
  signal: AbortSignal,
  onDelta?: (delta: string) => void
): Promise<string> => {
  const { locale } = useSettings.getState()
  const text = await runProfile(summaryPrompt(locale), records, signal, onDelta)
  if (!text) {
    throw new Error('empty summary')
  }
  await saveLocalMemory({
    id: SUMMARY_MEMORY_ID,
    title: '记忆摘要',
    content: text,
    occurredAt: new Date().toISOString(),
    type: 'summary',
    tags: [],
    projectId: null,
  })
  return text
}
