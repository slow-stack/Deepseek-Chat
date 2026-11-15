import { create } from 'zustand'
import { API_CAPABILITIES, type ApiCapability } from './api/capability.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 外观皮肤：paper 为新配的纸张配色，classic 还原官方原样 */
export type Skin = 'paper' | 'classic'

/** 摘要方式：local 本地拼段（不发请求、零成本），model 调模型生成（更好但多一次请求） */
export type CompactMode = 'local' | 'model'

/**
 * 桌面图标：内置五套，靠 Android 的 activity-alias 启停来切换。
 * 只有装成 App 时才有意义，网页里没有这个入口。
 */
export type AppIcon = 'v1' | 'v2' | 'v3' | 'v4' | 'v5'

/**
 * 单条能力的接口覆盖。三个字段都是空串时表示完全跟随主接口，
 * 所以我们不做「未设置」与「显式空」的区分。
 */
export type EndpointOverride = {
  /** 服务地址，例如 https://api.deepseek.com；空串跟随主接口 */
  baseUrl: string
  /** 这条能力单独用的密钥；空串跟随全局 API Key */
  apiKey: string
  /** 只有对话与摘要用得上；空串用内置默认模型 */
  model: string
}

export type EndpointSettings = Record<ApiCapability, EndpointOverride>

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、上下文压缩 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  skin: Skin
  /** 桌面图标版本；切图标会让系统重建快捷方式，应用可能被重开一次 */
  appIcon: AppIcon
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 上下文占用达到这个比例时自动压缩，0.3~0.95 */
  compactThreshold: number
  /** 压缩时完整保留的最近轮次数，2~20 */
  compactKeepRounds: number
  compactMode: CompactMode
  /** 记忆插件开关；关掉时侧栏没有记忆页、聊天里也没有记忆按钮，等于没装 */
  memoryPluginEnabled: boolean
  /** 记忆服务地址（mneme standalone API）。留空时走宿主代转，即只在 DSH 面板里可用 */
  memoryServiceUrl: string | null
  /** 记忆服务 token；只有自己填了地址时才用得上 */
  memoryServiceToken: string | null
  /** 打开应用时自动把没整理过的会话沉淀成记忆 */
  memoryAutoDigest: boolean
  /** 两次自动整理之间至少隔多少小时 */
  memoryAutoDigestHours: number
  /** 一次自动整理最多做几条，免得一次烧太多 */
  memoryAutoDigestBatch: number
  /** 用向量模型搜记忆；关掉时是字面匹配 */
  memoryVectorEnabled: boolean
  /** 向量模型的地址，例如 https://api.openai.com/v1 */
  memoryVectorBaseUrl: string
  /** 向量模型名，例如 text-embedding-3-small */
  memoryVectorModel: string
  /** 向量模型的密钥 */
  memoryVectorApiKey: string
  /** 分能力接口：把对话、摘要、语音拆到不同服务上去 */
  endpoints: EndpointSettings
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  skin: 'chat-demo:skin',
  appIcon: 'chat-demo:app-icon',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  compactThreshold: 'chat-demo:compact-threshold',
  compactKeepRounds: 'chat-demo:compact-keep-rounds',
  compactMode: 'chat-demo:compact-mode',
  memoryServiceUrl: 'chat-demo:memory-service-url',
  memoryServiceToken: 'chat-demo:memory-service-token',
  memoryPluginEnabled: 'chat-demo:memory-plugin-enabled',
  memoryAutoDigest: 'chat-demo:memory-auto-digest',
  memoryAutoDigestHours: 'chat-demo:memory-auto-digest-hours',
  memoryAutoDigestBatch: 'chat-demo:memory-auto-digest-batch',
  memoryVectorEnabled: 'chat-demo:memory-vector-enabled',
  memoryVectorBaseUrl: 'chat-demo:memory-vector-base-url',
  memoryVectorModel: 'chat-demo:memory-vector-model',
  memoryVectorApiKey: 'chat-demo:memory-vector-api-key',
  /** 上次自动整理跑完的时间，毫秒数；节流用，不算用户设置但一起存 */
  memoryAutoDigestAt: 'chat-demo:memory-auto-digest-at',
  endpoints: 'chat-demo:endpoints',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时用 v2：那是内置里最像「对话气泡」的一套 */
