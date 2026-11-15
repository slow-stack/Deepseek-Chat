# 版本清单

App 启动时会取这个文件（`raw.githubusercontent.com/slow-stack/Deepseek-Chat/main/release/latest.json`），
比当前构建版本新就弹一个窗，列出这次改了什么，用户选「去下载」还是「稍后」；
关掉弹窗后侧栏底部还留一条提示，点「去下载」交给系统浏览器。
侧栏没有提示时，设置里「检查更新」也能手动查一次。

## 字段

| 字段 | 说明 |
| --- | --- |
| `versionName` | 最新版本号，按点分数字比较，要和 `package.json` 的 `version` 一致 |
| `downloadUrl` | 点「去下载」打开的地址，通常是这条版本的 Release 页 |
| `highlights` | 这次改了哪几条，字符串数组，弹窗按条列出；三到五条最合适 |
| `notes` | 一句话说明这次改了什么；没有 `highlights` 时弹窗显示这一句，侧栏提示也用它 |

`highlights` 和 `notes` 都可以不写，弹窗会显示「这次没有写更新说明」。
写了 `highlights` 就优先按条显示，`notes` 仍然会出现在侧栏提示条里。

## 发一个版本

1. 改 `package.json` 的 `version`（例如 `0.1.2`），重新构建 App 与 APK。
2. 把 APK 传到 GitHub Release，标签用 `v0.1.2`。
3. 把本文件的 `versionName` 改成 `0.1.2`、`downloadUrl` 指向那个 Release，`highlights` 逐条写清改了什么。**版本号必须比用户手上的新，弹窗才会出现。**
4. 提交到 `main`。之后所有旧版本的 App 下次启动就会看到提示（每 6 小时最多问一次）。

## 注意

- 旁装的 App 没法静默更新：下载完还要在系统安装器里点一次确认，这是 Android 的规矩，不是没做。
- 清单取不到（断网、地址写错、格式不对）时什么也不提示，不会打扰用户；只有手点「检查更新」才会明说连不上。
- 本地验证时可以用 `AR_UPDATE_MANIFEST=http://127.0.0.1:8100/latest.json npm run build` 指到别的地址。