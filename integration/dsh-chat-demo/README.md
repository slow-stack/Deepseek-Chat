# dsh-chat-demo · 面板显示名 Ariadne

把 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（本仓库 `slow-stack/Deepseek-Chat`）作为 DSH 的一个面板挂起来。
侧栏入口与面板标题都叫 Ariadne。

## 两层

- **Host（index.js）**：把 `dist/` 挂在 `http://127.0.0.1:8096`（端口在 `cordis.patch.yml` 里配），
  并把 `POST /api/dsh-chat-demo/memory` 代转到 mneme 的 standalone API。
- **Client（client.js）**：注册 `sidebar.panellist`（左侧栏图标）与 `main`（整页 iframe）。

面板里的返回按钮归宿主：`client.js` 自己画那个按钮，点下去直接 `layout.selectPanel(null)`，不再依赖 App 内部的 postMessage 往返。

## 为什么是固定端口 + iframe

chat-demo 的会话与附件存在浏览器 IndexedDB，按 origin 隔离；端口一变就是另一个空库。
所以 origin 必须稳定，而 `http://127.0.0.1:8096` 是真实、稳定的 http origin。
桌面端 UI 跑在自定义协议上，那个 origin 下的 iframe 存储行为不可预期。

## 记忆面

这个插件不 import mneme，也不写会话日志：在 Ariadne 里聊什么都不会进 mneme。
隔离不是配置开关，是没有写入口。

## 安装（本机已装）

profile 的 `package.json`：

- `dependencies["dsh-chat-demo"] = "link:C:/Users/石晴/Desktop/deepseek-chat/integration/dsh-chat-demo"`
- `dsh.profile.bundles` 里追加 `"dsh-chat-demo"`

然后 `pnpm install --ignore-scripts`，重启 DSH。

## 更新界面

改完 `src/` 后重新构建，产物会自动同步进 `integration/dsh-chat-demo/dist`：

```sh
cd C:/Users/石晴/Desktop/deepseek-chat
pnpm build:panel
```

`scripts/build-panel.mjs` 会先清 `dist/`，再跑 rspack，然后同步到集成目录并校验 `index.html` 引用的 hashed 资源都在。
宿主侧插件代码（`client.js`）改了要刷新 DSH 页面才生效。