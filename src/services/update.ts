/**
 * 版本检查：从远端清单判断有没有新包，只做提示，不自动安装。
 *
 * 旁装 App 没法静默更新：这里只负责「知道有新版本 + 给出下载链接」，
 * 下载与安装交给系统浏览器（Capacitor 里用 target="_system" 打开）。
 * 清单是一个 JSON 文件，字段见 UpdateManifest。
 */

/** 远端版本清单；构建时可用 AR_UPDATE_MANIFEST 覆盖（本地测试用） */
export const UPDATE_MANIFEST_URL =
  __UPDATE_MANIFEST__ ||
  'https://raw.githubusercontent.com/slow-stack/Deepseek-Chat/main/release/latest.json'

export type UpdateManifest = {
  /** 版本名，按点分段比较，如 0.1.2 */
  versionName: string
  /** 下载地址，指向 APK 或发布页 */
  downloadUrl: string
  /** 可选：一句话说明这次更新了什么 */
  notes?: string
}

export type AvailableUpdate = UpdateManifest & { current: string }

const KEY_LAST_CHECK = 'chat-demo:update-last-check'
const KEY_DISMISSED = 'chat-demo:update-dismissed'

/** 两次自动检查之间的最小间隔 */
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000

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
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

/** 当前构建的版本号，由 rspack 写进 index.html 的 meta */
export const currentVersion = () => {
  const meta = document.querySelector('meta[name="application-version"]')
  return meta?.getAttribute('content') ?? '0.0.0'
}

/** 按点分数字比较：a 比 b 新返回正数，相同返回 0 */
export const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

const isValidManifest = (value: unknown): value is UpdateManifest => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const manifest = value as UpdateManifest
  return typeof manifest.versionName === 'string' && typeof manifest.downloadUrl === 'string'
}

export type CheckResult =
  | { status: 'newer'; update: AvailableUpdate }
  /** 清单取到了，但没有更新的版本 */
  | { status: 'latest' }
  /** 清单取不到或格式不对：网络、地址、离线都可能 */
  | { status: 'unreachable' }
  /** 距上次检查不到 CHECK_INTERVAL，这次没查 */
  | { status: 'throttled' }

/**
 * 取远端清单并判断是否需要提示。
 * force=false 时受 CHECK_INTERVAL 节流；失败只返回状态，由调用方决定要不要打扰用户。
 */
export const checkForUpdate = async ({ force = false } = {}): Promise<CheckResult> => {
  const last = Number(read(KEY_LAST_CHECK) ?? 0)
  if (!force && Date.now() - last < CHECK_INTERVAL) {
    return { status: 'throttled' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(`${UPDATE_MANIFEST_URL}?t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      return { status: 'unreachable' }
    }
    const data: unknown = await response.json()
    if (!isValidManifest(data)) {
      return { status: 'unreachable' }
    }
    write(KEY_LAST_CHECK, String(Date.now()))
    const current = currentVersion()
    if (compareVersions(data.versionName, current) <= 0) {
      return { status: 'latest' }
    }
    if (read(KEY_DISMISSED) === data.versionName) {
      return { status: 'latest' }
    }
    return { status: 'newer', update: { ...data, current } }
  } catch {
    return { status: 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

/** 用户点了关闭：这个版本不再提示 */
export const dismissUpdate = (versionName: string) => {
  write(KEY_DISMISSED, versionName)
}