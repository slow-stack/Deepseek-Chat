import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError, streamMessage } from '../api/client.js'
import { modelFor, searchEndpointConfigured } from '../api/endpoints.js'
import { describeSearchFailure, formatSearchResults, searchWeb } from '../api/search.js'
import type {
  ChatModel,
  CreateMessageRequest,
  MessageParam,
  ServerToolUseBlock,
  WebSearchToolResultBlock,
} from '../api/types.js'
import {
  extractFileIds,
  getFileErrorCode,
  getRejectedBlockIndex,
  isRejectedFileError,
  isRetryableApiError,
} from '../api/errors.js'
import {
  cancelUpload,
  checkImageFileIds,
  describeUploadError,
  uploadAttachment,
  useUploads,
} from '../attachments.js'
import { useSettings } from '../settings.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  buildCompaction,
  getEffectiveContextTokens,
  planCompaction,
  selectCompactionRounds,
} from './compaction.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  getReplyText,
  settleReply,
  toRequestMessages,
} from './reply.js'
import { saveTurnToMemory } from './memory.js'
import { takeNewSessionMemoryEnabled } from './newSessionMemory.js'
import { getRejectedFileId, resolveFileBlockKind, selectRejectedFiles } from './fileBlockKind.js'
import { buildMemoryContext, withMemoryContext } from './memoryPrompt.js'
import { buildRegenerateNote, regenerateTemperature, withRegenerateNote } from './regenerate.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type FileAttachment,
  type Message,
  type ReplyBlock,
  type Session,
  type SessionCompaction,
  type SessionProject,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
const MODEL: ChatModel = 'deepseek-flash'
/** 设置里给对话单独配了模型就用那个，否则用内置默认 */
const chatModel = (): ChatModel => modelFor('chat', MODEL) as ChatModel
/** 所有生成请求统一携带的助手身份说明 */
const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 8
/** 安全审核固定开启，所有请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000
/** 等回复收尾的上限：流卡死时不能陪着一起卡住（导入要替换历史，卡住等于永远进不去） */
const IDLE_TIMEOUT = 15_000

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

/**
 * 历史导入、导出的进度；total 为 null 表示总数未知。
 * 导入的 committing 阶段写进本地库，导出的 packing 阶段压 ZIP、saving 阶段写进用户选的位置；
 * 三者都不可省略。
 */
export type HistoryProgress = {
  kind: 'import' | 'export'
  phase: 'reading' | 'committing' | 'packing' | 'saving'
  done: number
  total: number | null
}

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 导入进度；null 表示没有在导入。放在 store 里，切页面、关设置都不丢。 */
  historyProgress: HistoryProgress | null
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  /** 项目，按创建时间升序；成员会话的 projectId 指向这里的 id。 */
  projects: SessionProject[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  historyProgress: null,
  sessions: [],
  projects: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title &&
  a.createdAt === b.createdAt &&
  a.updatedAt === b.updatedAt &&
  (a.projectId ?? null) === (b.projectId ?? null) &&
  // 置顶只影响列表展示，不比它会让点「置顶」看起来毫无反应
  (a.pinned ?? false) === (b.pinned ?? false)

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Map<string, Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
/** 当前正在跑的导入；取消按钮通过它中断逐条目循环。 */
let historyImportController: AbortController | null = null
/** 当前正在跑的导出；取消按钮通过它中断逐会话循环。 */
let historyExportController: AbortController | null = null
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: MODEL,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const [summaries, projects] = await Promise.all([
        db.loadSessionSummaries(),
        db.loadProjects(),
      ])
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries), projects })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/**
 * 等所有回复的收尾（落盘）完成。
 * 只看 streaming 是否清空并不保险：某个流的收尾若卡在自己的 await 上，这里会永远等下去，
 * 界面既不报错也没有进度。所以给一个超时兜底，并接受取消信号——导入里那一步等的是被 abort 的流，
 * 晚到的落盘已经被 historyEpoch 挡掉，先往下走不会写回旧数据。
 */
