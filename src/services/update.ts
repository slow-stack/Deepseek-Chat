/**
 * 版本检查：从远端清单判断有没有新包，只做提示，不自动安装。
 *
 * 旁装 App 没法静默更新：这里只负责「知道有新版本 + 给出下载链接」，
 * 下载与安装交给系统浏览器（Capacitor 里用 target="_system" 打开）。
 *
 * 更新源按序尝试，逐源分类失败（network / rateLimited / noRelease / badResponse）：
 *   1. 上次成功的源（记在 localStorage，下次优先问它）；
 *   2. commit 哈希地址（绕开 jsDelivr 对分支地址的长缓存）；
 *   3. 静态清单镜像（raw + 各家 CDN 的 latest.json）；
 *   4. GitHub Releases API 兜底——镜像全挂或长期陈旧时，发布数据还有一条直连的路。
 *
 * 某个源返回的版本不比已装的新时按 stale 处理，继续问下一个源：
 * 陈旧镜像不挡路，别让它把「有新版本」瞒下来。
 */

const REPO = 'slow-stack/Deepseek-Chat'
const REF = 'main'
const FILE = 'release/latest.json'

/**
 * 静态清单地址，按顺序尝试，第一个取到就用。
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

/**
 * jsDelivr 对 @main 这类分支地址缓存得很久：发版后 purge 边缘节点也迟迟不刷，
 * 兜底源可能长时间回旧清单，让用户「检查不到新版本」。
 * commit 哈希地址不走分支缓存、即时生效——所以检查时先从 raw 拿 main 的最新哈希
 * （raw 不经过 jsDelivr），再用哈希去问各家 CDN，双保险。
 */
const KEY_MANIFEST_HASH = 'chat-demo:update-manifest-hash'

export const MANIFEST_HASH_URLS: string[] = [
  `https://fastly.jsdelivr.net/gh/${REPO}@{hash}/${FILE}`,
  `https://gcore.jsdelivr.net/gh/${REPO}@{hash}/${FILE}`,
  `https://cdn.jsdelivr.net/gh/${REPO}@{hash}/${FILE}`,
]

/** GitHub Releases API 兜底源：镜像全挂或长期陈旧时，发布数据还有一条直连的路 */
const RELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

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
/** 上次成功的源：存 key（'hash' / 'release-api'）或完整 URL，下次检查优先问它 */
const KEY_PREFERRED = 'chat-demo:update-preferred-source'

/** 两次自动检查之间的最小间隔 */
export const CHECK_INTERVAL = 6 * 60 * 60 * 1000

/** 每个源的超时；一个源卡住不拖累整次检查 */
const FETCH_TIMEOUT_MS = 6000

/**
 * dsh-Go 式失败分类：每个源连不上/被限流/没有发布版/返回了但读不懂，各是各的事。
 * 分类随 unreachable 结果带出去，调用方要细报时有的说。
 */
export type UpdateFailureKind = 'network' | 'rateLimited' | 'noRelease' | 'badResponse'

type FetchOutcome =
  | { ok: true; manifest: UpdateManifest }
  | { ok: false; kind: UpdateFailureKind }

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

/**
 * GitHub Releases API 返回的发布对象归一成清单：
 * tag_name 去掉 v 前缀当版本号；有 .apk 附件就直接给附件直链，否则给发布页。
 * /releases/latest 本身就排除 draft 与 prerelease，不用再筛。
 */
const normalizeRelease = (value: unknown): UpdateManifest | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const release = value as {
    tag_name?: unknown
    html_url?: unknown
    body?: unknown
    assets?: unknown
  }
  if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
    return null
  }
  const versionName = release.tag_name.replace(/^v/i, '').trim()
  if (!versionName) {
    return null
  }
  let downloadUrl = release.html_url
  if (Array.isArray(release.assets)) {
    const apk = release.assets.find(
      (asset): asset is { browser_download_url: string } =>
        !!asset &&
        typeof asset === 'object' &&
        typeof (asset as { browser_download_url?: unknown }).browser_download_url === 'string' &&
        /\.apk(\?|$)/i.test((asset as { browser_download_url: string }).browser_download_url)
    )
    if (apk) {
      downloadUrl = apk.browser_download_url
    }
  }
  const body =
    typeof release.body === 'string' && release.body.trim() !== '' ? release.body.trim() : null
  return {
    versionName,
    downloadUrl,
    ...(body ? { notes: body } : {}),
  }
}

