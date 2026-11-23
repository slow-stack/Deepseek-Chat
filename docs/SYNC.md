# 多端同步：方案、接口与接入成本

这份文档只定方案，不含实现。

**会话同步顺延到 2026-12-20 之后开工。** 它绑着三件事：新起一个服务、改存储层、动安卓原生配置。
考前动它，一旦改坏就是「会话读不出来」，那才真的耽误事。

**记忆那条链路不等考后**，但它今天能用的形态是「一端写、其余只读」，不是双写——
多端并发写同一个守护进程会放大已知的并发问题，见第八节。

## 一、现在的数据在哪

这套应用没有账号、没有后端，全部数据在本机：

| 数据 | 位置 | 说明 |
| --- | --- | --- |
| 会话 | IndexedDB `chat-demo`，`DB_VERSION = 12` | 六张表：`sessions`、`sessionSummaries`、`files`、`projects`、`sessionsStaging`、`filesStaging` |
| 附件原件 | 同上，`files` 表 | 以附件本地 id 为 key 的 Blob，所有引用同一 id 的消息共用一份 |
| 设置 | localStorage | API Key、主题、字号、记忆服务地址与 token 等 |
| 记忆 | 默认本机 IndexedDB `chat-demo-memory`；填了记忆服务地址则走远端 mneme | 见 `src/services/chat/memory.ts` 的两条分支 |

唯一的跨设备通路现在是**导出 ZIP → 导入**，而且是全量覆盖：`src/services/chat/backup.ts`
的 `exportHistory()` 打出 `deepseek_data-*.zip`，导入侧整库替换。这条路留着，不废。

## 二、同步单位与冲突口径

**一台主机是真源，其余设备是入口。不做「每端一份副本再合并」。**

会话是带附件 Blob、带消息树（分支靠 `parent_id` 引用）的对象，字段级合并要处理
「两边各加了一条消息」「一边改名一边追加」这类组合，逻辑会一直长 bug。所以：

- **同步单位是整条会话**，不做字段合并。
- 每条会话带一个版本号，写入时带 `expectedVersion`，服务端比对不上就拒绝（409）。
- 两边都改了同一条：`updatedAt` 大者胜，败方**整条**另存到「冲突副本」分组，不丢东西、不静默覆盖。
- 冲突副本只进本地库，不回写主机——它是给人看的，不是同步对象。

这样「单点真源」落在版本号串行化上，不需要写合并算法。

## 三、主机侧跑什么：另起 chat-sync 服务

**不塞进 mneme。** mneme 的存储单位是「记忆行」（type / title / content），
`POST /memories` 收的是纯文本，`/share`、`/receive` 是记忆分享通道，不是文件通道。
把会话塞进去要么变成一条巨型文本、要么改它的 schema，两条都不该走。

新服务复用 mneme 的形态——守护进程、Bearer 鉴权、端口策略——但存储独立：

```
chat-sync/
  store.sqlite     会话索引：id、title、updatedAt、version、deleted 标记
  files/<sha256>   附件原件，内容寻址（同一张图存一次）
  sessions/<id>    会话 JSON，格式见第四节
```

端口取 **8791**（mneme standalone 默认 8790，避开）。同一台机器上两个服务并存。

### 最小接口面（六个）

```
GET    /health                 → { ok, version, contract }
GET    /sessions?since=<ms>    → [{ id, version, updatedAt, deleted }]   变化的会话，不含正文
GET    /sessions/<id>          → 信封（第四节），外层带 version
PUT    /sessions/<id>          → 整条覆盖，body 带 expectedVersion；不匹配回 409 + 当前 version
DELETE /sessions/<id>          → 软删，列表里以 deleted=true 出现，客户端据此删本地
GET    /files/<sha256>         → 附件原件
PUT    /files/<sha256>         → 上传附件原件，已存在直接 200（幂等）
```

`since` 是毫秒时间戳（服务端 `Date.now()`）。客户端记住上次成功拉取的最大 `updatedAt`，
下次带上。边界取「大于等于」并在客户端按 id 去重，同一毫秒内多条变化不会漏。
**列表不带正文**，是为了「开机拉一次」在几百条会话下也够快。

### 鉴权

一个 Bearer token，和 mneme 同一个形态：token 存主机侧配置文件，客户端存在设置里
（沿用 `chat-demo:memory-service-token` 那套 key 的形状，另起 `chat-demo:sync-token`）。
**`/health` 之外全部要鉴权**，包括 `GET /sessions`。

## 四、序列化：导出格式外面套一层信封

### 直接复用 `SessionFile` 不够

内层确实要复用 `src/services/chat/history/toArchive.ts` 的 `toSessionFile()`
和 `format.ts` 的 `SessionFile`（`EXPORT_FORMAT_VERSION = 3`）——**但那个格式装不下 `Session`**。

`SessionFile` 只有七个字段：`id`、`title`、`pinned`、`current_message_id`、`inserted_at`、
`updated_at`、`messages`（`format.ts:28-38`）。而 `Session` 还多四个：

| `Session` 字段 | 导出格式里 | 丢了会怎样 |
| --- | --- | --- |
| `projectId` | 没有 | 归属信息没了，同步回来全掉进「未归类」 |
| `memoryEnabled` | 没有 | **语义反转**：原本关掉记忆的会话，同步到另一台设备变成开启 |
| `compaction` | 没有 | 已压缩的上下文摘要丢了，那台设备会拿原文重发，token 白烧一遍 |
| `pinned` | 有字段，但写了死值 | 导出/导入两个方向都丢置顶 |

导入方向也一样：`toLocal.ts:274-283` 的 `toLocalSession()` 只拼 `id`/`title`/`createdAt`/
`updatedAt` 加 `buildTree()`，这四个字段一个都不带回来。

`memoryEnabled` 那条最要命，因为它是**静默降级**：`isMemoryEnabled` 判的是
`session?.memoryEnabled !== false`，字段一丢就回到「开」。用户明确关过的会话，
同步一圈回来开始往记忆库里写，而且没有任何提示。

`pinned: false` 是 `toArchive.ts:262` 里硬编码的，`toIndexEntry` 里 `:274` 也是。
这是**导出格式自身的 bug**（导出再导入就丢置顶），不是同步引入的，该单独修——但它说明
「导出格式是对的」这个假设本来就不成立，不能拿它当同步的唯一真相。

### 改法：信封，不动导出格式

```
{
  "sync_format_version": 1,
  "version": 17,                    // 同步用的版本号，每次写入 +1
  "projectId": "p_xxx" | null,
  "memoryEnabled": false,           // 显式写，不靠 undefined 语义
  "pinned": true,
  "compaction": { ... } | null,
  "files": { "<fileId>": "<sha256>" },   // 附件原件在服务端的地址
  "archive": { ... }                // 原样是 toSessionFile() 的输出
}
```

内层一个字不改，所以「导出能开 = 同步能开」这条理由完全保住，已有 ZIP 也不受任何影响。
外层补齐导出格式缺的三个字段（`projectId` / `memoryEnabled` / `compaction`），
外加修正写死值的 `pinned`。`memoryEnabled` **一律显式写布尔**，不靠「不写就是开」——
同步跨设备，那个默认值假设不成立。

`rootMessageId` 不用进信封：它由内层 `messages` 的 `parent_id` 树重建，
`buildTree()` 已经把它算回来了（`toLocal.ts:238`，返回在 `:271`）。

反序列化：内层走现成的 `toLocalSession()`，外层字段再贴回去。不新写一套转换。

**pinned 走信封还是修导出？** 两条都要：信封里放 `pinned` 让同步正确；同时单独提一个
issue 修 `toArchive.ts:262`/`:274` 的硬编码，那是导出自己的 bug。两件事各走各的 PR。

## 五、App 侧改哪：本地是唯一读源 + 写穿队列

**不给 `db.ts` 每个函数加远端分支。** 它有二十来个读写口，逐层判断「走本地还是远端」，
等于让每个调用点自己决定，必出 bug，而且是那种只在弱网下才出现的 bug。

