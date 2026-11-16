import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import {
  beginHistoryExport,
  endHistoryExport,
  replaceHistory,
  useChatStore,
} from './store.js'
import type { Session, SessionSummary } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/**
 * 逐会话读出的异步生成器：列表用打开导出时的快照，未打开的会话逐条补读，不填满详情缓存。
 * 每读一条前先看取消信号，长导出里按下取消能立刻停。
 */
async function* readSessions(
  sessions: SessionSummary[],
  sessionCache: Record<string, Session>,
  signal: AbortSignal
): AsyncGenerator<Session> {
  for (const summary of sessions) {
    // 长导出里用户随时可能按取消：这里先停，不必等读完这一条会话。
    signal.throwIfAborted()
    const session = Object.hasOwn(sessionCache, summary.id)
      ? sessionCache[summary.id]
      : await db.loadSession(summary.id)
    if (!session) {
      throw new Error(`History session disappeared during export: ${summary.id}`)
    }
    // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
    yield { ...session, ...summary }
  }
}

/**
 * 导出为历史会话导出格式的 ZIP，可再次导入。
 * 逐会话读出 → 打包写 ZIP → 写到设备（App 里走系统保存框）三段都报进度，
 * 并把取消信号传给逐条循环：取消后不返回半成品。
 *
 * 网页里没法自己落盘，返回 blob 交给调用方 link.click()；
 * App 里 WebView 的 blob: 下载会被 Capacitor 静默吞掉（Bridge.launchIntent 对
 * blob:/data: 直接 return false，且没有 DownloadListener），所以必须走原生保存，
 * 此时 saved 为 true，blob 也已经写进用户挑的位置。
 */
export const exportHistory = (): Promise<{ name: string; blob: Blob; saved: boolean }> =>
  enqueueBackup(async () => {
    const reporter = beginHistoryExport()
    if (!reporter) {
      throw new Error('History export is already in progress')
    }
    const { signal } = reporter
    try {
      const { sessions, sessionCache } = useChatStore.getState()
      const total = sessions.length
      reporter.reading(0, total)
      const { exportArchive } = await import('./history/exportArchive.js')
      const now = new Date()
      const blob = await exportArchive(
        readSessions(sessions, sessionCache, signal),
        (done, count) => reporter.reading(done, count),
        total,
        signal,
        () => reporter.packing(total, total)
      )
      const name = backupFileName(now)
      const { canSaveToDevice, saveBlobToDevice } = await import('../saveFile.js')
      if (!canSaveToDevice()) {
        return { name, blob, saved: false }
      }
      // 打包完就该写了，这一步不能取消：写一半停下会在文档目录里留个坏 ZIP。
      reporter.saving()
      await saveBlobToDevice(blob, name)
      return { name, blob, saved: true }
    } finally {
      // 成功、失败、取消都走这里，进度面板不会留在界面上。
      endHistoryExport()
    }
  })

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export const importHistory = (file: File): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    // 取消信号由 replaceHistory 统一持有，这里透传下去，逐条目循环会自己停下。
    return replaceHistory((onProgress, signal) => importArchive(file, onProgress, signal))
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })
