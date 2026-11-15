/**
 * 版本检查：从远端清单判断有没有新包，只做提示，不自动安装。
 *
 * 旁装 App 没法静默更新：这里只负责「知道有新版本 + 给出下载链接」，
 * 下载与安装交给系统浏览器（Capacitor 里用 target="_system" 打开）。
 * 清单是一个 JSON 文件，字段见 UpdateManifest。
 */

const REPO = 'slow-stack/Deepseek-Chat'
const REF = 'main'
const FILE = 'release/latest.json'

/**
 * 版本清单地址，按顺序尝试，第一个取到就用。
 *
 * raw.githubusercontent.com 在国内经常连不上，用户点「检查更新」只会看到
 * 「连不上更新源」。所以再放几个 jsDelivr 的 CDN 节点兜底——它们同样托管
 * 这个仓库的 main 分支，内容一致，且都回 `Access-Control-Allow-Origin: *`。
 *
 * 两家的路径格式不一样，别拼成一个模板：
 *   - raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>
 *   - cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/<path>   ← ref 前必须有 @
 */
export const UPDATE_MANIFEST_URLS: string[] = [
  ...(__UPDATE_MANIFEST__ ? [__UPDATE_MANIFEST__] : []),
  `https://raw.githubusercontent.com/${REPO}/${REF}/${FILE}`,
  `https://fastly.jsdelivr.net/gh/${REPO}@${REF}/${FILE}`,
  `https://gcore.jsdelivr.net/gh/${REPO}@${REF}/${FILE}`,
  `https://cdn.jsdelivr.net/gh/${REPO}@${REF}/${FILE}`,
]

/** 首个候选地址；保留导出是因为旧代码与测试引用它 */
export const UPDATE_MANIFEST_URL = UPDATE_MANIFEST_URLS[0]

export type UpdateManifest = {
  /** 版本名，按点分段比较，如 0.1.2 */
  versionName: string
  /** 下载地址，指向 APK 或发布页 */
  downloadUrl: string
  /** 可选：一句话说明这次更新了什么 */
  notes?: string
  /** 可选：这次更新改了哪几条，弹窗逐条列出；没有就退回 notes */
  highlights?: string[]
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

/** 清单校验 + 归一：highlights 只留非空字符串，字段缺失就当作没有 */
const normalizeManifest = (value: unknown): UpdateManifest | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const manifest = value as UpdateManifest
  if (typeof manifest.versionName !== 'string' || typeof manifest.downloadUrl !== 'string') {
    return null
  }
  const highlights = Array.isArray(manifest.highlights)
    ? manifest.highlights.filter(
        (item): item is string => typeof item === 'string' && item.trim() !== ''
      )
    : []
  return {
    versionName: manifest.versionName,
    downloadUrl: manifest.downloadUrl,
    ...(typeof manifest.notes === 'string' && manifest.notes.trim() !== ''
      ? { notes: manifest.notes }
      : {}),
    ...(highlights.length > 0 ? { highlights } : {}),
  }
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
 * 逐个候选地址取清单，第一个成功解析的胜出。
 * 每个地址单独计时，超时只影响它自己，不会把整次检查拖成 6 秒 × 个数。
 */
const fetchManifest = async (): Promise<UpdateManifest | null> => {
  for (const url of UPDATE_MANIFEST_URLS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok) {
        continue
      }
      const manifest = normalizeManifest(await response.json())
      if (manifest) {
        return manifest
      }
    } catch {
      /* 这个源连不上或返回不是 JSON，换下一个 */
    } finally {
      clearTimeout(timer)
    }
  }
  return null
}

/**
 * 取远端清单并判断是否需要提示。
 * force=false 时受 CHECK_INTERVAL 节流；失败只返回状态，由调用方决定要不要打扰用户。
 */
export const checkForUpdate = async ({ force = false } = {}): Promise<CheckResult> => {
  const last = Number(read(KEY_LAST_CHECK) ?? 0)
  if (!force && Date.now() - last < CHECK_INTERVAL) {
    return { status: 'throttled' }
  }

  const manifest = await fetchManifest()
  if (!manifest) {
    return { status: 'unreachable' }
  }
  write(KEY_LAST_CHECK, String(Date.now()))
  const current = currentVersion()
  if (compareVersions(manifest.versionName, current) <= 0) {
    return { status: 'latest' }
  }
  if (read(KEY_DISMISSED) === manifest.versionName) {
    return { status: 'latest' }
  }
  return { status: 'newer', update: { ...manifest, current } }
}

/** 用户点了关闭：这个版本不再提示 */
export const dismissUpdate = (versionName: string) => {
  write(KEY_DISMISSED, versionName)
}