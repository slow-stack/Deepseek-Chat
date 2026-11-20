/**
 * 兜底失败页。这个文件必须能在「React 没起来、i18n 没加载、任何业务模块报错」的情况下
 * 照样工作，所以它不 import 应用里的任何东西——连 i18n 也不。文案在这里自带一份：
 * 这时候翻译表本身可能就是没加载到的那个东西，再依赖它等于把兜底也一起兜没了。
 *
 * 触发场景（都是「用户看到一片白」的那几种）：
 *   1. JS 包根本没下载/执行 —— 这条由 index.html 的内联脚本负责，本文件帮不上；
 *   2. 包执行了但 main.tsx 里某一步抛错（endpoint/主题/PWA/渲染）；
 *   3. React 渲染期崩溃（由 ErrorBoundary 接住）；
 *   4. 包跑起来了但一直没进入可用状态，且没有别的界面（由 App 侧判断）。
 *
 * 共同的底线：不许静默变白。哪怕只有一句话和一个「重新加载」，也比空白强。
 */

const RELEASES = 'https://github.com/slow-stack/Deepseek-Chat/releases/latest'
/** 兜底页自己的元素 id，重复调用时替换而不是叠一层。 */
const SCREEN_ID = 'ds-fatal-screen'

type Copy = {
  title: string
  lead: string
  retry: string
  download: string
  detail: string
}

const zh: Copy = {
  title: '页面没能加载出来',
  lead: '可能是网络不通、浏览器太旧，或者这个页面只加载了一半。重新加载一次通常就好了。',
  retry: '重新加载',
  download: '下载 App 版',
  detail: '技术细节',
}

const en: Copy = {
  title: 'The page failed to load',
  lead: 'The network may be blocked, the browser may be too old, or only part of the page arrived. Reloading usually fixes it.',
  retry: 'Reload',
  download: 'Get the app',
  detail: 'Details',
}

const copy = (): Copy => {
  let language = 'zh'
  try {
    language = navigator.language || 'zh'
  } catch {
    language = 'zh'
  }
  return copyFor(language)
}

/**
 * 按浏览器语言挑一套文案。抽成纯函数是为了能测：
 * 这里挑错了，非中文用户在最需要看懂的时刻会看到看不懂的字。
 */
export const copyFor = (language: string): Copy => {
  const tag = String(language ?? '').trim().toLowerCase()
  // 拿不到语言标记时按中文处理：这个仓库的反馈来源以中文用户为主，
  // 而给一个看不懂的人看英文，等于什么都没说。
  if (!tag) {
    return zh
  }
  return tag.startsWith('zh') ? zh : en
}

declare global {
  interface Window {
    /**
     * App 进入可用状态后置 true（App.tsx 里设）。兜底逻辑靠它区分
     * 「从来没跑起来」和「跑起来过、后来某个交互出错」——后者不该整页盖掉。
     */
    __dsAppMounted?: boolean
  }
}

const prefersDark = (): boolean => {
  try {
    const pref = localStorage.getItem('chat-demo:theme-preference')
    const dark = !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    return pref === 'dark' || ((pref === null || pref === 'system') && dark)
  } catch {
    return false
  }
}

