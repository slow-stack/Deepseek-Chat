/**
 * 上传前缩图的回归用例：`npm test` 直接用 node 的类型剥离跑，不引入测试框架。
 *
 * 背景：Files API 对图片长边有上限，超限的图会在 messages 接口被拒，整轮对话连坐，
 * 而且旧会话里已经上传过的 file_id 会被反复复用，重发一次错一次。这里把缩放本身
 * 的行为固定下来：什么时候原样返回、长边怎么对齐、后缀跟着实际编码走。
 *
 * 运行环境没有 DOM，所以 Image / document.createElement('canvas') / toBlob 都用替身，
 * 只有「怎么算尺寸、选什么编码、起什么名字」这段真逻辑跑的是生产代码。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUploadImageOversized, resizeUploadImage } from '../resizeUploadImage.js'

/** 每张测试图要报出来的原始长宽，由 makeImage 在 decode 时吐出 */
let decodeSize = { width: 100, height: 100 }
/** 画布上最后一次 drawImage 的目标尺寸 */
let drawn: { width: number; height: number } | null = null
/** toBlob 要回吐的 MIME；给空串表示编码失败 */
let encodeAs = 'image/png'

class FakeImage {
  naturalWidth = 0
  naturalHeight = 0
  private source = ''

  set src(value: string) {
    this.source = value
  }

  get src() {
    return this.source
  }

  async decode() {
    this.naturalWidth = decodeSize.width
    this.naturalHeight = decodeSize.height
  }
}

const makeCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({
    drawImage: (_image: unknown, _x: number, _y: number, width: number, height: number) => {
      drawn = { width, height }
    },
  }),
  toBlob: (callback: (blob: Blob | null) => void, type?: string) => {
    if (!encodeAs) {
      callback(null)
      return
    }
    callback(new Blob(['x'], { type: type === encodeAs ? type : encodeAs }))
  },
})

const globals = globalThis as unknown as Record<string, unknown>
globals.Image = FakeImage
globals.document = { createElement: (tag: string) => (tag === 'canvas' ? makeCanvas() : {}) }
globals.URL = {
  ...URL,
  createObjectURL: () => 'blob:fake',
  revokeObjectURL: () => undefined,
}

/** 每张图开始前重置替身状态，避免上一个用例的尺寸漏过来 */
const reset = (width: number, height: number, encoded = 'image/png') => {
  decodeSize = { width, height }
  drawn = null
  encodeAs = encoded
}

const makeFile = (name: string, type: string) => new File(['x'], name, { type })

test('长边不超限时原样返回，不重新编码', async () => {
  reset(4096, 3000)
  const file = makeFile('ok.png', 'image/png')
  const result = await resizeUploadImage(file)
  assert.equal(result, file)
  assert.equal(drawn, null)
})

test('横向超限时宽对齐到 4096，高等比缩', async () => {
  reset(8192, 4096, 'image/jpeg')
  const result = await resizeUploadImage(makeFile('wide.jpg', 'image/jpeg'))
  assert.deepEqual(drawn, { width: 4096, height: 2048 })
  assert.equal(result.type, 'image/jpeg')
  assert.equal(result.name, 'wide.jpg')
})

test('竖向超限时高对齐到 4096，宽等比缩', async () => {
  reset(3000, 12000, 'image/webp')
  const result = await resizeUploadImage(makeFile('tall.webp', 'image/webp'))
  assert.deepEqual(drawn, { width: 1024, height: 4096 })
  assert.equal(result.name, 'tall.webp')
})

test('极细长图的短边不会缩成 0 像素', async () => {
  reset(1, 100000)
  await resizeUploadImage(makeFile('sliver.png', 'image/png'))
  assert.deepEqual(drawn, { width: 1, height: 4096 })
})

test('GIF 缩放后变成 PNG 静态图，后缀跟着实际编码走', async () => {
  reset(10000, 10000, 'image/png')
  const result = await resizeUploadImage(makeFile('loop.gif', 'image/gif'))
  assert.equal(result.type, 'image/png')
  assert.equal(result.name, 'loop.png')
})

test('浏览器把 JPEG 回退成 PNG 时，后缀以实际编码为准', async () => {
  reset(8192, 4096, 'image/png')
  const result = await resizeUploadImage(makeFile('photo.jpg', 'image/jpeg'))
  assert.equal(result.type, 'image/png')
  assert.equal(result.name, 'photo.png')
})

test('文件名里有多处点时只换最后一个后缀', async () => {
  reset(8192, 100, 'image/png')
  const result = await resizeUploadImage(makeFile('a.b.c.png', 'image/png'))
  assert.equal(result.name, 'a.b.c.png')
})

test('已经中止的信号不再往下走', async () => {
  reset(8192, 4096)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => resizeUploadImage(makeFile('x.png', 'image/png'), controller.signal))
})

test('编码不出结果时抛出，而不是悄悄传原图', async () => {
  reset(8192, 4096, '')
  await assert.rejects(() => resizeUploadImage(makeFile('x.png', 'image/png')))
})

test('判定阈值是 4096：等于不算超限，多一像素才算', async () => {
  reset(4096, 4096)
  assert.equal(await isUploadImageOversized(new Blob(['x'])), false)
  reset(4097, 100)
  assert.equal(await isUploadImageOversized(new Blob(['x'])), true)
})