const waitForIdle = (sessionId?: string, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    // 信号可能在进来之前就已经取消了，addEventListener 不会补发一次。
    if (signal?.aborted) {
      resolve()
      return
    }
    let unsubscribe = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => {
      unsubscribe()
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        finish()
      }
    })
    timer = setTimeout(finish, IDLE_TIMEOUT)
    signal?.addEventListener('abort', finish, { once: true })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 * write 收到进度回调与取消信号，写进 store 的 historyProgress，界面切到别处也能看到。
 */
export const replaceHistory = async (
  write: (onProgress: (done: number, total: number) => void, signal: AbortSignal) => Promise<void>
): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  const controller = new AbortController()
  historyImportController = controller
  set({
    importingHistory: true,
    historyProgress: { kind: 'import', phase: 'reading', done: 0, total: null },
  })
  try {
    for (const running of Object.values(get().streaming)) {
      running.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks.values())
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    // 等待期间用户可能按了取消：这里先退出，暂存交给 catch 里统一清掉。
    await waitForIdle(undefined, controller.signal)
    controller.signal.throwIfAborted()
    await db.clearStaging()
    let summaries: SessionSummary[]
    let done = 0
    let total: number | null = null
    try {
      await write(
        (next, count) => {
          done = next
          total = count
          set({ historyProgress: { kind: 'import', phase: 'reading', done: next, total: count } })
        },
        controller.signal
      )
      // 读出条目后还要整批搬进正式表，这一步在大库里也不短。
      set({ historyProgress: { kind: 'import', phase: 'committing', done, total } })
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      projects: [],
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    historyImportController = null
    set({ importingHistory: false, historyProgress: null })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

/** 中途取消导入：信号传到逐条目循环，暂存在 finally 里清掉，原有记录不受影响。 */
export const cancelHistoryImport = () => {
  historyImportController?.abort()
}

/** 导出进度与取消信号：由 exportHistory 在备份队列里持有，界面只读 store。 */
export type HistoryExportReporter = {
  signal: AbortSignal
  /** 逐会话读出的进度；总数固定是打开导出时的会话数。 */
  reading: (done: number, total: number) => void
  /** 进入压缩打包阶段；这一步也可能几十秒，且允许取消。 */
  packing: (done: number, total: number) => void
  /** 打包完成、开始往设备里写；写盘不能中途停，否则会留下半个文件。 */
  saving: () => void
}

/** 开始一次导出；已有导出在跑时返回 null，避免两条进度互相覆盖。 */
export const beginHistoryExport = (): HistoryExportReporter | null => {
  if (historyExportController) {
    return null
  }
  const controller = new AbortController()
  historyExportController = controller
  const total = get().sessions.length
  set({ historyProgress: { kind: 'export', phase: 'reading', done: 0, total } })
  return {
    signal: controller.signal,
    reading: (done, count) =>
      set({ historyProgress: { kind: 'export', phase: 'reading', done, total: count } }),
    packing: (done, count) =>
      set({ historyProgress: { kind: 'export', phase: 'packing', done, total: count } }),
    saving: () =>
      set({ historyProgress: { kind: 'export', phase: 'saving', done: 0, total: null } }),
  }
}

/** 导出结束（成功、失败、取消都走这里），清掉进度面板。 */
export const endHistoryExport = () => {
  historyExportController = null
  // 备份队列是串行的，导入不会插进来；这里仍按 kind 认一次，别误清别人的进度。
  if (get().historyProgress?.kind === 'export') {
    set({ historyProgress: null })
  }
}

export const cancelHistoryExport = () => {
  historyExportController?.abort()
}

/** 取消导入、导出抛的都是 AbortError；调用方据此区分「用户自己取消」与「真的失败」。 */
// DOMException 在多数浏览器里不是 Error 的子类，只能按 name 认。
export const isHistoryAbort = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

/** 导入侧的旧名字，保留给设置页现有的取消提示判断。 */
export const isHistoryImportAborted = isHistoryAbort

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

/**
 * 预先读进缓存，不改变当前会话。
 * 侧栏在悬停/按下时先热一遍，点击时就不用等 IndexedDB，冷切换的 loading 也少一次。
 * 失败不处理：真点进去时 selectSession 会再走一遍并正常报错。
 */
export const prefetchSession = (id: string) => {
  if (get().importingHistory || getSession(id)) {
    return
  }
  void ensureSessionLoaded(id).catch(() => {})
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 会话级记忆开关。关掉后这条会话不写记忆库、也不从记忆库取上下文；
 * 判定统一走 services/chat/memory.ts（isMemoryEnabled / canWriteMemory）。
 */
export const setMemoryEnabled = (id: string, memoryEnabled: boolean) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, memoryEnabled }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, memoryEnabled } : session
      ),
    }))
    void db.setMemoryEnabled(id, memoryEnabled).catch(db.reportStorageError('set memory enabled'))
  }
}

