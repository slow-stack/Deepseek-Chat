/**
 * 按文件头字节识别真实类型。
 *
 * 为什么不能只靠扩展名和浏览器给的 file.type：
 * - 导入的历史附件由归档里的 is_image 决定图片身份，浏览器不知道真实类型，file.type 是空的；
 * - 上传时 type 为空，FormData 会按 application/octet-stream 发出去，服务端能拿到 file_id
 *   却解不出图片，于是整轮请求 400「不受支持的图片」；
 * - 扩展名可以随便改，白名单里也混着 psd、tga 这类服务端根本不按图片解析的格式。
 *
 * 只读前几百字节，不解码图片，开销可以忽略。
 */

/** 读头部用的字节数：SVG 的 XML 声明可能在前几百字节 */
export const HEADER_BYTES = 512

const startsWith = (bytes: Uint8Array, ...prefix: number[]) =>
  prefix.every((byte, index) => bytes[index] === byte)

/** 前 12 字节按 ASCII 比较，用于 RIFF、ftyp、GIF 这类文本头 */
const asciiHeader = (bytes: Uint8Array) => new TextDecoder('ascii').decode(bytes.subarray(0, 12))

const readUint32 = (bytes: Uint8Array, offset: number) =>
  bytes[offset] |
  ((bytes[offset + 1] ?? 0) << 8) |
  ((bytes[offset + 2] ?? 0) << 16) |
  ((bytes[offset + 3] ?? 0) << 24)

/** BMP 的 DIB 头长度只可能是这几个值，用来避开「以 BM 开头的普通文本」 */
const BMP_HEADER_SIZES: ReadonlySet<number> = new Set([12, 40, 52, 56, 64, 108, 124])

const looksLikeBmp = (bytes: Uint8Array) =>
  startsWith(bytes, 0x42, 0x4d) &&
  bytes.slice(6, 10).every((byte) => byte === 0) &&
  BMP_HEADER_SIZES.has(readUint32(bytes, 14) >>> 0)

const looksLikeSvg = (bytes: Uint8Array) => {
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, HEADER_BYTES)).trimStart()
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))
}

/**
 * 识别图片与几种常见文档；认不出时返回空字符串。
 * 空字符串表示「不知道」，调用方不能直接把它当成非图片。
 */
export const sniffMimeType = (bytes: Uint8Array): string => {
  if (bytes.length < 4) {
    return ''
  }
  const header = asciiHeader(bytes)
  if (startsWith(bytes, 0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(bytes, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (looksLikeBmp(bytes)) {
    return 'image/bmp'
  }
  if (startsWith(bytes, 0x49, 0x49, 0x2a, 0) || startsWith(bytes, 0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  // ISO-BMFF：偏移 4 起是 ftyp，紧接品牌
  if (header.slice(4, 8) === 'ftyp') {
    const brand = header.slice(8, 12)
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif'
    }
    if (brand.startsWith('hei') || brand.startsWith('mif')) {
      return 'image/heic'
    }
  }
  if (startsWith(bytes, 0x00, 0x00, 0x01, 0x00)) {
    return 'image/x-icon'
  }
  if (header.startsWith('%PDF')) {
    return 'application/pdf'
  }
  if (looksLikeSvg(bytes)) {
    return 'image/svg+xml'
  }
  return ''
}

/** 读 blob 头部再识别；空文件按「不知道」处理 */
export const sniffBlobMimeType = async (blob: Blob): Promise<string> => {
  if (blob.size === 0) {
    return ''
  }
  return sniffMimeType(new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer()))
}

/** 服务端按图片解析的格式：heic 能识别但不收，必须挡在 image 块之外 */
export const SERVABLE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/x-icon',
  'image/svg+xml',
])

export const isImageMime = (mimeType: string) => mimeType.startsWith('image/')

/** 能否作为 image 块发给服务端；识别不出类型时保守地按「不能」处理 */
export const isServableImage = (mimeType: string) => SERVABLE_IMAGE_TYPES.has(mimeType)
