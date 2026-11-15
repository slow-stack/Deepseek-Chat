/**
 * dsh-chat-demo —— Client 半边
 *
 * 挂两个座位：
 *   sidebar.footer.action → 左侧栏底部常驻入口（桉桉 2026-11-15 定的形态：像 Bot 那样底部一个入口）
 *   main (keyed)          → 整页 chat-demo
 *
 * 面板里是一个指向 http://127.0.0.1:<port>/ 的 iframe。之所以不把 chat-demo 的界面
 * 重写成宿主 React 组件：它是一整套自带设计、自带存储（IndexedDB）、自带流式会话层的
 * 独立应用，移植等于重写；而 iframe 换来的是一份原样可用的东西 + 一个稳定 origin。
 * 代价是它拿不到宿主主题——这一条在这里是有意的：它本来就不该长得像 DSH。
 *
 * 注册 id 必须等于 loader entry 名（dsh-chat-demo），否则 ModuleLoader 会报
 * "loaded without registering dsh-chat-demo"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-chat-demo',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'chat-demo'
    const FALLBACK_URL = 'http://127.0.0.1:8096/'
    let iframeUrl = FALLBACK_URL
    let statusKnown = false

    // 宿主那条 /api/dsh-chat-demo/status 只报「服务在不在、端口多少」，
    // 拉一次把面板的地址对齐到真正在跑的那台。
    function refreshStatus() {
      try {
        fetch('/api/dsh-chat-demo/status', { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data && typeof data.url === 'string' && data.url) iframeUrl = data.url
            statusKnown = Boolean(data)
          })
          .catch(() => { /* 拿不到就用兜底地址 */ })
      } catch {
        /* 同上 */
      }
    }

    function Icon(props) {
      const size = (props && props.size) || 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M4 5.5h16v10H9.5L4 19V5.5z' }),
        h('path', { d: 'M8.5 9.5h7' }),
        h('path', { d: 'M8.5 12.5h4' }),
      )
    }

    const CSS = [
      '.dsh-chat-demo-root{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base, #fff)}',
      '.dsh-chat-demo-frame{flex:1;width:100%;border:0;display:block;background:transparent}',
      // 底部入口：几何对齐宿主 sidebar.settings 那一排，只用宿主的 token，
      // 这样收起/展开两态和原生按钮同高同宽，不会把 footer 撑歪。
      '.dsh-chat-demo-entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.dsh-chat-demo-entry:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}',
      '.dsh-chat-demo-entry[data-narrow="1"]{justify-content:center;padding:0}',
      '.dsh-chat-demo-entry-glyph{display:inline-flex;flex:none;align-items:center;justify-content:center}',
      '.dsh-chat-demo-entry-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('')

    function Panel() {
      React.useEffect(() => {
        refreshStatus()
      }, [])
      return h(
        'div',
        { className: 'dsh-chat-demo-root', style: { position: 'absolute', inset: 0 } },
        h('style', { key: 'css' }, CSS),
        h('iframe', {
          key: 'frame',
          className: 'dsh-chat-demo-frame',
          src: iframeUrl,
          title: 'Deepseek Chat',
          allow: 'clipboard-write; microphone',
        }),
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get ? ctx.get('slots') : ctx.slots
      if (!slots || typeof slots.register !== 'function') {
        console.warn('[dsh-chat-demo] 拿不到 slots 服务，界面不注册')
        return
      }
      const layout = (ctx.get && ctx.get('layout')) || ctx.layout || null
      const open = () => {
        if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
      }

      // 底部常驻入口。footer.action 是 list 插槽，宿主只传 { wide }；
      // 面板本身在 main 座位，点它走 layout.selectPanel(PANEL_ID)。
      slots.inject('sidebar.footer.action', () =>
        slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-chat-demo-entry', order: 10, label: 'Deepseek Chat' },
          (props) => {
            const wide = !!(props && props.wide)
            return h(
              'button',
              {
                type: 'button',
                className: 'dsh-chat-demo-entry',
                'data-narrow': wide ? '0' : '1',
                title: 'Deepseek Chat',
                'aria-label': 'Deepseek Chat',
                onClick: open,
              },
              h('span', { className: 'dsh-chat-demo-entry-glyph' }, h(Icon, { size: wide ? 16 : 18 })),
              wide ? h('span', { className: 'dsh-chat-demo-entry-label' }, 'Deepseek Chat') : null,
            )
          },
        ),
      )

      slots.inject('main', () =>
        slots.register({ name: 'main', key: PANEL_ID }, () => h(Panel)),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test = { Icon, Panel }
    return module.exports
  },
})