/**
 * 新建项目。名字只做首尾去空白，重名允许——项目按 id 区分，不按名字；
 * 空名字直接不建，返回 null 让界面保持原样。
 */
export const createProject = (name: string): SessionProject | null => {
  const trimmed = name.trim()
  if (!trimmed || get().importingHistory) {
    return null
  }
  const project: SessionProject = { id: createId(), name: trimmed, createdAt: Date.now() }
  set((state) => ({ projects: [...state.projects, project] }))
  void db.saveProject(project).catch(db.reportStorageError('create project'))
  return project
}

export const renameProject = (id: string, name: string) => {
  const trimmed = name.trim()
  const project = get().projects.find((item) => item.id === id)
  if (!trimmed || !project) {
    return
  }
  const next: SessionProject = { ...project, name: trimmed }
  set((state) => ({
    projects: state.projects.map((item) => (item.id === id ? next : item)),
  }))
  void db.saveProject(next).catch(db.reportStorageError('rename project'))
}

/** 删项目只解散归类：成员会话回到未分组的列表，会话本身一条不删。 */
export const removeProject = (id: string) => {
  if (get().importingHistory) {
    return
  }
  set((state) => ({
    projects: state.projects.filter((item) => item.id !== id),
    sessions: state.sessions.map((session) =>
      session.projectId === id ? { ...session, projectId: null } : session
    ),
  }))
  // 打开中的会话也要同步摘掉，否则下次保存会把旧 projectId 写回去。
  for (const session of Object.values(get().sessionCache)) {
    if (session.projectId === id) {
      updateSession(session.id, (item) => ({ ...item, projectId: null }))
      persist(session.id)
    }
  }
  void db.deleteProject(id).catch(db.reportStorageError('remove project'))
}

/** 把会话放进项目（projectId 为 null 表示移回未分组的列表）。 */
export const moveSessionToProject = (id: string, projectId: string | null) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const known =
    projectId === null || get().projects.some((project) => project.id === projectId)
  if (!known) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, projectId }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, projectId } : session
      ),
    }))
    void db.setSessionProject(id, projectId).catch(db.reportStorageError('move session to project'))
  }
}