改成：

1. **`db.ts` 语义不动。** 只在写入成功后加一个入队钩子。写入本来就收口了：
   `db.saveSession` 全仓只有一处调用，在 `src/services/chat/store.ts:258`；
   其余写口（`renameSession`、`setMemoryEnabled`、`setSessionProject`、`setSessionPinned`、
   `deleteSession`、`saveProject`、`deleteProject`）也都在 `src/services/chat/store.ts` 里。
   **入队时拿的是完整的 `Session`，不是 `SessionFile`**——信封那三个字段（`projectId` /
   `memoryEnabled` / `compaction`）加 `pinned` 在这一层还在，往下走到 `toSessionFile()` 就没了。
   钩子必须在 `persist()` 内部、`db.saveSession` 之前取快照，晚了就只剩一个丢过字段的对象。
2. **新模块 `syncQueue.ts`**：队列落在 IndexedDB（断网、被系统杀进程都不丢），
   后台按节流批量 PUT，成功后出队。失败留队，下次启动重试。
3. **新模块 `syncPull.ts`**：启动时、以及定时拉 `GET /sessions?since=`，
   只取变化的，按 `updatedAt` 比——本地更新就跳过，不覆盖。
4. **读永远走本地。** 首屏、搜索、导出、记忆整理全部不变，没有「等网络」这条路径，
   离线行为和今天完全一致。
5. 冲突按第二节：`updatedAt` 大者胜，败方整条进「冲突副本」分组。

读口现状（不改）：`src/services/chat/backup.ts`、`src/services/chat/memoryDigest.ts`、
`src/services/chat/store.ts`、`src/services/chat/history/exportArchive.ts`。

附件走内容寻址：先算 SHA-256，`PUT /files/<sha256>`。会话 JSON 里 `archive.messages[].fragments`
的 `export_path` 存的是 ZIP 内相对路径，同步侧不动它，另在信封外挂一份 `files` 映射
（`fileId → sha256`），这样导出格式一个字节不用改。

## 六、三种接入方式，各自成本

先说一条硬约束：**APK 里页面是 https（Capacitor 的 `androidScheme: "https"`），
而 targetSdk 36 默认禁止明文 http。** 所以设备上填 `http://192.168.0.x:8790` 会被系统直接拦掉，
在 JS 里只表现为一句 `TypeError: Failed to fetch`，和「服务没起」「地址写错」长得一模一样。
`src/services/chat/memoryEndpoint.ts` 已经能吃出这个差别（`isCleartextBlocked` → 报「明文被拦」），
但拦不住的还是拦不住。

三种方式按「要改多少东西」排：

### 1. 局域网直连

要动 Android 原生配置：加 `network_security_config.xml` 放行内网网段，或者在主机上挂
https + 自签证书并让设备信任。**每次换内网 IP 都得改配置、重打 APK。**
小改动，但 APK 重打是每次的事。只适合「主机 IP 固定、只在自己家网里用」。

### 2. Tailscale（推荐）

主机和手机进同一个虚拟网段，各自拿到一个固定的内网地址，跨网络也能连，**不动原生配置**。
免费额度够个人用。

要注意它的 https 要单独开：裸 Tailscale 只给 `100.x` 的 IP 和 MagicDNS 名字，
走的是 http；要满足上面那条硬约束，得用 `tailscale serve` 给这个地址签证书、挂上 https。
这条不开，就还是落在「明文被拦」里。开了之后就最省事，代价是多一个外部依赖、且它本身要一个账号。

### 3. Cloudflare Tunnel

这台机器上已经有 `cloudflared`（2026.5.0），`modusensus.space` 的 NS 也在 Cloudflare。
挂一个子域指到本机，自带 https、不用开端口、不动原生配置，跨网络可用。

代价是**服务暴露到公网**。鉴权必须做严：只放 chat-sync 的接口，别把 mneme 整个 API
一起挂上去；token 要长、要能单独轮换。

## 七、三个前置条件

