import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupPwa } from './app/pwa.js'
import { setupTheme } from './app/theme.js'
import { installEndpointResolver } from './services/api/endpoints.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

// 分能力接口要在第一个请求发出前装好，否则会用到构建期的默认地址。
installEndpointResolver()
ensureKatex()
setupTheme()
// 浏览器里注册离线外壳并申请持久存储；面板内嵌与安卓 App 里两者都会跳过。
setupPwa()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