/** 置顶 / 取消置顶：置顶的会话在所属列表里排最前面，不改变更新时间。 */
export const setSessionPinned = (id: string, pinned: boolean) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, pinned: pinned || undefined }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, pinned: pinned || undefined } : session
      ),
    }))
    void db.setSessionPinned(id, pinned).catch(db.reportStorageError('pin session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  // 同一条会话连点两次删除时复用同一个任务：第二次等待与第一次相同的结果，
  // 而不是立刻 false 让弹框显示「删除失败」——用户看到的只是没反应。
  const pending = deletionTasks.get(id)
  if (pending) {
    return pending
  }
  const task = removeSessionData(id).finally(() => deletionTasks.delete(id))
  deletionTasks.set(id, task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    // 新对话的记忆意愿在输入框里就定下了（那时还没有会话可写），这里随手写进会话，
    // 第一条消息就已经处在正确的闸门后面；读走即复位，不粘到下一个新对话。
    const memoryEnabled = takeNewSessionMemoryEnabled()
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
      ...(memoryEnabled ? {} : { memoryEnabled: false }),
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      // 草稿附件已上传成功，每张图片都在上传前检查过长边，超限的已缩小。
      imageSizeChecked: isImage,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, { history, question })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  // 同一问题下已经答过的版本。客户端从不发采样参数，同一天的时间快照也完全一样，
  // 只把上下文重发一遍等于重复同一次请求，模型多半原样复述。
  // 旧会话可能还没规范化过 parentId，先按线性顺序补齐，否则这里一个也筛不出来；
  // 补齐后仍对不上（导入的分支链断过）就退回当前路径上的那一版。
  const normalized = normalizeSession(session)
  const siblings = normalized.messages
    .filter(
      (message): message is AssistantMessage =>
        message.role === 'assistant' && message.parentId === question.id
    )
    .sort((a, b) => a.createdAt - b.createdAt)
  const current = path[index]
  const previous =
    siblings.length > 0
      ? siblings
      : current?.role === 'assistant'
        ? [current as AssistantMessage]
        : []
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question, previous })
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? MODEL,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = {
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
  /** 重新生成时已经给过的同题回答，用来让这次的 system 与上次不同 */
  previous?: AssistantMessage[]
}

/**
 * 将 serverId 写回所有引用同一附件的消息。传入 null 会清除超限旧图的 ID，触发补传。
 * 尺寸标记随有效 ID 保存，因为本地保留的是原图，刷新后可以直接复用已检查的上传副本。
 */
const saveServerIds = (sessionId: string, serverIds: ReadonlyMap<string, string | null>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) => {
              const serverId = serverIds.get(file.id)
              return serverId === undefined
                ? file
                : { ...file, serverId, imageSizeChecked: file.isImage && serverId !== null }
            }),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
    previous: request.previous,
  }
}

/**
 * 本次请求范围内已被摘出上下文的附件数，用于在回复底部说明「这轮少带了几个附件」。
 * 只看这次真正发出去的轮次：request 是发送前的快照，excluded 标记要从会话最新状态读。
 */
const countExcludedFiles = (sessionId: string, request: Request): number => {
  const session = getSession(sessionId)
  if (!session) {
    return 0
  }
  const ids = new Set<string>([request.question.id])
  for (const [user] of getContextRounds(request.history)) {
    ids.add(user.id)
  }
  let count = 0
  for (const message of session.messages) {
    if (message.role === 'user' && ids.has(message.id)) {
      count += message.files.filter((file) => file.excluded).length
    }
  }
  return count
}

/**
 * 发送前按字节确认图片附件的真实类型，改掉「归档说是图片就当图片发」的老做法：
 * - 嗅探出服务端认的图片格式 → 把 MIME 写回附件，下次发送不必再读原件；
 * - 嗅探出来不是（损坏、加密、服务端不认的格式）→ 标成 excluded，只展示不发送，
 *   否则服务端会拿它报「不受支持的图片」，把整轮对话连坐。
 * 只处理图片附件，文档附件没有这个问题，也不额外读盘。
 */
