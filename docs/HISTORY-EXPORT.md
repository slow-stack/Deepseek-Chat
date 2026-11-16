# App 内导出历史对话

导出在浏览器里一直正常，装成 App 之后却**一个文件都产不出来**——按钮变灰、几十秒过去什么也没有。
这里记下原因、修法和验证方法。

## 一、为什么安卓上导出从来没成功过

导出走的是这条路：

```
exportHistory() → Blob → URL.createObjectURL(blob) → <a download>.click()
```

浏览器认这一段，WebView 不认。两处卡点：

1. `@capacitor/android` 的 `Bridge.launchIntent` 里有一句
   `if (url.getScheme().equals("data") || url.getScheme().equals("blob")) return false;`
   —— `blob:` 直接返回，连尝试都不尝试。
2. 整个 `@capacitor/android` 里**没有** `DownloadListener`、也没有 `setDownloadManager`
   （`grep -r 'DownloadListener|DownloadManager'` 命中 0）。

两件事叠在一起，那次 `click()` 就被静默吞掉了：没有异常、没有提示，看起来就像点了没反应。

## 二、修法：原生 SAF 保存

新增原生插件 `SaveFilePlugin`（`android/app/src/main/java/com/slowstack/deepseekchat/SaveFilePlugin.java`），
用 SAF 让用户自己挑保存位置：

| 方法 | 干什么 |
| --- | --- |
| `pick {fileName, mimeType}` | `ACTION_CREATE_DOCUMENT` 弹系统保存框；用户取消回 `{cancelled:true}`，不算错误 |
| `write {uri, data, append}` | 把一块 base64 追加进用户选的文件，`append:false` 为覆盖 |
| `remove {uri}` | 写入中途失败时删掉半成品，不在文档目录留坏 ZIP |

要点：

- **不申请存储权限**。SAF 的 `ACTION_CREATE_DOCUMENT` 自带授权，`takePersistableUriPermission` 拿不到也照样能写完。
- **分块写**，前端每块 1 MB（`src/services/saveFile.ts` 的 `CHUNK_SIZE` 与原生 `MAX_CHUNK` 必须一致）。
  一次性把几兆 base64 塞进桥调用会明显卡住。
- **写盘放在自建线程**（`Thread("save-file")`，daemon），不用 `getBridge().execute()`。
  原因和 `ApkInstallerPlugin` 一样：Capacitor 把所有 `@PluginMethod` 串行在同一个 `taskHandler` 上，
  在里面做大块 IO 会把其它插件调用（包括取消）一起堵住。

前端（`src/services/saveFile.ts`）只在原生环境启用（`window.Capacitor.Plugins.SaveFile` 存在）：

- `canSaveToDevice()` 为真 → `saveBlobToDevice()`：先弹保存框，再逐块写，失败清理后抛错。
- 用户在保存框里按取消抛 `SaveCancelled`，设置页把它当「已取消」，不报失败。
- 网页里 `canSaveToDevice()` 为假，仍旧走 `link.click()`，行为不变。

## 三、进度反馈

导出分三段，每段都报进度，面板挂在 `App` 上（`HistoryProgress`），切页面也看得见：

| 阶段 | 界面文案 | 能取消吗 |
| --- | --- | --- |
| `reading` | 正在导出历史对话 · 已导出 N / M 个对话 | 能 |
| `packing` | 正在打包 · 正在写入压缩包… | 能 |
| `saving` | 正在保存文件 · 请选择保存位置… | **不能** |

`saving` 不给取消：文件已经开始写进用户挑的位置，中途停下会在文档目录里留个坏 ZIP。
取消信号沿 `AbortSignal` 传到逐会话循环和 ZIP 的每个 chunk 前，按下取消立刻停、不留半成品。

成功时状态行写「已保存为 <文件名>。」；取消写「已取消导出，没有生成文件。」。

## 四、验证方法

无头 Edge + CDP 探针（`.tmp-export/`，仅本地临时用，不入库）：

1. `verify.mjs` — 造 300 个会话（每 3 个带图片）→ 点「下载」→ 采样进度文案 → 检查 ZIP：
   期望进度从 `已导出 0 / 300` 逐条递增，然后出现「正在打包」，最后生成约 8.2 MB 的 ZIP，
   含 `manifest.json`、300 份会话 JSON、100 张图片。
2. `cancel.mjs` — 造 600 个会话，跑到 `已导出 54 / 600` 时点「取消」：
   期望 0.15 秒内面板消失、状态行变「已取消导出」、没有任何下载、零异常。

**原生保存这一段只能真机验**：网页里没有 `SaveFile` 插件，`canSaveToDevice()` 恒为假。
真机验收：装 0.2.4 → 设置 → 数据管理 → 下载 → 应弹出系统保存框 → 选位置 → 提示「已保存为 …」
→ 用文件管理器确认 ZIP 存在且能重新导入。
