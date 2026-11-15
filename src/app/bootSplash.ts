/**
 * 开屏动画由 index.html 内联的 #boot-splash 承担：首帧即播，不等 JS 包下载。
 * 这里只负责在合适的时机把它淡出移除，并保证一个最短停留时间，
 * 免得包加载太快、动画只播一半就被抽掉。
 *
 * 隐藏条件：App 进入可用状态（ready）或初始化报错；另外有一个硬上限兜底。
 */

const FADE_MS = 260
/** 动画整套跑完约 1.38s（气泡 0.52 + 线 0.4/0.32 + 上浮 0.86~1.28 + 名字 0.92~1.38）。 */
const MIN_VISIBLE_MS = 1180
const REDUCED_MIN_VISIBLE_MS = 240
/** 初始化迟迟不完成时，最晚这么久也要让出画面，让用户看到加载/重试界面。 */
const MAX_VISIBLE_MS = 3200

declare global {
  interface Window {
    /** index.html 内联脚本记下的开屏起始时刻（performance.now 基准）。 */
    __bootStartedAt?: number
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0)

// 用内联脚本记下的时刻，而不是本模块求值时刻：模块要等 JS 包下载解析完才执行，
// 从那时算起会把动画已经播过的部分丢掉。
const startedAt = typeof window !== 'undefined' && window.__bootStartedAt ? window.__bootStartedAt : now()
let removed = false
let pending = false

const prefersReducedMotion = (): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function removeSplash(): void {
  const el = document.getElementById('boot-splash')
  if (!el) {
    removed = true
    return
  }
  if (removed) {
    return
  }
  removed = true

  const finish = (): void => {
    el.remove()
  }
  el.classList.add('is-leaving')
  el.addEventListener('transitionend', finish, { once: true })
  // transitionend 在后台标签页或被跳过的过渡里可能不触发，兜一层。
  window.setTimeout(finish, FADE_MS + 160)
}

/** 淡出开屏。重复调用安全，只生效一次。 */
export function dismissBootSplash(): void {
  if (removed || pending) {
    return
  }
  pending = true

  const minVisible = prefersReducedMotion() ? REDUCED_MIN_VISIBLE_MS : MIN_VISIBLE_MS
  const delay = Math.max(0, minVisible - (now() - startedAt))
  window.setTimeout(removeSplash, delay)
}

// 初始化卡住时也要退出开屏，别把用户锁在动画上。
if (typeof window !== 'undefined') {
  window.setTimeout(removeSplash, MAX_VISIBLE_MS)
}
