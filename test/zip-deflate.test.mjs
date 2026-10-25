import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'

/**
 * 回归:unzipStore 只支持 store(method 0)。但「导入别人分享的图库 ZIP」是文档里的公开
 * 功能,而 GitHub 的 Download ZIP、系统压缩工具、几乎所有打 zip 的程序默认都用 deflate,
 * 于是这些包一律报「ZIP 含压缩条目(仅支持未压缩)」—— 用户看不懂,也没法自救。
 *
 * 现在支持 method 8,并补上解压后大小与 CRC32 校验:压缩包被截断/篡改时 inflateRaw 可能
 * 解出半截数据而不报错,落盘就是一张坏图,还查不出原因。
 */

const mod = await import('../index.js')
const { unzipStore, zipStore } = mod

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** 极简 ZIP 写入器:同一个包可以按 store(0) 或 deflate(8) 生成,便于对照 */
const buildZip = (files, method) => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const body = method === 8 ? deflateRawSync(data) : data
    const crc = crc32(data)
    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

const SAMPLE = [
  { name: 'index.db', data: Buffer.from('SQLite-format-3\u0000fake-index') },
  { name: 'manifest.json', data: Buffer.from(JSON.stringify({ id: 'pack', name: '中文图库' })) },
  { name: 'memes/happy/a.jpg', data: Buffer.from('JPEG-BYTES-'.repeat(40)) },
]

test('deflate(method 8) 的包能解出来 —— GitHub Download ZIP / 系统压缩工具的默认格式', () => {
  const out = unzipStore(buildZip(SAMPLE, 8))
  assert.equal(out.size, SAMPLE.length)
  for (const { name, data } of SAMPLE) {
    assert.ok(out.has(name), '缺少条目 ' + name)
    assert.deepEqual(out.get(name), data, name + ' 内容必须逐字节一致')
  }
})

test('store(method 0) 的包行为不变(插件自己导出的包)', () => {
  const out = unzipStore(buildZip(SAMPLE, 0))
  assert.equal(out.size, SAMPLE.length)
  assert.deepEqual(out.get('memes/happy/a.jpg'), SAMPLE[2].data)
})

test('zipStore → unzipStore 往返仍然自洽', () => {
  const out = unzipStore(zipStore(SAMPLE))
  for (const { name, data } of SAMPLE) assert.deepEqual(out.get(name), data)
})

test('多文件 deflate 包与中文条目名', () => {
  const files = [
    { name: 'memes/分类/图一.gif', data: Buffer.from('GIF89a-动画') },
    { name: 'memes/分类/图二.png', data: Buffer.from('PNG') },
  ]
  const out = unzipStore(buildZip(files, 8))
  assert.deepEqual([...out.keys()].sort(), ['memes/分类/图一.gif', 'memes/分类/图二.png'].sort())
  assert.equal(out.get('memes/分类/图一.gif').toString(), 'GIF89a-动画')
})

test('内容被篡改 → 报解压失败或 CRC 不符,不会静默落坏图', () => {
  const zip = buildZip(SAMPLE, 8)
  // 30(sig..extraLen) + 5(index.db) 之后是压缩后的索引体,改它
  zip[38] ^= 0xFF
  assert.throws(() => unzipStore(zip), /(解压失败|CRC 校验失败|大小不符)/)
})

test('压缩方式不支持时报错里带上编号,便于定位', () => {
  const zip = buildZip(SAMPLE.slice(0, 1), 0)
  const cdPos = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.ok(cdPos > 0, '应能在包里找到中央目录')
  zip.writeUInt16LE(12, 8)          // local header method = 12(bzip2)
  zip.writeUInt16LE(12, cdPos + 10) // 中央目录 method
  assert.throws(() => unzipStore(zip), /不支持的压缩方式\(12\)/)
})

test('截断/非 ZIP 输入仍然报明确错误', () => {
  assert.throws(() => unzipStore(Buffer.from('not a zip at all')), /不是有效的 ZIP/)
  assert.throws(() => unzipStore(Buffer.alloc(0)), /不是有效的 ZIP/)
})
