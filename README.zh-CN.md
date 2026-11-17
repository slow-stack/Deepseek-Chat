# DeepseekChat

[English](README.md) | 简体中文

一个把整段对话留住的 DeepSeek 聊天客户端：你试过的每个分支、留下的每条回复，都还在。

不需要应用后端，浏览器直接请求你配置的 API 服务。同一份构建产物可以当静态网站跑，可以挂在 DeepSeek Harness 里当面板，也可以打成安卓 App。

这是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的 fork，本 fork 增加的东西见[下面的清单](#本-fork-增加了什么)。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/slow-stack/Deepseek-Chat.git
cd Deepseek-Chat
pnpm install
pnpm dev
```

打开 http://localhost:8090。构建静态站点：

```sh
pnpm build
```

产物在 `dist/`。放到静态服务器上，或者直接打开 `dist/index.html`——后者需要浏览器支持 `file://` 页面的存储，并且 API 服务允许这些页面的跨域请求。

## 装到 iPhone 主屏幕

网页版就是一个完整的 App，不需要装包、不用越狱、不用开发者账号。iOS 上用 Safari 打开 [slow-stack.github.io/Deepseek-Chat](https://slow-stack.github.io/Deepseek-Chat/)，按分享 → 「添加到主屏幕」，之后从主屏图标进去就是全屏，没有地址栏。

**加完请先联网打开一次。** 离线外壳是 Service Worker 在这一趟里存下的；没联网走过这一趟就断网启动，只会看到开屏撤掉之后的空白页。

首次打开要填自己的 API Key 与接口地址（设置 → 模型）。会话存在本机 IndexedDB，不上传任何服务器；iOS 上「七天无互动被清」的限制对主屏应用不适用，但设备空间吃紧时仍可能被系统回收，要紧的对话请定期导出备份。

安卓请装 APK（见 [release/README.md](release/README.md)），比网页版多原生外壳与文件关联。

GitHub Pages 不支持自定义缓存头，`sw.js` 只能吃到平台默认的十分钟缓存，所以发版后老版本退场可能延后最多十分钟。这是托管平台的限制，不是代码问题；本地预览（`node deploy/serve.mjs`）对 `sw.js` 与 manifest 发 `no-cache`，没有这段延迟。

## 功能

- 多个会话，自动标题、重命名、删除；可编辑提问、重新生成回复、在消息分支之间切换。
- 流式回复、深度思考、联网搜索、读链接、引用来源；可随时停止或继续生成。
- 上传、粘贴、拖拽附件；语音输入与朗读回复，手机上录音时输入框第一行显示实时音频频谱。
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表。
- 中英双语、明暗主题、移动端布局、位置设置、历史导入导出。

## 本 fork 增加了什么

- **长对话留在上下文窗口里。** 会话超过上限时，较早的轮次被压缩成摘要，输入框旁的标签写明折进去了什么，也能点开看。
- **面板里的回头路。** 在 DeepSeek Harness 里，返回按钮归宿主而不是 App：它直接调 `layout.selectPanel(null)`，宿主拒绝时按钮变红说明情况，不会让人卡在页面上出不去。
- **启动时检查更新。** 旁装包会问发布清单有没有新版本，有就给下载入口，绝不自动安装。见 [release/README.md](release/README.md)。
- **导入历史更快。** 21MB 归档在手机级 CPU 上从 11.2s 降到约 4.5s，因为 ZIP 读取不再逐字节校验 CRC32。

## 目录

```text
src/                   应用源码
  app/                 布局、主题、全局样式
  components/          聊天、设置、Markdown 等界面
  services/
    api/               请求、SSE、协议类型
    chat/              会话、分支、存储、导入导出、上下文压缩
  services/update.ts   版本清单检查
release/               更新检查读取的发布清单
scripts/               构建脚本
```

另有两个集成：

- `integration/dsh-chat-demo/` —— DeepSeek Harness 面板：宿主进程在固定端口上提供 `dist/`，客户端注册侧栏入口与整页 iframe。端口固定是因为会话存储按 origin 隔离。详见它的 [README](integration/dsh-chat-demo/README.md)。
- 安卓外壳（Capacitor）不在本仓库里维护，它包的是同一份 `dist/` 构建。

## 数据与存储

API Key 与设置存在浏览器 localStorage；会话与原始附件存在 IndexedDB，按浏览器 profile 与 origin 隔离。发消息、传附件、用语音都会把相应内容发给配置的 API 服务。

历史导入导出使用 ZIP 归档。导入在校验通过后会替换本地全部会话与附件；导出包含会话与可获得的原始图片，不含 API Key、设置与非图片附件。归档格式见 [src/services/chat/history/README.md](src/services/chat/history/README.md)。

设置 → 数据 → 删除全部对话会在确认后清空本地会话、附件与草稿，保留 API Key 与设置。

## 开发

| 命令               | 说明                         |
| ------------------ | ---------------------------- |
| `pnpm dev`         | 启动开发服务器               |
| `pnpm build`       | 构建到 `dist/`               |
| `pnpm build:panel` | 构建并部署到 DSH 面板        |
| `pnpm type`        | TypeScript 类型检查          |
| `pnpm lint`        | 用 oxlint 检查               |
| `pnpm format`      | 用 oxfmt 格式化              |

iOS 主屏的启动图由 `node scripts/make-splash.mjs` 生成（需要 ImageMagick），换掉鲸鱼图标时重跑它，别手改 `public/icons/splash-*.png`。

[rspack.config.ts](rspack.config.ts) 默认指向 `https://api.deepseek.com`，可用 `createConfig({ apiOrigin, devServer })` 改。聊天默认走 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API；语音走 ASR/TTS 接口。请求里带了搜索、读链接、标题与 `latest_reminder` 等扩展字段，所以配置的服务要支持对应能力。附件格式由服务端校验决定。

## 反馈

没有后台，也没有群聊。三条路都通到同一个地方：

- **GitHub 工单**：bug 与功能建议，公开可跟进，提之前先搜一下
- **邮件**：work@modusensus.space，不想注册账号就走这条
- **复制**：在「设置 → 关于 → 反馈」里复制正文，贴到哪儿都行

应用内那个弹窗会替你把标题和正文写好，也可以附上版本与平台（不含任何对话内容或密钥）。详见 [docs/FEEDBACK.md](docs/FEEDBACK.md)。
## 声明

- **非官方客户端。** 本项目由第三方维护，与 DeepSeek 官方无关联，未获其授权或背书；「DeepSeek」是其权利人的商标。
- **API 由你自备。** 应用不含任何密钥，也不经过本项目的服务器：请求直接从你的设备发往你自己配置的接口，费用与用量由你的账号承担。
- **数据留在本机。** 会话、附件、项目与记忆配置都存在浏览器的 IndexedDB 里，卸载或清除站点数据即会删除，请自行备份。
- **按现状提供。** 不作任何明示或默示担保，因使用产生的后果由使用者承担。

## 许可

[MIT](LICENSE)。构建会把许可证与 [NOTICE](NOTICE) 一起拷到 `dist/`，分发时一并带上。第三方依赖各自遵循自己的许可，图标取自 [Lucide](https://lucide.dev)（ISC）。

上游项目是 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)，同为 MIT。与上游保持一致的部分会继续兼容，上面列的是本 fork 自己的改动。