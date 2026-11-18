/**
 * 附件发送前的两道闸门的回归用例：`npm test` 直接用 node 的类型剥离跑，不引入测试框架。
 *
 * 背景：导入的会话里图片常常没有 MIME（导入时认不出类型），旧代码直接按归档的
 * is_image 组 image 块，服务端在 messages 接口报「上传了一张不受支持的图片」，
 * 整轮对话连坐，而且每次重发都复现。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolveFileBlockKind,
  isUnverifiedImage,
  selectRejectedFiles,
  getRejectedFileId,
} from '../fileBlockKind.js'
import type { FileAttachment } from '../types.js'

/** client.ts 在模块顶层读构建期注入的全局量，跑测试时先补一个占位值 */
;(globalThis as unknown as { __API_ORIGIN__: string }).__API_ORIGIN__ =
  'https://api.deepseek.com'
const { ApiError } = await import('../../api/client.js')
const { isRejectedFileError, getRejectedBlockIndex } = await import('../../api/errors.js')

/** 一张 PNG 的文件头；服务端认这个格式 */
const PNG_HEADER = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
/** 一段普通文本；扩展名可以是 .png 但内容不是图片 */
const NOT_IMAGE = new TextEncoder().encode('this is not an image at all')

const attachment = (patch: Partial<FileAttachment> = {}): FileAttachment => ({
  id: 'file-1',
  serverId: null,
  name: 'image.png',
  size: 12,
  isImage: true,
  mimeType: '',
  ...patch,
})

const bytesOf = (bytes: Uint8Array) => async () => new Blob([bytes.slice().buffer as ArrayBuffer])

/** 服务端拒收附件时返回的 400 */
const rejected = (message: string) => new ApiError('http', message, 400)

test('类型为空的图片会按文件头补成真实格式，仍按 image 发', async () => {
  const verdict = await resolveFileBlockKind(attachment(), bytesOf(PNG_HEADER))
  assert.deepEqual(verdict, { kind: 'image', source: 'bytes', sniffed: 'image/png' })
})

test('JPEG 同样按文件头识别，不依赖扩展名', async () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
  const verdict = await resolveFileBlockKind(attachment({ name: 'no-ext' }), bytesOf(jpeg))
  assert.equal(verdict.kind, 'image')
  assert.equal(verdict.kind === 'image' ? verdict.sniffed : '', 'image/jpeg')
})

test('归档说是图片、内容却不是图片的附件会被摘出请求', async () => {
  const verdict = await resolveFileBlockKind(attachment(), bytesOf(NOT_IMAGE))
  assert.deepEqual(verdict, { kind: 'drop', reason: 'broken' })
})

test('heic 能识别但不作为 image 块发', async () => {
  const heic = Uint8Array.from([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0,
  ])
  const verdict = await resolveFileBlockKind(attachment(), bytesOf(heic))
  assert.deepEqual(verdict, { kind: 'drop', reason: 'broken' })
})

test('非图片附件仍按文档发，不读原件', async () => {
  let reads = 0
  const verdict = await resolveFileBlockKind(attachment({ isImage: false }), async () => {
    reads += 1
    return undefined
  })
  assert.deepEqual(verdict, { kind: 'document' })
  assert.equal(reads, 0)
})

test('只有图片身份、MIME 不可信的附件才是摘除候选', () => {
  assert.equal(isUnverifiedImage(attachment()), true)
  assert.equal(isUnverifiedImage(attachment({ mimeType: 'image/png' })), false)
  assert.equal(isUnverifiedImage(attachment({ isImage: false })), false)
})

test('摘除时只挑未摘过的可疑图片，已确认 MIME 的好图不动', () => {
  const ids = selectRejectedFiles([
    attachment({ id: 'a' }),
    attachment({ id: 'b', mimeType: 'image/png' }),
    attachment({ id: 'c', excluded: true }),
    attachment({ id: 'd', isImage: false }),
  ])
  assert.deepEqual(ids, ['a'])
})

test('「不受支持的图片」被识别为附件内容被拒，并取出被点名的位置', () => {
  const message =
    'messages.0.content.0: 您上传了一张不受支持的图片。请确保您的图片有效且为受支持的图片格式'
  assert.equal(isRejectedFileError(rejected(message)), true)
  assert.deepEqual(getRejectedBlockIndex(message), { message: 0, block: 0 })
})

test('英文原文与更靠后的位置同样识别', () => {
  const message =
    'messages.7.content.2: You have uploaded an unsupported image. Please ensure your image is valid'
  assert.equal(isRejectedFileError(rejected(message)), true)
  assert.deepEqual(getRejectedBlockIndex(message), { message: 7, block: 2 })
})

test('file_id 失效不是内容被拒，不能被当成同一类处理', () => {
  const message = 'messages.0.content.0.source.file_id: invalid file_id'
  assert.equal(isRejectedFileError(rejected(message)), false)
})

test('非 400 的报错不触发摘附件', () => {
  assert.equal(
    isRejectedFileError(new ApiError('http', 'messages.0.content.0: unsupported image', 500)),
    false
  )
})

test('服务端点名了内容块时，直接反查出被拒那张图的 file_id', () => {
  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'image' as const, source: { type: 'file' as const, file_id: 'file-api-aaa' } },
        { type: 'text' as const, text: '这张图里是什么' },
      ],
    },
  ]
  const index = getRejectedBlockIndex('messages.0.content.0: 您上传了一张不受支持的图片')
  assert.equal(getRejectedFileId(messages, index), 'file-api-aaa')
})

test('点名到文本块或越界位置时反查不出 file_id，交回按 MIME 猜', () => {
  const messages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '只有文字' }],
    },
  ]
  assert.equal(getRejectedFileId(messages, { message: 0, block: 0 }), null)
  assert.equal(getRejectedFileId(messages, { message: 9, block: 0 }), null)
  assert.equal(getRejectedFileId(messages, null), null)
})

test('点名到具体 file_id 时只摘那一张，不再按 MIME 误伤同轮的好图', () => {
  const files = [
    attachment({ id: 'a', serverId: 'file-api-aaa' }),
    attachment({ id: 'b', serverId: 'file-api-bbb' }),
  ]
  // 两张都 MIME 不可信，但服务端只拒了第二张
  assert.deepEqual(selectRejectedFiles(files, 'file-api-bbb'), ['b'])
  // 拿不到 file_id 时才退回旧判据，两张都摘
  assert.deepEqual(selectRejectedFiles(files, null), ['a', 'b'])
})
