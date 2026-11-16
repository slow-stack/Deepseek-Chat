/**
 * 应用内升级：下载、校验、调起系统安装器。
 *
 * 原生侧是 ApkInstallerPlugin.java（下载 + SHA-256 + FileProvider 安装），
 * 这里只负责调用顺序、进度回调和失败归类。网页里没有这个插件，
 * 所有函数都会退化成「做不到」，由调用方回退成浏览器下载。
 *
 * 失败分开报，因为处理办法不一样：
 *   - cancelled：用户自己点的取消，原生确认已经停了（不是失败，界面该安静回位）；
 *   - incomplete：字节数不对，重下一次大概率就好了；
 *   - tampered：字节数对但哈希不对，来源有问题，要重下并说清文件不对；
 *   - permission：用户还没给「安装未知应用」授权，引导去设置页；
 *   - unavailable：插件不在（网页）或系统没有安装器，退回浏览器。
 */

const PLUGIN_NAME = 'ApkInstaller'

type ProgressEvent = { bytes?: number; total?: number }

type ApkInstallerPlugin = {
  canInstall: () => Promise<{ allowed?: boolean }>
  openSettings: () => Promise<unknown>
  downloadAndVerify: (options: {
    url: string
    sha256?: string
    size?: number
    fileName?: string
  }) => Promise<{ path?: string; bytes?: number; sha256?: string }>
  install: (options: { path: string }) => Promise<{ opened?: boolean }>
  cancel: () => Promise<unknown>
  addListener: (
    event: 'progress',
    handler: (event: ProgressEvent) => void
  ) => Promise<{ remove: () => void }>
}

const plugin = (): ApkInstallerPlugin | null => {
  const capacitor = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
  const found = capacitor?.Plugins?.[PLUGIN_NAME]
  return found ? (found as ApkInstallerPlugin) : null
}

/** 只有装成 App 才有这条路；网页里返回 false，调用方回退成浏览器下载 */
export const canInstallInApp = (): boolean => plugin() !== null

export type InstallFailure =
  | 'cancelled'
  | 'incomplete'
  | 'tampered'
  | 'permission'
  | 'unavailable'
  | 'failed'

export type InstallOutcome =
  /** 系统安装器已经起来了，后面用户自己点「安装」 */
  | { ok: true; opened: true }
  /**
   * 用户点了取消。stopped＝原生确认下载已中断、半截文件已删；
   * completed＝取消发得太晚，安装包其实已经下载并校验完成，只是没去调安装器。
   * completed 一定带 path：界面上的「重试」靠它直接调安装器，不用重新下一遍。
   */
  | { ok: false; reason: 'cancelled'; detail: 'stopped' | 'completed'; path?: string }
  /** 还没授权：已经尽量把设置页打开，让用户回来重试 */
  | { ok: false; reason: 'permission'; settingsOpened: boolean }
  | { ok: false; reason: Exclude<InstallFailure, 'cancelled' | 'permission'>; detail?: string }

export type InstallOptions = {
  url: string
  sha256?: string
  size?: number
  fileName?: string
  /** 下载进度，percent 为 0–100（拿不到总长时是 null） */
  onProgress?: (bytes: number, total: number | null) => void
  /** 用户点了取消 */
  isCancelled?: () => boolean
}

/** 原生错误码 → 我们的失败归类 */
const classify = (code: string | undefined, message: string): Exclude<InstallFailure, 'cancelled'> => {
  const text = `${code ?? ''} ${message}`.toUpperCase()
  if (text.includes('E_SIZE_MISMATCH')) {
    return 'incomplete'
  }
  if (text.includes('E_HASH_MISMATCH')) {
    return 'tampered'
  }
  if (text.includes('E_NO_PERMISSION')) {
    return 'permission'
  }
  if (text.includes('E_NO_INSTALLER') || text.includes('E_NO_SETTINGS')) {
    return 'unavailable'
  }
  return 'failed'
}

/** 从 Capacitor 抛出的错误里把 code 挖出来，各版本包装不一样 */
const errorOf = (error: unknown): { code?: string; message: string } => {
  if (error instanceof Error) {
    const coded = error as Error & { code?: string }
    return { ...(coded.code ? { code: coded.code } : {}), message: error.message ?? '' }
  }
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown }
    return {
      ...(typeof value.code === 'string' ? { code: value.code } : {}),
      message: typeof value.message === 'string' ? value.message : String(error),
    }
  }
  return { message: String(error ?? '') }
}

/** 问一下现在能不能装（Android 8 起要「允许安装未知应用」） */
export const canRequestInstall = async (): Promise<boolean> => {
  const found = plugin()
  if (!found) {
    return false
  }
  try {
    const result = await found.canInstall()
    return result.allowed === true
  } catch {
    return false
  }
}

