/**
 * 会单独发请求的能力。
 *
 * 联网搜索也在其中：设置里给它配了地址或密钥时，客户端自己调 Search API；
 * 留空则仍由服务端在对话请求内执行（server tool），行为与之前一致。
 * 网页抓取、文件解析与 OCR 没有可配置的独立入口，跟随「对话」那一条。
 */
export type ApiCapability = 'chat' | 'summary' | 'search' | 'tts' | 'asr'

/** 界面上按这个顺序展示 */
export const API_CAPABILITIES: readonly ApiCapability[] = ['chat', 'summary', 'search', 'tts', 'asr']

/** 只有需要选模型的两种能力才显示模型输入 */
export const CAPABILITIES_WITH_MODEL: readonly ApiCapability[] = ['chat', 'summary']