const initialAppIcon = (): AppIcon => {
  const saved = read(KEYS.appIcon)
  return saved === 'v1' || saved === 'v3' || saved === 'v4' || saved === 'v5' ? saved : 'v2'
}

/**
 * 记忆插件默认关着（装上不出现，用户想要才开）。
 * 例外：已经填过服务地址或 token 的，说明本来就在用，升级后不能突然把它藏起来。
 */
const initialMemoryPluginEnabled = (): boolean => {
  const saved = read(KEYS.memoryPluginEnabled)
  if (saved === 'true' || saved === 'false') {
    return saved === 'true'
  }
  return Boolean(read(KEYS.memoryServiceUrl) || read(KEYS.memoryServiceToken))
}

/** 每条能力都补齐成三个空串，读的时候不用到处判空 */
const emptyOverride = (): EndpointOverride => ({ baseUrl: '', apiKey: '', model: '' })

const initialEndpoints = (): EndpointSettings => {
  try {
    const saved: unknown = JSON.parse(read(KEYS.endpoints) ?? 'null')
    const out = {} as EndpointSettings
    for (const capability of API_CAPABILITIES) {
      const raw = (saved as Record<string, unknown> | null)?.[capability]
      const item = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
      out[capability] = {
        baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl : '',
        apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
        model: typeof item.model === 'string' ? item.model : '',
      }
    }
    return out
  } catch {
    return {
      chat: emptyOverride(),
      summary: emptyOverride(),
      search: emptyOverride(),
      tts: emptyOverride(),
      asr: emptyOverride(),
    }
  }
}

