import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { installEndpointResolver } from './services/api/endpoints.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

// 分能力接口要在第一个请求发出前装好，否则会用到构建期的默认地址。
installEndpointResolver()
ensureKatex()
setupTheme()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
