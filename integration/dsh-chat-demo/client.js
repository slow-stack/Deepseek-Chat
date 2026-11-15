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
    // iframe 里点了「返回对话」就发一条消息回来，由这里把它换成宿主的「回到会话」。
    // 宿主没有 closePanel 之类的东西：把 activePanelId 置回 null 就是回到会话
    // （dsh-client-ui-layout 的 LayoutController.selectPanel 注释原话：Select a global panel or return to the Conversation）。
    const LEAVE_MESSAGE = 'dsh-chat-demo:leave'
    let leave = null

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

    // 宿主自己的那圈「应用 / 编辑」顶栏是浮在面板上方的（约占面板顶部 32px），
    // 所以出口按钮放在 38px 那一行，既不被顶栏压住，也不挡 app 自己的标题。
    const CSS = [
      '.dsh-chat-demo-root{position:absolute;inset:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base, #fff)}',
      '.dsh-chat-demo-frame{flex:1;width:100%;border:0;display:block;background:transparent}',
      // 宿主侧的出口。iframe 里那个箭头要靠 postMessage 回来，链路上任何一环没接上
      // 就出不去；这一颗是同一个 React 树里直接调 layout，不依赖跨文档消息。
      '.dsh-chat-demo-exit{position:absolute;top:38px;right:12px;z-index:3;display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px 0 8px;border:1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,.12));border-radius:999px;background:var(--dsw-alias-bg-elevated, rgba(255,255,255,.92));backdrop-filter:blur(6px);color:inherit;font:inherit;font-size:12px;line-height:1;cursor:pointer;opacity:.75;transition:opacity .15s,background .15s}',
      '.dsh-chat-demo-exit:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}',
      '.dsh-chat-demo-exit-bad{opacity:1;border-color:rgba(200,70,70,.55);color:#c84646}',
      '.dsh-chat-demo-exit:focus-visible{outline:2px solid var(--dsw-alias-accent, #4d6bfe);outline-offset:2px;opacity:1}',
      // 底部入口：几何对齐宿主 sidebar.settings 那一排，只用宿主的 token，
      // 这样收起/展开两态和原生按钮同高同宽，不会把 footer 撑歪。
      '.dsh-chat-demo-entry{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer;text-align:left}',
      '.dsh-chat-demo-entry:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}',
      '.dsh-chat-demo-entry[data-narrow="1"]{justify-content:center;padding:0}',
      '.dsh-chat-demo-entry-glyph{display:inline-flex;flex:none;align-items:center;justify-content:center}',
      '.dsh-chat-demo-entry-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    ].join('')

    function Panel() {
      const frameRef = React.useRef(null)
      // 切换失败时按钮自己报一句，省得去翻控制台才知道点没点动。
      const [exitFailed, setExitFailed] = React.useState(false)
      const onExit = () => {
        const ok = leave ? leave() : false
        if (ok) return
        setExitFailed(true)
        setTimeout(() => setExitFailed(false), 2500)
      }
      React.useEffect(() => {
        refreshStatus()
        // 只认自己那个 iframe 发来的「返回」信号：宿主窗口里还跑着别的消息，
        // 不校验来源的话任何一个页面 postMessage 都能把面板顶掉。
        const onMessage = (event) => {
          const frame = frameRef.current
          if (frame && event.source !== frame.contentWindow) return
          const data = event && event.data
          if (data && typeof data === 'object' && data.type === LEAVE_MESSAGE && leave) leave()
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])
      return h(
        'div',
        { className: 'dsh-chat-demo-root', style: { position: 'absolute', inset: 0 } },
        h('style', { key: 'css' }, CSS),
        h('iframe', {
          key: 'frame',
          ref: frameRef,
          className: 'dsh-chat-demo-frame',
          src: iframeUrl,
          title: 'DeepseekChat',
          allow: 'clipboard-write; microphone',
        }),
        h(
          'button',
          {
            key: 'exit',
            type: 'button',
            className: exitFailed ? 'dsh-chat-demo-exit dsh-chat-demo-exit-bad' : 'dsh-chat-demo-exit',
            title: exitFailed ? '宿主拒绝了这次切换，控制台里有原因' : '返回 DSH 对话',
            onClick: onExit,
          },
          h(
            'svg',
            {
              width: 12,
              height: 12,
              viewBox: '0 0 16 16',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.6,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': 'true',
            },
            h('path', { d: 'M13 8H3.4' }),
            h('path', { d: 'M7.2 4L3.2 8l4 4' }),
          ),
          h('span', null, exitFailed ? '切不出去' : '返回对话'),
        ),
      )
    }

    // 只声明 slots：layout 用 ctx.get 取，拿不到也只是退化成「只会进不会出」，
    // 写进 inject 反而会让整块界面在服务没就绪时干脆不注册。
    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get ? ctx.get('slots') : ctx.slots
      if (!slots || typeof slots.register !== 'function') {
        console.warn('[dsh-chat-demo] 拿不到 slots 服务，界面不注册')
        return
      }
      const layout = (ctx.get && ctx.get('layout')) || ctx.layout || null
      const canSelect = !!layout && typeof layout.selectPanel === 'function'
      // 当前主面板是谁。宿主没暴露这个读取口时返回 null，入口退化成「只会进」。
      const activePanelId = () => {
        try {
          const info = layout && layout.panelInfo && layout.panelInfo.getSnapshot
            ? layout.panelInfo.getSnapshot()
            : null
          return info ? info.activePanelId ?? null : null
        } catch {
          return null
        }
      }
      // 入口是个开关：已经在面板里就回会话，否则进面板。桉桉 2026-11-15 原话
      // 「进去了没出来的入口啊」——同一个入口点回去，是最省事的出口。
      const open = () => {
        if (!canSelect) return
        if (activePanelId() === PANEL_ID) layout.selectPanel(null)
        else layout.selectPanel(PANEL_ID)
      }
      leave = () => {
        if (!canSelect) {
          console.warn('[dsh-chat-demo] 拿不到 layout.selectPanel，无法回到会话')
          return false
        }
        try {
          layout.selectPanel(null)
          return true
        } catch (err) {
          // 以前这里静默吞掉，导致「点了没反应」查不出原因；宿主若改了签名要能看见。
          console.warn('[dsh-chat-demo] selectPanel(null) 失败：', err)
          return false
        }
      }

      // 底部常驻入口。footer.action 是 list 插槽，宿主只传 { wide }；
      // 面板本身在 main 座位，点它走 layout.selectPanel(PANEL_ID)。
      slots.inject('sidebar.footer.action', () =>
        slots.register(
          { name: 'sidebar.footer.action', id: 'dsh-chat-demo-entry', order: 10, label: 'DeepseekChat' },
          (props) => {
            const wide = !!(props && props.wide)
            return h(
              'button',
              {
                type: 'button',
                className: 'dsh-chat-demo-entry',
                'data-narrow': wide ? '0' : '1',
                title: 'DeepseekChat',
                'aria-label': 'DeepseekChat',
                onClick: open,
              },
              h('span', { className: 'dsh-chat-demo-entry-glyph' }, h(Icon, { size: wide ? 16 : 18 })),
              wide ? h('span', { className: 'dsh-chat-demo-entry-label' }, 'DeepseekChat') : null,
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