/** 单个地址取清单；超时与失败按类返回，不吞成同一个 null */
const fetchOne = async (url: string): Promise<FetchOutcome> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) {
      // GitHub API 被 403 限流时是明确的 rateLimited；404 说明那个源没有这个东西
      if (response.status === 429 || response.status === 403) {
        return { ok: false, kind: 'rateLimited' }
      }
      if (response.status === 404) {
        return { ok: false, kind: 'noRelease' }
      }
      return { ok: false, kind: 'badResponse' }
    }
    const manifest = normalizeManifest(await response.json())
    return manifest ? { ok: true, manifest } : { ok: false, kind: 'badResponse' }
  } catch {
    /* 超时（abort）与网络错误在这里是同一件事：这个源现在够不着 */
    return { ok: false, kind: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** Releases API 兜底：同样分类失败，归一走 normalizeRelease */
const fetchLatestRelease = async (): Promise<FetchOutcome> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${RELEASE_API_URL}?t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        return { ok: false, kind: 'rateLimited' }
      }
      if (response.status === 404) {
        return { ok: false, kind: 'noRelease' }
      }
      return { ok: false, kind: 'badResponse' }
    }
    const manifest = normalizeRelease(await response.json())
    return manifest ? { ok: true, manifest } : { ok: false, kind: 'badResponse' }
  } catch {
    return { ok: false, kind: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** 存下来的 main 哈希还带着时，用哈希地址问一圈 CDN */
const fetchViaHash = async (): Promise<FetchOutcome> => {
  const hash = read(KEY_MANIFEST_HASH)
  if (!hash || !/^[0-9a-f]{40}$/.test(hash)) {
    return { ok: false, kind: 'noRelease' }
  }
  let kind: UpdateFailureKind = 'network'
  for (const template of MANIFEST_HASH_URLS) {
    const outcome = await fetchOne(template.replace('{hash}', hash))
    if (outcome.ok) {
      return outcome
    }
    kind = outcome.kind
  }
  return { ok: false, kind }
}

/** 从 raw 取 main 最新提交哈希存起来；失败不影响本次检查 */
const refreshHash = async (): Promise<void> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/commits/${REF}`,
      { signal: controller.signal, cache: 'no-store' }
    )
    if (!response.ok) {
      return
    }
    const sha = (await response.json())?.sha
    if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) {
      write(KEY_MANIFEST_HASH, sha)
    }
  } catch {
    /* api.github.com 连不上就下次再试 */
  } finally {
    clearTimeout(timer)
  }
}

type ManifestProbe =
  /** 某个源给出了清单（可能比已装新，也可能 stale） */
  | { found: true; manifest: UpdateManifest }
  /** 所有源都没给出可用的清单；failure 是最后一次尝试的分类 */
  | { found: false; failure: UpdateFailureKind }

/**
 * 按序问所有源，拿到第一个「比已装新」的清单就收工；
 * 全都 stale 就把第一份 stale 清单带回去（调用方据此回 latest）。
 *
 * 顺序：上次成功的源 → 哈希地址 → 静态镜像 → Releases API。
 * 静态镜像成功时顺手刷新哈希并记住这个源，下次检查优先问它。
 */
const fetchManifest = async (): Promise<ManifestProbe> => {
  const current = currentVersion()
  const preferred = read(KEY_PREFERRED)
  const tried = new Set<string>()
  let failure: UpdateFailureKind = 'network'
  let stale: UpdateManifest | null = null

  // 生成候选序列；preferred 命中的排最前，其余按默认顺序补齐
  const candidates: Array<{ key: string; fetch: () => Promise<FetchOutcome> }> = []
  if (preferred === 'hash') {
    candidates.push({ key: 'hash', fetch: fetchViaHash })
  } else if (preferred && preferred !== 'release-api' && /^https?:\/\//.test(preferred)) {
    candidates.push({ key: preferred, fetch: () => fetchOne(preferred) })
  } else if (preferred === 'release-api') {
    candidates.push({ key: 'release-api', fetch: fetchLatestRelease })
  }
  candidates.push({ key: 'hash', fetch: fetchViaHash })
  for (const url of UPDATE_MANIFEST_URLS) {
    candidates.push({ key: url, fetch: () => fetchOne(url) })
  }
  candidates.push({ key: 'release-api', fetch: fetchLatestRelease })

  for (const candidate of candidates) {
    if (tried.has(candidate.key)) {
      continue
    }
    tried.add(candidate.key)
    const outcome = await candidate.fetch()
    if (!outcome.ok) {
      failure = outcome.kind
      continue
    }
    // 这个源活着：记住它，下次优先问；但内容陈旧不挡路，继续问下一个源
    write(KEY_PREFERRED, candidate.key)
    if (compareVersions(outcome.manifest.versionName, current) > 0) {
      void refreshHash()
      return { found: true, manifest: outcome.manifest }
    }
    stale ??= outcome.manifest
  }
  if (stale) {
    return { found: true, manifest: stale }
  }
  return { found: false, failure }
}

export type CheckResult =
  | { status: 'newer'; update: AvailableUpdate }
  /** 清单取到了，但没有更新的版本 */
  | { status: 'latest' }
  /** 所有源都没给出清单；failure 说明卡在哪一类 */
  | { status: 'unreachable'; failure: UpdateFailureKind }
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

  const probe = await fetchManifest()
  if (!probe.found) {
    return { status: 'unreachable', failure: probe.failure }
  }
  write(KEY_LAST_CHECK, String(Date.now()))
  const current = currentVersion()
  if (compareVersions(probe.manifest.versionName, current) <= 0) {
    return { status: 'latest' }
  }
  if (read(KEY_DISMISSED) === probe.manifest.versionName) {
    return { status: 'latest' }
  }
  return { status: 'newer', update: { ...probe.manifest, current } }
}

/** 用户点了关闭：这个版本不再提示 */
export const dismissUpdate = (versionName: string) => {
  write(KEY_DISMISSED, versionName)
}
