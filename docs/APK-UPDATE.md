# App 内更新：下载、校验、调起安装

旁装的 App 不能静默更新。这一版让「检查到新版本」之后能在 App 里自己下载、校验、跳到系统安装器，
用户只用在系统安装器里点一次确认。

## 一、签名基线（不要悄悄换）

0.2.1 / 0.2.2 / 0.2.3 的 APK 都是 **Android Debug** 证书：

| 项 | 值 |
| --- | --- |
| 证书 DN | `C=US, O=Android, CN=Android Debug` |
| SHA-256 | `5f22bf89b31abd368a24747b5a2119c5caba78d6d1740b2b39017aa1635322f2` |
| SHA-1 | `cf3bfb2c72b75671d1ef838fcde27b4695ebabf7` |

复核命令：

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\36.0.0\apksigner.bat" verify --print-certs <apk>
```

只要继续用 debug 签名，覆盖安装就不会撞 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。
**切 release 签名是单独一次决定**：签名一换，用户机器上的旧包装不上新版，必须先卸载，
所以不能夹在某次发版里悄悄换，要提前说。

### 包名基线

0.2.4 起 `applicationId` 从 `com.slowstack.ariadne` 改为 `com.slowstack.deepseekchat`，
与已有的 `namespace` 对齐（`build.gradle`、`capacitor.config.json`、`strings.xml` 三处一起改）。

换了 `applicationId` 就是另一个应用：装过旧包（`com.slowstack.ariadne`）的机器，
新包不会被当成升级、旧包的数据也带不过来，必须先卸载旧包再装。之后再改包名同样要单独决定。

### 版本号基线

0.2.3 及以前 Android 工程的 `versionName` / `versionCode` 一直停在 `0.2.0` / `2`（版本号靠 web 侧的
`application-version` 扛）。0.2.4 起 `build.gradle` 里同步为 `versionName "0.2.4"` / `versionCode 3`，
以后每次发版都要跟着改，否则系统层看到的版本与面板显示的版本会脱节。

## 二、流程

```
远端 latest.json ──► UpdateDialog 显示版本与改动
                          │ 用户点「下载并安装」
                          ▼
                    ApkInstaller.canInstall()
                     ├─ 没有「允许安装未知应用」授权 → 打开系统设置页，回来说「去设置」
                     └─ 有授权
                          ▼
                    ApkInstaller.downloadAndVerify(url, sha256, size)
                     原生一趟流式下载：边写盘边算 SHA-256，不把文件读进 JS
                          ├─ 字节数与清单不符 → E_SIZE_MISMATCH（下载不完整）
                          └─ 字节数对、哈希不对 → E_HASH_MISMATCH（文件被改过）
                          ▼
                    ApkInstaller.install(path)
                     FileProvider uri + ACTION_VIEW + APK MIME
                          ▼
                     系统安装器（用户点一次「安装」）
```

两个失败分开报，是因为它们的处理办法不一样：尺寸不符重下一次就好，哈希不符要重新下载并且说明文件不对。

### 为什么下载也放在原生做

`@capacitor/file-transfer` 能下载，但校验得把 7 MB 文件读成 base64 再在 JS 里算哈希，
内存与耗时都不划算，而且要额外引一个依赖。既然未知来源授权那段原生代码躲不掉，
下载+哈希+安装放在同一个插件里，一趟读完就把 SHA-256 算完，JS 侧只收进度和结论。

## 三、降级路径（必须一直能用）

下面任何一种情况都退回原来的「去下载」——用系统浏览器打开 Release 页，不把用户卡在不能动的状态：

- 网页里没有这个插件（`window.Capacitor.Plugins.ApkInstaller` 不存在）；
- 原生调用抛错但错误码没认出来；
- 用户拒绝授权、或设置页打不开；
- 安装器不存在（`ActivityNotFoundException`）。

失败时弹窗一定同时给「重试」和「改用浏览器下载」两个出口。

## 四、`release/latest.json` 的 sha256 / size 由脚本生成

不手抄。打完包直接跑：

```powershell
node scripts/release-manifest.mjs --apk C:\Users\石晴\Desktop\deepseek-chat-apk\DeepseekChat-0.2.4-debug.apk --version 0.2.4
```

脚本算 sha256 与字节数，写进 `release/latest.json` 的 `sha256` / `size` 两个字段，
`versionName` 与 `downloadUrl` 一并对齐（`downloadUrl` 默认指向这个 tag 的附件直链）。
`highlights` / `notes` 是人工写的，脚本不动它们。

清单里缺 `sha256` 时，App 仍能下载安装，只是不做哈希校验（尺寸仍会核）。
清单里缺 `size` 时同理，两项都缺就退化成「下载完直接装」。

## 五、真机验收清单

`adb devices` 里能看到手机之后跑一遍：

1. 旧版本 App 里收到新版本提示（或设置页手点「检查更新」）。
2. 第一次点「下载并安装」，若没授权会跳到「允许安装未知应用」设置页；打开它回来再点。
3. 下载中百分比在动，到 100% 之后显示「正在校验安装包」。
4. 校验通过后系统安装器弹出，点「安装」，装完打开确认版本号变了。
5. 把 `latest.json` 的 `sha256` 故意改错一位，重下一次：必须显示「文件校验不通过」而不是笼统的失败。
6. 把清单的 `size` 改小，重下一次：必须显示「下载不完整」。
7. 在浏览器（不含 App）里打开同一页面：按钮必须是「去下载」，点击走浏览器下载。

第 5、6 条验完记得把 `latest.json` 改回脚本生成的值。
