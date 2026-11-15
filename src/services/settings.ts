import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 外观皮肤：paper 为新配的纸张配色，classic 还原官方原样 */
export type Skin = 'paper' | 'classic'

/** 摘要方式：local 本地拼段（不发请求、零成本），model 调模型生成（更好但多一次请求） */
export type CompactMode = 'local' | 'model'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、上下文压缩 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  skin: Skin
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
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  skin: 'chat-demo:skin',
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