/** 打开「安装未知应用」授权页；系统不给开就返回 false */
export const openInstallSettings = async (): Promise<boolean> => {
  const found = plugin()
  if (!found) {
    return false
  }
  try {
    await found.openSettings()
    return true
  } catch {
    return false
  }
}

/** 用户中途放弃下载 */
export const cancelInstall = async (): Promise<void> => {
  const found = plugin()
  if (!found) {
    return
  }
  try {
    await found.cancel()
  } catch {
    /* 取消失败没有可补救的动作 */
  }
}

/**
 * 走完「下载 → 校验 → 调起安装器」。
 *
 * 不负责重试、不负责弹窗：失败只返回归类，由调用方决定文案与下一步，
 * 这样降级成「去浏览器下载」的逻辑就留在界面那一层，不会散在服务里。
 */
export const downloadAndInstall = async (options: InstallOptions): Promise<InstallOutcome> => {
  const found = plugin()
  if (!found) {
    return { ok: false, reason: 'unavailable', detail: 'plugin missing' }
  }

  if (!(await canRequestInstall())) {
    const settingsOpened = await openInstallSettings()
    return { ok: false, reason: 'permission', settingsOpened }
  }

  let removeListener: (() => void) | null = null
  try {
    if (options.onProgress && typeof found.addListener === 'function') {
      const handle = await found.addListener('progress', (event) => {
        const bytes = Number(event.bytes ?? 0)
        const total = Number(event.total ?? 0)
        options.onProgress?.(bytes, total > 0 ? total : null)
      })
      removeListener = () => {
        try {
          handle.remove()
        } catch {
          /* 监听器可能已随页面销毁 */
        }
      }
    }

    const downloaded = await found.downloadAndVerify({
      url: options.url,
      ...(options.sha256 ? { sha256: options.sha256 } : {}),
      ...(options.size && options.size > 0 ? { size: options.size } : {}),
      ...(options.fileName ? { fileName: options.fileName } : {}),
    })

    // 取消发得太晚：安装包已经下完并校验过了。停在安装器之前，不替用户装，
    // 但把 path 带回去——界面上的「重试」靠它直接调安装器，别再下一遍。
    if (options.isCancelled?.()) {
      const finished = downloaded.path ?? ''
      return finished
        ? { ok: false, reason: 'cancelled', detail: 'completed', path: finished }
        : { ok: false, reason: 'cancelled', detail: 'completed' }
    }

    const path = downloaded.path ?? ''
    if (!path) {
      return { ok: false, reason: 'failed', detail: 'no path' }
    }

    const installed = await found.install({ path })
    if (installed.opened !== true) {
      return { ok: false, reason: 'failed', detail: 'installer not opened' }
    }
    return { ok: true, opened: true }
  } catch (error) {
    const parsed = errorOf(error)
    // 原生确认下载被中断（半截文件已删）：这是用户要的结果，不是失败
    if (options.isCancelled?.()) {
      return { ok: false, reason: 'cancelled', detail: 'stopped' }
    }
    const reason = classify(parsed.code, parsed.message)
    if (reason === 'permission') {
      const settingsOpened = await openInstallSettings()
      return { ok: false, reason: 'permission', settingsOpened }
    }
    return { ok: false, reason, detail: parsed.message }
  } finally {
    removeListener?.()
  }
}

/**
 * 安装一个已经下好、校验过的包（「取消得晚」之后点重试走这里）。
 *
 * 不重新下载：包就在原生缓存里，直接推给系统安装器。失败归类与主流程一致，
 * 只是没有进度可报。
 */
export const installFromPath = async (path: string): Promise<InstallOutcome> => {
  const found = plugin()
  if (!found) {
    return { ok: false, reason: 'unavailable', detail: 'plugin missing' }
  }
  if (!(await canRequestInstall())) {
    const settingsOpened = await openInstallSettings()
    return { ok: false, reason: 'permission', settingsOpened }
  }
  try {
    const installed = await found.install({ path })
    if (installed.opened !== true) {
      return { ok: false, reason: 'failed', detail: 'installer not opened' }
    }
    return { ok: true, opened: true }
  } catch (error) {
    const parsed = errorOf(error)
    const reason = classify(parsed.code, parsed.message)
    if (reason === 'permission') {
      const settingsOpened = await openInstallSettings()
      return { ok: false, reason: 'permission', settingsOpened }
    }
    return { ok: false, reason, detail: parsed.message }
  }
}

/** 从下载地址里取个文件名，给原生侧写盘用 */
export const fileNameFromUrl = (url: string, versionName: string): string => {
  try {
    const parsed = new URL(url)
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
    if (/\.apk$/i.test(last)) {
      return last
    }
  } catch {
    /* 地址不合法就退回自己拼一个 */
  }
  return `DeepseekChat-${versionName}.apk`
}
