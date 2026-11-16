/**
 * 把导出文件写到用户自己挑的位置（Android 的 SAF）。
 *
 * 为什么要这一层：WebView 里导出一直走的是 URL.createObjectURL(blob) + a.click()，
 * 而 Capacitor 的 Bridge.launchIntent 对 blob:/data: 直接 return false，整个
 * @capacitor/android 也没有 DownloadListener —— 安卓上那次点击被静默吞掉，
 * 一个文件都产不出来。桌面浏览器正常，所以这个坑很久没暴露。
 *
 * 这里只在原生环境启用（window.Capacitor.Plugins.SaveFile 存在），网页里保持原来的
 * link.click()，两边行为不变。
 *
 * 原生侧实现在 android/app/src/main/java/com/slowstack/deepseekchat/SaveFilePlugin.java。
 * 数据按块送过去（每块 1 MB 以内），别把几兆 base64 塞进一次桥调用。
 */

/** 插件在 window.Capacitor.Plugins 下的名字，必须与 @CapacitorPlugin(name = ...) 一致 */
const PLUGIN_NAME = 'SaveFile'

/** 与 SaveFilePlugin.MAX_CHUNK 保持一致 */
const CHUNK_SIZE = 1024 * 1024

type SaveFilePlugin = {
  pick: (options: { fileName: string; mimeType: string }) => Promise<{ uri?: string; cancelled?: boolean }>
  write: (options: { uri: string; data: string; append?: boolean }) => Promise<{ written?: number }>
  remove: (options: { uri: string }) => Promise<{ deleted?: boolean }>
}

const plugin = (): SaveFilePlugin | null => {
  const capacitor = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
  const found = capacitor?.Plugins?.[PLUGIN_NAME]
  return found ? (found as SaveFilePlugin) : null
}

/** 装成 App 才能走系统保存框；网页里没有这个插件，调用方退回浏览器下载 */
export const canSaveToDevice = (): boolean => plugin() !== null

/** 用户在保存框里按了取消，不算失败 */
export class SaveCancelled extends Error {
  constructor() {
    super('save cancelled')
    this.name = 'SaveCancelled'
  }
}

const readChunk = (blob: Blob, start: number, end: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取导出数据失败'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('读取导出数据失败'))
        return
      }
      // data:...;base64,xxxx —— 原生侧只认逗号后的部分
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob.slice(start, end))
  })

/**
 * 弹出系统保存框，把 blob 分块写进去。返回用户选的 uri（用于失败时清理）。
 * 用户取消抛 SaveCancelled；写了一半失败会把已经建出来的文件删掉，不留在文档目录里。
 */
export const saveBlobToDevice = async (
  blob: Blob,
  fileName: string,
  mimeType = 'application/zip',
  onProgress?: (written: number, total: number) => void
): Promise<string> => {
  const found = plugin()
  if (!found) {
    throw new Error('save plugin unavailable')
  }
  const picked = await found.pick({ fileName, mimeType })
  if (picked.cancelled || !picked.uri) {
    throw new SaveCancelled()
  }
  const uri = picked.uri
  try {
    let offset = 0
    while (offset < blob.size) {
      const end = Math.min(offset + CHUNK_SIZE, blob.size)
      const data = await readChunk(blob, offset, end)
      await found.write({ uri, data, append: offset > 0 })
      offset = end
      onProgress?.(offset, blob.size)
    }
    // 空文件也要建出来：一次 append=false 的空写。
    if (blob.size === 0) {
      await found.write({ uri, data: '', append: false })
    }
    return uri
  } catch (error) {
    await found.remove({ uri }).catch(() => {})
    throw error
  }
}
