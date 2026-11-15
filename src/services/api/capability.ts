/**
 * 会单独发请求的能力。
 *
 * 联网搜索、网页抓取、文件解析与 OCR 不在这里：它们由服务端在对话请求内执行
 * （server tool 与 /files），客户端没有独立调用，所以跟随「对话」那一条。
 */
export type ApiCapability = 'chat' | 'summary' | 'tts' | 'asr'

/** 界面上按这个顺序展示 */
export const API_CAPABILITIES: readonly ApiCapability[] = ['chat', 'summary', 'tts', 'asr']

/** 只有需要选模型的两种能力才显示模型输入 */
export const CAPABILITIES_WITH_MODEL: readonly ApiCapability[] = ['chat', 'summary']