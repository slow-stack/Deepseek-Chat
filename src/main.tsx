import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { ErrorBoundary } from './app/ErrorBoundary.js'
import { installFatalHandlers, showFatalScreen } from './app/fatalScreen.js'
import { setupPwa } from './app/pwa.js'
import { setupTheme } from './app/theme.js'
import { installEndpointResolver } from './services/api/endpoints.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

// 兜底要先挂：下面任何一步抛错，用户看到的应该是能读的一句话，而不是白屏。
// 注意顺序——监听器挂在最前，但真正决定「要不要整页接管」的是 window.__dsAppMounted，
// 那是 App 就绪后才置的，所以已经聊起来的用户不会因为一次异步报错被整页盖掉。
installFatalHandlers()

const describe = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`
  }
  return String(error)
}

/** 启动期任一步失败都落到同一张兜底页；不让异常冒到控制台就没人管。 */
const boot = (): void => {
  // 分能力接口要在第一个请求发出前装好，否则会用到构建期的默认地址。
  installEndpointResolver()
  ensureKatex()
  setupTheme()
  // 浏览器里注册离线外壳并申请持久存储；面板内嵌与安卓 App 里两者都会跳过。
  setupPwa()

  const container = document.getElementById('root')
  if (!container) {
    showFatalScreen({ reason: 'root container missing' })
    return
  }
  createRoot(container).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  )
}

try {
  boot()
} catch (error) {
  // 走到这里说明包执行了但启动就崩了——正是最容易被当成「网站坏了」的那种白屏。
  showFatalScreen({ detail: describe(error) })
}