动手之前这三件必须先成立，否则会出现「代码写完了但设备连不上」：

1. **页面是 https，明文 http 会被拦。** 所以地址必须是 https（Tailscale 的 MagicDNS
   或 Cloudflare Tunnel 都给 https），或者按第六节第 1 条改原生配置。
   这条不解决，后面两条白做。
2. **mneme 的 CORS 白名单默认是空的。** `externalApiAllowedOrigins` 不填时**一个 CORS 头都不发**，
   网页版与 App 直连只会拿到一条读不出原因的 CORS 报错（OPTIONS 预检不带 Authorization，
   夹在鉴权后会恒 401）。所以填地址之前必须先把这个白名单配上。
   chat-sync 从一开始就要发正确的 CORS 头，别重复踩。
3. **主机侧要有常驻守护进程和固定地址。** 电脑睡眠、重启、IP 变了，同步就断。
   需要一个开机自启的服务 + 一个不会变的地址（Tailscale IP 或隧道域名）。
   这一步是运维问题，不是代码问题，但不做就等于没有同步。

## 八、已知风险

### 多端并发写记忆会放大 #605

`dsh-mneme` 的 issue #605 记着一件事：同一批 sleep 工作被两个写者跑了两遍，
快照哈希相同、后到的一条没落却照样报 `frozen`。根因方向是 `enqueue` 是**进程内**串行队列，
而库上只有 `busy_timeout` + WAL，**没有跨进程单实例锁**——进程内队列防不住两个进程同时写。

现在这套是单机单写者，所以不疼。**一旦变成多端并发写同一个 mneme 守护进程，它会从计数问题
变成真的数据问题**（重复落库、`double-demote` / `double-mint patterns` 正是那条注释担心的）。

所以记忆层的口径是：**一端写，其余只读。** 不要两台设备同时往同一个 mneme 里写。
跨进程锁的方案跟考后那批一起修，不塞进同步这条线。

### 其他

- **导出格式自己有字段缺口**（第四节）：`pinned` 在 `toArchive.ts:262`/`:274` 写死 `false`，
  导出再导入就丢置顶。这是导出链路的独立 bug，该单独修，不该由同步方案背。信封只是绕开它。
- **附件体积**：内容寻址能省重复，但第一次同步仍要传完整原件。大批量导入的会话
  （几百条、带图）首次同步会很慢，需要进度显示——这类长任务必须有可见反馈，不能只有个灰按钮。
- **删除是软删**：`DELETE` 只在列表里标 `deleted=true`，客户端据此删本地。
  这样另一台设备下次拉取时才知道「这条是删了，不是没拉到」。真清理另起一个显式动作。
- **消息 id 是会话内自增的**（`ChatMessage.id`）：同步以整条会话为单位，所以不冲突；
  但如果哪天想改成增量同步，这个自增 id 会立刻变成麻烦，届时要先换 id 方案。

## 九、开工顺序（12-20 之后）

1. chat-sync 服务：存储 + 六个接口 + Bearer 鉴权 + CORS 头。先能跑，先本机 `curl` 通。
2. 序列化对接：把信封（第四节）原样存进去，`GET` 出来能读回 `Session`。
   **验收基准必须是一条「关过记忆 + 归过项目 + 置顶过 + 压缩过」的会话**——
   用干净会话测，上面四个字段丢了也看不出来。
   做法：导出 ZIP → 上传 → 另一份空库拉下来 → 逐字段比对，
   四条都要断言 `memoryEnabled === false`、`projectId` 相同、`pinned === true`、
   `compaction.upTo` 相同。反过来也要测一遍：本地 `false` 的会话经同步回来仍是 `false`。
3. App 侧 `syncQueue.ts`：先只做「写完入队、串行 PUT」，不做拉取。
4. App 侧 `syncPull.ts`：启动拉一次，定时拉，冲突进副本分组。
5. 接入方式：先在局域网跑通，再决定 Tailscale 还是 Tunnel。
6. 进度显示：首次全量同步的进度条与取消。

每步各自能验证，不要一口气合。