const build = (options: { reason?: string; detail?: string }): HTMLElement => {
  const t = copy()
  const dark = prefersDark()

  const wrap = document.createElement('div')
  wrap.id = SCREEN_ID
  wrap.setAttribute('role', 'alert')
  wrap.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'box-sizing:border-box',
    `background:${dark ? '#131315' : '#faf9f6'}`,
    `color:${dark ? '#e8e4da' : '#201f1b'}`,
    "font:400 15px/1.6 system-ui,-apple-system,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',sans-serif",
    'overflow:auto',
  ].join(';')

  const card = document.createElement('div')
  card.style.cssText = 'max-width:420px;width:100%;text-align:center'

  const title = document.createElement('div')
  title.textContent = t.title
  title.style.cssText = 'font-size:17px;font-weight:600;margin-bottom:10px'
  card.appendChild(title)

  const lead = document.createElement('div')
  lead.textContent = t.lead
  lead.style.cssText = `font-size:14px;line-height:1.7;opacity:0.75;margin-bottom:20px${
    options.reason ? '' : ''
  }`
  card.appendChild(lead)

  if (options.reason) {
    const reason = document.createElement('div')
    reason.textContent = options.reason
    reason.style.cssText =
      'font-size:13px;line-height:1.6;opacity:0.6;margin:-12px 0 20px;word-break:break-word'
    card.appendChild(reason)
  }

  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap'

  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = t.retry
  retry.style.cssText = [
    'appearance:none',
    'border:0',
    'cursor:pointer',
    'height:38px',
    'padding:0 20px',
    'border-radius:19px',
    `background:${dark ? '#3964fe' : '#3964fe'}`,
    'color:#fff',
    'font:inherit',
    'font-size:14px',
  ].join(';')
  retry.addEventListener('click', () => {
    try {
      window.location.reload()
    } catch {
      /* 连 reload 都不行时，用户还能自己刷新 */
    }
  })
  actions.appendChild(retry)

  const link = document.createElement('a')
  link.href = RELEASES
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.textContent = t.download
  link.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'height:38px',
    'padding:0 20px',
    'border-radius:19px',
    'box-sizing:border-box',
    'text-decoration:none',
    `border:1px solid ${dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)'}`,
    'color:inherit',
    'font-size:14px',
  ].join(';')
  actions.appendChild(link)
  card.appendChild(actions)

  if (options.detail) {
    const details = document.createElement('details')
    details.style.cssText = 'margin-top:22px;text-align:left'
    const summary = document.createElement('summary')
    summary.textContent = t.detail
    summary.style.cssText = 'font-size:13px;opacity:0.55;cursor:pointer'
    details.appendChild(summary)
    const pre = document.createElement('pre')
    pre.textContent = options.detail
    pre.style.cssText = [
      'margin:10px 0 0',
      'padding:10px 12px',
      'border-radius:8px',
      'font-size:12px',
      'line-height:1.5',
      'white-space:pre-wrap',
      'word-break:break-word',
      'max-height:220px',
      'overflow:auto',
      `background:${dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.045)'}`,
      'opacity:0.85',
    ].join(';')
    details.appendChild(pre)
    card.appendChild(details)
  }

  wrap.appendChild(card)
  return wrap
}

/** 把开屏挪开，否则它会盖在兜底页上面（它的 z-index 是最大值）。 */
const dropSplash = (): void => {
  const splash = document.getElementById('boot-splash')
  if (splash && splash.parentNode) {
    splash.parentNode.removeChild(splash)
  }
}

/**
 * 显示兜底页。可以重复调用：后来的会替换掉前一个，并把新的错误文本带上。
 * 返回是否真的画出来了（拿不到 body 时返回 false）。
 */
export function showFatalScreen(options: { reason?: string; detail?: string } = {}): boolean {
  if (typeof document === 'undefined' || !document.body) {
    return false
  }
  dropSplash()
  const next = build(options)
  const prev = document.getElementById(SCREEN_ID)
  if (prev && prev.parentNode) {
    prev.parentNode.replaceChild(next, prev)
  } else {
    document.body.appendChild(next)
  }
  return true
}

let handlersInstalled = false
/** 报错先记着，等一会儿再决定要不要整页接管；期间 App 起来了就不管。 */
let pendingTimer: number | null = null
let pendingDetail = ''

/** App 正常起来后把可能已经画上的兜底页撤掉（早到的报错可能先占了屏）。 */
export function clearFatalScreen(): void {
  if (typeof document === 'undefined') {
    return
  }
  const el = document.getElementById(SCREEN_ID)
  if (el && el.parentNode) {
    el.parentNode.removeChild(el)
  }
}

/**
 * 挂全局兜底：未捕获异常与未处理的 Promise 拒绝。
 *
 * 不立即接管，而是等一小会儿再看 App 起没起来：
 * 启动早期的异步报错很常见，但其中大多数并不妨碍应用正常运行；
 * 一报错就糊一张错误页，反而把好了的页面盖掉（这正是之前实测踩到的假阳性）。
 */
export function installFatalHandlers(): void {
  if (handlersInstalled || typeof window === 'undefined') {
    return
  }
  handlersInstalled = true

  const describe = (value: unknown): string => {
    if (value instanceof Error) {
      return value.stack || `${value.name}: ${value.message}`
    }
    if (typeof value === 'string') {
      return value
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const schedule = (detail: string): void => {
    pendingDetail = pendingDetail ? `${pendingDetail}\n${detail}` : detail
    if (pendingTimer !== null) {
      return
    }
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null
      const detailNow = pendingDetail
      pendingDetail = ''
      if (window.__dsAppMounted) {
        return
      }
      const root = document.getElementById('root')
      if (root && root.childNodes.length > 0) {
        // App 已经画上东西了，只是还没走到 ready；不该被一张错误页盖掉。
        return
      }
      showFatalScreen({ detail: detailNow })
    }, 1500)
  }

  window.addEventListener('error', (event: ErrorEvent) => {
    if (window.__dsAppMounted) {
      return
    }
    const detail = [describe(event.error), event.filename ? `at ${event.filename}:${event.lineno}` : '']
      .filter(Boolean)
      .join('\n')
    schedule(detail)
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (window.__dsAppMounted) {
      return
    }
    schedule(describe(event.reason))
  })
}
