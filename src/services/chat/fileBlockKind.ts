/**
 * 附件能不能作为 image 块发给服务端，发送前在这里一次判定。
 *
 * 只在按字节识别出服务端认识的图片格式时才走 image 块；识别出来不是图片的一律从请求里
 * 摘掉，绝不因为归档标了 is_image 就当成图片硬发 —— 那样服务端会在 messages 接口报
 * 「上传了一张不受支持的图片」，把整轮对话连坐。
 */
import { isServableImage, sniffBlobMimeType } from '../fileType.js'
import type { FileBlockParam, MessageParam } from '../api/types.js'
import type { FileAttachment } from './types.js'

export type FileBlockVerdict =
  /** 按图片块发；bytes 表示类型是从原件嗅探出来的，mime 表示附件自带的可信 MIME */
  | { kind: 'image'; source: 'mime' | 'bytes'; sniffed?: string }
  /** 不是图片，按文档块发，沿用原有行为 */
  | { kind: 'document' }
  /** 不进请求：broken 是原件读到了但认不出是图片，missing 是本地既无原件也无 serverId */
  | { kind: 'drop'; reason: 'broken' | 'missing' }

/**
 * 判定一个附件该怎么发：
 * - 不是图片 → document；
 * - 已识别出 MIME 且是服务端认的图片 → image；
 * - 是图片但 MIME 缺失或认不出 → 读本地原件的文件头：认得出是图片就发 image，
 *   认出来不是（损坏、加密、服务端不认的格式）→ drop；
 * - 本地没有原件时只能信任已有的 serverId：上传成功过就按 image 发，否则本来也不进请求。
 */
export const resolveFileBlockKind = async (
  file: FileAttachment,
  loadBytes: (id: string) => Promise<Blob | undefined>
): Promise<FileBlockVerdict> => {
  if (!file.isImage) {
    return { kind: 'document' }
  }
  if (isServableImage(file.mimeType)) {
    return { kind: 'image', source: 'mime' }
  }
  const blob = await loadBytes(file.id)
  if (!blob) {
    return file.serverId ? { kind: 'image', source: 'mime' } : { kind: 'drop', reason: 'missing' }
  }
  const sniffed = await sniffBlobMimeType(blob)
  return isServableImage(sniffed)
    ? { kind: 'image', source: 'bytes', sniffed }
    : { kind: 'drop', reason: 'broken' }
}

/**
 * 服务端拒收图片后要摘掉的候选：图片身份、但 MIME 不可信（空或认不出），
 * 也就是没法在本地确认它是服务端认的格式。已确认 MIME 的图片不动，避免误伤好图。
 */
export const isUnverifiedImage = (file: FileAttachment): boolean =>
  file.isImage && !isServableImage(file.mimeType)

/**
 * 服务端拒收附件后，决定哪些附件要从上下文里摘掉。
 * 报错点名了具体内容块时（rejectedFileId），只摘那一张 —— 比按 MIME 猜准得多；
 * 点名不到才退回「图片身份但 MIME 不可信」的旧判据。
 * 返回要摘的 id 列表；空列表表示没有可摘的（不该重试）。
 */
export const selectRejectedFiles = (
  files: readonly FileAttachment[],
  rejectedFileId?: string | null
): string[] => {
  if (rejectedFileId) {
    return files
      .filter((file) => !file.excluded && file.serverId === rejectedFileId)
      .map((file) => file.id)
  }
  return files.filter((file) => !file.excluded && isUnverifiedImage(file)).map((file) => file.id)
}

/**
 * 从服务端点名的内容块反查 file_id。
 * 报错里 messages.N.content.M 的 N 是请求 messages 的下标、M 是那条消息里内容块的下标，
 * 直接读组装好的请求就能拿到被拒的那张图的 file_id，不用猜。
 */
export const getRejectedFileId = (
  messages: readonly MessageParam[],
  index: { message: number; block: number } | null
): string | null => {
  if (!index) {
    return null
  }
  const message = messages[index.message]
  if (!message || message.role !== 'user' || typeof message.content === 'string') {
    return null
  }
  const block: FileBlockParam | { type: 'text' } | undefined = message.content[index.block]
  if (!block || block.type === 'text') {
    return null
  }
  return block.source.file_id
}