const verifyFileKinds = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const candidates = new Map<string, FileAttachment>()
  const collect = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.isImage && !file.excluded && !candidates.has(file.id)) {
        candidates.set(file.id, file)
      }
    }
  }
  collect(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    collect(user.files)
  }
  if (candidates.size === 0) {
    return
  }
  const patches = new Map<string, Partial<FileAttachment>>()
  for (const file of candidates.values()) {
    signal.throwIfAborted()
    const verdict = await resolveFileBlockKind(file, db.loadFile)
    if (verdict.kind === 'drop' && verdict.reason === 'broken') {
      patches.set(file.id, { excluded: true })
    } else if (verdict.kind === 'image' && verdict.source === 'bytes' && verdict.sniffed) {
      patches.set(file.id, { mimeType: verdict.sniffed })
    }
  }
  if (patches.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.role !== 'user' || !message.files.some((file) => patches.has(file.id))) {
        return message
      }
      return {
        ...message,
        files: message.files.map((file) => {
          const patch = patches.get(file.id)
          return patch ? { ...file, ...patch } : file
        }),
      }
    }),
  }))
  persist(sessionId)
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  // 先按字节确认哪些图片真能发：坏图在补传之前就摘掉，别白传一遍再被服务端拒
  await verifyFileKinds(sessionId, request, signal)
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  // 旧图片超限时先清除 ID，交给下方已有的附件补传流程。
  const files = [
    ...request.question.files,
    ...getContextRounds(request.history).flatMap(([user]) => user.files),
  ]
  const checked = await Promise.race([checkImageFileIds(files, signal), aborted])
  if (checked.size > 0) {
    saveServerIds(sessionId, checked)
    request = refreshRequest(sessionId, request)
  }
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId && serverId !== file.serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  // toReversed 是 ES2023 的（Chrome 110 / Safari 16.4 才有），而 rspack 的编译目标写的是
  // chrome >= 105 / safari >= 16 —— 在这条缝里的内核会直接 TypeError，发送带附件的消息就报错。
  // 换成展开再 reverse，语义一样，谁都能跑。
  for (const [user] of [...getContextRounds(request.history)].reverse()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
    previous: request.previous,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/**
 * 服务端拒收请求里的附件内容（图片损坏、格式不受支持）时，把被点名的附件标成 excluded 并重发。
 * 与 file_id 失效不同，重传同一个原件没有用，只能把它从上下文里摘掉；重发前先把请求快照换成
 * 最新会话，否则快照里还带着那块坏图。
 * 报错点名了具体内容块就只摘那一张（sent 是这次真正发出去的 messages），
 * 点名不到才退回按 MIME 猜。返回 true 表示已摘掉、可以重试。
 */
const excludeRejectedFiles = (
  sessionId: string,
  error: unknown,
  sent?: readonly MessageParam[]
): boolean => {
  if (!isRejectedFileError(error)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session) {
    return false
  }
  const rejectedFileId =
    error instanceof ApiError && sent
      ? getRejectedFileId(sent, getRejectedBlockIndex(error.message))
      : null
  let changed = false
  const messages = session.messages.map((message) => {
    if (message.role !== 'user' || message.files.length === 0) {
      return message
    }
    const targets = new Set(selectRejectedFiles(message.files, rejectedFileId))
    if (targets.size === 0) {
      return message
    }
    changed = true
    return {
      ...message,
      files: message.files.map((file) =>
        targets.has(file.id) ? { ...file, excluded: true } : file
      ),
    }
  })
  if (!changed) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求前按需压缩上下文：占用达到阈值时把最老几轮换成摘要，摘要随会话落盘。
 * 返回本次会话可用的压缩记录；未触发或没有可压的轮次时返回原有记录。
 * 压缩失败不影响本次请求，只退回未压缩的上下文。
 */
const compactSession = async (
  sessionId: string,
  history: Message[],
  signal: AbortSignal
): Promise<SessionCompaction | undefined> => {
  const session = getSession(sessionId)
  const previous = session?.compaction
  const settings = useSettings.getState()
  const plan = planCompaction(history, settings, previous)
  if (!plan) {
    return previous
  }
  try {
    const compaction = await buildCompaction(
      plan,
      settings.compactMode,
      settings.apiKey ?? '',
      signal,
      previous
    )
    if (signal.aborted) {
      return previous
    }
    updateSession(sessionId, (current) => ({ ...current, compaction }))
    persist(sessionId)
    return compaction
  } catch {
    return previous
  }
}

/** 手动压缩一次：供设置面板的「立即压缩」使用，无更早轮次时返回 false */
export const compactNow = async (sessionId: string): Promise<boolean> => {
  const session = getSession(sessionId)
  if (!session) {
    return false
  }
  const history = getVisibleMessages(session)
  const settings = useSettings.getState()
  const plan = selectCompactionRounds(history, settings.compactKeepRounds, session.compaction?.upTo)
  if (!plan) {
    return false
  }
  const controller = new AbortController()
  const compaction = await buildCompaction(
    plan,
    settings.compactMode,
    settings.apiKey ?? '',
    controller.signal,
    session.compaction
  )
  updateSession(sessionId, (current) => ({ ...current, compaction }))
  persist(sessionId)
  return true
}

/** 当前会话可见消息的上下文占用（token），顶栏指示器用；压缩后按摘要重新估算 */
export const getSessionContextTokens = (session: Session): number =>
  getEffectiveContextTokens(getVisibleMessages(session), session.compaction)

/** 客户端直连搜索的结果并进本轮提问前，先说明这段文字是从哪来的 */
const SEARCH_CONTEXT_HEADER = '【以下是我自己联网搜索到的结果，供你参考】'
/** 搜过但一条没命中时也要说一声，否则模型会当成没联网 */
const EMPTY_SEARCH_NOTICE = '（联网搜索已执行，没有找到可用结果）'

/**
 * 客户端直连搜索：先拿到结果，再合成一对工具块塞进回复供界面展示。
 *
 * 只有设置里给「联网搜索」配了地址或密钥才走这里；否则仍由服务端在对话里执行。
 * 搜索失败不打断本轮对话：不留下半截工具块（界面会显示成失败），只把原因交给模型说。
 */
const runClientSearch = async (
  question: string,
  apiKey: string,
  signal: AbortSignal
): Promise<{ blocks: ReplyBlock[]; context: string }> => {
  const toolUseId = `srvtoolu_s_${createId()}`
  try {
    const results = await searchWeb({ apiKey, query: question, signal })
    // 没结果也告诉模型搜过了：否则它会以为没联网，把答案说成「我没有实时信息」。
    if (results.length === 0) {
      return { blocks: [], context: EMPTY_SEARCH_NOTICE }
    }
    const toolUse: ServerToolUseBlock = {
      type: 'server_tool_use',
      id: toolUseId,
      name: 'deepseek_web_search',
      input: { action: 'search', queries: [question] },
      caller: { type: 'direct' },
      kind: 'search',
    }
    const result: WebSearchToolResultBlock = {
      type: 'web_search_tool_result',
      tool_use_id: toolUseId,
      content: results,
      kind: 'search',
    }
    return { blocks: [toolUse, result], context: formatSearchResults(results) }
  } catch (error) {
    return { blocks: [], context: `（联网搜索没有成功：${describeSearchFailure(error)}）` }
  }
}

/** 把搜索结果接到最后一条用户消息上，保持一问一答的轮次结构 */
const appendSearchContext = (messages: MessageParam[], context: string) => {
  // findLastIndex 是 ES2023 的，同 toReversed 一样落在编译目标的缝里，手写倒序找。
  let index = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      index = i
      break
    }
  }
  const message = messages[index]
  if (!message || message.role !== 'user' || !context) {
    return
  }
  const text = `${SEARCH_CONTEXT_HEADER}\n${context}`
  message.content =
    typeof message.content === 'string'
      ? `${message.content}\n\n${text}`
      : [...message.content, { type: 'text' as const, text }]
}

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  try {
    /** 客户端直连搜索只做一次：重发时沿用已有结果，避免重复计费与重复的工具块 */
    let searchContext = ''
    let searched = false
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      /** 这一轮真正发出去的请求体，服务端点名拒收时用来反查是哪张图 */
      let sent: MessageParam[] | undefined
      try {
        const prepared = await prepareFiles(sessionId, request, controller.signal)
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        // 上下文占用超阈值时，先把最老几轮换成摘要；摘要随会话保存，下次请求直接复用。
        const compaction = await compactSession(sessionId, prepared.history, controller.signal)
        const messages = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder,
          compaction
        )
        sent = messages
        // 重新生成时抬高温度：只改 system 文案的话，默认温度下模型仍会写出高度相似的段落
        const temperature = regenerateTemperature(request.previous?.length ?? 0)
        // 联网搜索：配了自己的接口就由客户端先搜，结果作为一对工具块回填给界面，
        // 同时把正文拼进本轮提问；没配才声明服务端工具，交给服务端在对话里执行。
        // 两条路互斥，否则同一轮会搜两遍、钱花两遍。
        const ownSearch = (initial.search ?? false) && searchEndpointConfigured()
        // 续写（有前缀）不重搜：上一轮的结果还在上下文里，重搜会叠出重复的工具块。
        const clientSearch = ownSearch && !prepared.prefix
        if (clientSearch && !searched) {
          searched = true
          const found = await runClientSearch(
            prepared.question.content,
            useSettings.getState().apiKey ?? '',
            controller.signal
          )
          if (found.blocks.length > 0) {
            reply = { ...reply, blocks: [...reply.blocks, ...found.blocks] }
            updateReply(sessionId, reply)
          }
          searchContext = found.context
        }
        if (clientSearch) {
          appendSearchContext(messages, searchContext)
        }
        // 记忆注入：按这轮提问去记忆库捞几条相关的，接到 system 后面。
        // 放在 messages 外面而不是拼进用户那条消息：拼进去模型会以为用户自己说的。
        // 整段自己吞错，记忆读不到就当没有，不影响这次提问。
        // 重新生成时把第几次重来传进去：检索本身是确定的，不轮换就每次拿到同样几条，
        // 模型只能在措辞上做文章（用户看到的就是「形容词换了一轮」）。
        const memoryContext = await buildMemoryContext(
          getSession(sessionId),
          prepared.question.content,
          { attempt: request.previous?.length ?? 0 }
        ).catch(() => '')
        // 注入成功与否在界面上毫无痕迹，用户没法分辨「没带」和「带了但模型没说」。
        // 回复开头给一小段标记：条数在里头，模型看不见（发送前截掉）。
        if (memoryContext) {
          const count = (memoryContext.match(/^\d+\./gm) ?? []).length
          reply = { ...reply, memoryNote: count }
          updateReply(sessionId, reply)
        }
        const events = streamMessage(
          useSettings.getState().apiKey ?? '',
          {
            model: initial.model ?? chatModel(),
            system: withRegenerateNote(
              withMemoryContext(SYSTEM_PROMPT, memoryContext),
              buildRegenerateNote(request.previous ?? [])
            ),
            messages,
            thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
            safety_check: SAFETY_CHECK,
            tools: serverTools((initial.search ?? false) && !ownSearch),
            ...(temperature === undefined ? {} : { temperature }),
            ...(titleRequests.has(controller) ? { title: { enabled: true } } : {}),
          },
          controller.signal
        )
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        reply = settleReply(reply, 'done', Date.now())
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        // 附件内容被拒：重传同一个原件没有用，摘掉这张图再发一次，并在回复上留一句说明。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          excludeRejectedFiles(sessionId, error, sent)
        ) {
          reply = { ...reply, excludedFiles: countExcludedFiles(sessionId, request) }
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (error instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    // 记忆是旁路：只在本轮正常答完时入库，关掉开关的会话整段跳过，写失败也不改回复状态。
    const session = getSession(sessionId)
    if (session && reply.status === 'done') {
      void saveTurnToMemory(session, request.question, reply, getReplyText(reply))
    }
  }
}