/** 百分比设置统一按整数存，越界时退回默认值 */
const readNumber = (key: string, fallback: number, min: number, max: number): number => {
  const value = Number(read(key))
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  skin: read(KEYS.skin) === 'classic' ? 'classic' : 'paper',
  appIcon: initialAppIcon(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 阈值存百分比整数（30~95），用起来是小数；默认 70%
  compactThreshold: readNumber(KEYS.compactThreshold, 70, 30, 95) / 100,
  compactKeepRounds: readNumber(KEYS.compactKeepRounds, 6, 2, 20),
  compactMode: read(KEYS.compactMode) === 'model' ? 'model' : 'local',
  memoryPluginEnabled: initialMemoryPluginEnabled(),
  memoryServiceUrl: read(KEYS.memoryServiceUrl),
  memoryServiceToken: read(KEYS.memoryServiceToken),
  // 自动整理默认开着：装上就该自己把旧会话收进记忆，不需要用户先学会按按钮
  memoryAutoDigest: read(KEYS.memoryAutoDigest) !== 'false',
  memoryAutoDigestHours: readNumber(KEYS.memoryAutoDigestHours, 6, 1, 72),
  memoryAutoDigestBatch: readNumber(KEYS.memoryAutoDigestBatch, 5, 1, 20),
  memoryVectorEnabled: read(KEYS.memoryVectorEnabled) === 'true',
  memoryVectorBaseUrl: read(KEYS.memoryVectorBaseUrl) ?? '',
  memoryVectorModel: read(KEYS.memoryVectorModel) ?? '',
  memoryVectorApiKey: read(KEYS.memoryVectorApiKey) ?? '',
  endpoints: initialEndpoints(),
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setSkin = (skin: Skin) => {
  write(KEYS.skin, skin)
  useSettings.setState({ skin })
}

export const setAppIcon = (appIcon: AppIcon) => {
  write(KEYS.appIcon, appIcon)
  useSettings.setState({ appIcon })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

/** 阈值按百分比整数存，界面显示的也是 30%~95% */
export const setCompactThreshold = (value: number) => {
  const compactThreshold = Math.min(0.95, Math.max(0.3, value))
  write(KEYS.compactThreshold, String(Math.round(compactThreshold * 100)))
  useSettings.setState({ compactThreshold })
}

export const setCompactKeepRounds = (value: number) => {
  const compactKeepRounds = Math.min(20, Math.max(2, Math.round(value)))
  write(KEYS.compactKeepRounds, String(compactKeepRounds))
  useSettings.setState({ compactKeepRounds })
}

export const setCompactMode = (compactMode: CompactMode) => {
  write(KEYS.compactMode, compactMode)
  useSettings.setState({ compactMode })
}

/** 地址与 token 都按去掉首尾空格存；空串等于没填 */
export const setMemoryServiceUrl = (value: string | null) => {
  const memoryServiceUrl = value?.trim() || null
  write(KEYS.memoryServiceUrl, memoryServiceUrl)
  useSettings.setState({ memoryServiceUrl })
}

export const setMemoryServiceToken = (value: string | null) => {
  const memoryServiceToken = value?.trim() || null
  write(KEYS.memoryServiceToken, memoryServiceToken)
  useSettings.setState({ memoryServiceToken })
}

/** 记忆插件开关：打开后侧栏才长出记忆页，聊天里才出现记忆按钮 */
export const setMemoryPluginEnabled = (memoryPluginEnabled: boolean) => {
  write(KEYS.memoryPluginEnabled, String(memoryPluginEnabled))
  useSettings.setState({ memoryPluginEnabled })
}

export const setMemoryAutoDigest = (memoryAutoDigest: boolean) => {
  write(KEYS.memoryAutoDigest, String(memoryAutoDigest))
  useSettings.setState({ memoryAutoDigest })
}

export const setMemoryAutoDigestHours = (value: number) => {
  const memoryAutoDigestHours = Math.min(72, Math.max(1, Math.round(value)))
  write(KEYS.memoryAutoDigestHours, String(memoryAutoDigestHours))
  useSettings.setState({ memoryAutoDigestHours })
}

export const setMemoryAutoDigestBatch = (value: number) => {
  const memoryAutoDigestBatch = Math.min(20, Math.max(1, Math.round(value)))
  write(KEYS.memoryAutoDigestBatch, String(memoryAutoDigestBatch))
  useSettings.setState({ memoryAutoDigestBatch })
}

/** 向量检索默认关着：不填地址就等于没有它，不能影响开箱即用 */
export const setMemoryVectorEnabled = (memoryVectorEnabled: boolean) => {
  write(KEYS.memoryVectorEnabled, String(memoryVectorEnabled))
  useSettings.setState({ memoryVectorEnabled })
}

const writeText = (key: string, value: string | null) => {
  write(key, value?.trim() || null)
}

export const setMemoryVectorBaseUrl = (value: string) => {
  const memoryVectorBaseUrl = value.trim().replace(/\/+$/, '')
  writeText(KEYS.memoryVectorBaseUrl, memoryVectorBaseUrl)
  useSettings.setState({ memoryVectorBaseUrl })
}

export const setMemoryVectorModel = (value: string) => {
  const memoryVectorModel = value.trim()
  writeText(KEYS.memoryVectorModel, memoryVectorModel)
  useSettings.setState({ memoryVectorModel })
}

export const setMemoryVectorApiKey = (value: string) => {
  const memoryVectorApiKey = value.trim()
  writeText(KEYS.memoryVectorApiKey, memoryVectorApiKey)
  useSettings.setState({ memoryVectorApiKey })
}

/** 上一次自动整理跑到什么时候；这不是用户设置，单独存取，不放 store 里免得每次写都触发重渲染 */
export const lastAutoDigestAt = (): number => {
  const value = Number(read(KEYS.memoryAutoDigestAt))
  return Number.isFinite(value) && value > 0 ? value : 0
}

export const markAutoDigestAt = (time: number) => {
  write(KEYS.memoryAutoDigestAt, String(time))
}

/**
 * 改一条能力的接口覆盖。地址与密钥去掉首尾空格；地址末尾的斜杠去掉，
 * 否则拼出来的 /anthropic/v1 会出现双斜杠。
 */
export const setEndpointOverride = (
  capability: ApiCapability,
  patch: Partial<EndpointOverride>
) => {
  const current = useSettings.getState().endpoints
  const merged: EndpointOverride = { ...current[capability], ...patch }
  const next: EndpointOverride = {
    baseUrl: merged.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: merged.apiKey.trim(),
    model: merged.model.trim(),
  }
  const endpoints: EndpointSettings = { ...current, [capability]: next }
  write(KEYS.endpoints, JSON.stringify(endpoints))
  useSettings.setState({ endpoints })
}
