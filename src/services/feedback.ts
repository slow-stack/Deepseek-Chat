/**
 * 问题与反馈的出口。
 *
 * 这个 App 是旁装应用，没有后台，也就不该为了收反馈去开群：能用的通道都是
 * 「用户手上已有的东西」——GitHub 工单、邮件、或者干脆复制走自己贴。
 *
 * 三条路都只是把一段文字送到某个地方，所以正文统一在这里拼一次，
 * 三个出口用同一份内容，避免出现「邮件里写的和工单里写的不一样」。
 */
import { useSettings } from './settings.js'
import { currentVersion } from './update.js'

/** 仓库与联系地址都放在这里，换地址只改这一处 */
export const FEEDBACK_REPO = 'slow-stack/Deepseek-Chat'
export const FEEDBACK_EMAIL = 'work@modusensus.space'

/** 正文上限：GitHub 的 new-issue 链接太长会被截断，留足余量 */
const MAX_DESCRIPTION = 4000

export type FeedbackDraft = {
  /** 用户写的那段话 */
  description: string
  /** 是否附带环境信息 */
  diagnostics: boolean
}

/** 一行能帮上忙的环境信息；不含任何对话内容或密钥 */
export const describeEnvironment = (): string => {
  const locale = useSettings.getState().locale
  const memoryOn = useSettings.getState().memoryPluginEnabled
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  return [
    `版本：${currentVersion()}`,
    `语言：${locale}`,
    `记忆插件：${memoryOn ? '开启' : '关闭'}`,
    `平台：${ua}`,
  ].join('\n')
}

/** 三处出口都用这份正文 */
export const buildFeedbackBody = ({ description, diagnostics }: FeedbackDraft): string => {
  const text = description.trim().slice(0, MAX_DESCRIPTION)
  if (!diagnostics) {
    return text
  }
  return `${text}\n\n---\n${describeEnvironment()}`
}

/** 标题取正文第一句，够 GitHub 列表里认出是哪条 */
const buildTitle = (description: string): string => {
  const firstLine = description.trim().split('\n').find((line) => line.trim() !== '') ?? ''
  const title = firstLine.trim().slice(0, 60)
  return title === '' ? '反馈' : title
}

export const githubIssueUrl = (draft: FeedbackDraft): string => {
  const title = encodeURIComponent(buildTitle(draft.description))
  const body = encodeURIComponent(buildFeedbackBody(draft))
  return `https://github.com/${FEEDBACK_REPO}/issues/new?title=${title}&body=${body}`
}

export const mailtoUrl = (draft: FeedbackDraft): string => {
  const subject = encodeURIComponent(`[DeepseekChat] ${buildTitle(draft.description)}`)
  const body = encodeURIComponent(buildFeedbackBody(draft))
  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`
}

/** 复制走：手机上没登 GitHub、也没配邮箱时仍然能发出去 */
export const plainFeedback = (draft: FeedbackDraft): string =>
  `${buildTitle(draft.description)}\n\n${buildFeedbackBody(draft)}`
