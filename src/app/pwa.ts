/**
 * PWA 相关的一次性初始化：注册 Service Worker、申请持久化存储。
 *
 * 有两个地方要跳过，跳过的原因不一样：
 * - DSH 面板（iframe）：面板由宿主从 integration/dsh-chat-demo/dist 提供，装 SW 会把
 *   面板自己的资源也缓存住，发新版时容易看到旧界面，而面板的纪律是永远跟最新构建。
 * - 安卓 App（Capacitor）：静态资源在 APK 里，更新靠安装包，SW 只会多一层缓存。
 */
const isEmbedded = () => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

const isNativeApp = () =>
  typeof (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform === 'function' &&
  Boolean(
    (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  )

const registerWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    return
  }
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' })
  } catch {
    // 注册失败不影响主流程：页面照常联网用，只是没有离线外壳。
  }
}

/**
 * 申请持久化存储。
 *
 * Safari 只在「加到主屏的网页应用」这类场景才比较容易批准，普通标签页多半返回 false。
 * 批不批都不改变界面上那句告知——存储始终是「尽力保留」，不是保证。
 */
const requestPersistentStorage = async () => {
  try {
    const storage = navigator.storage
    if (!storage?.persist || (await storage.persisted())) {
      return
    }
    await storage.persist()
  } catch {
    // 拿不到 StorageManager 的老浏览器直接跳过。
  }
}

/** 只在真正的浏览器环境里启用，且必须在 window load 之后调用 */
export const setupPwa = () => {
  if (isEmbedded() || isNativeApp()) {
    return
  }
  if (document.readyState === 'complete') {
    void registerWorker()
    void requestPersistentStorage()
    return
  }
  window.addEventListener(
    'load',
    () => {
      void registerWorker()
      void requestPersistentStorage()
    },
    { once: true }
  )
}

/**
 * 是否是「独立网页」场景（浏览器或加到主屏），也就是存储告知该不该出现。
 *
 * 安卓 App 里数据在应用自己的沙盒里，不会被浏览器的清理策略动到；
 * DSH 面板是桌面宿主里的 iframe，也没有主屏与标签页之说。这两处都不显示那句告知。
 */
export const isStandaloneWeb = () => !isEmbedded() && !isNativeApp()

/**
 * 是不是 iOS / iPadOS 上的浏览器。
 *
 * iPadOS 13 起默认报自己是 Macintosh，只能靠「触点数 > 1」把它和真 Mac 区分开。
 * 那句存储告知讲的是 Safari 的七天清理与主屏豁免，只有这里成立时才说得通。
 */
export const isIos = () => {
  if (typeof navigator === 'undefined') {
    return false
  }
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
    return true
  }
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}

