import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/**
 * 图片路由原来只发 Cache-Control: max-age=3600,既没有 ETag 也没有 Range:
 * - 同一张表情在一轮对话里会重复出现很多次,浏览器缓存过期后每次都要重新拉整张图;
 * - GIF 播放器拿不到 Range 支持,大动图起播慢。
 * 现在补 ETag(size+mtime 派生)+ 304,以及单区间 Range(206 / 416)。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-cache-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const packsDir = join(home, '.dsh', 'meme-packs')
const packDir = join(packsDir, 'cache-pack')

const BODY = Buffer.from('0123456789ABCDEF')
mkdirSync(join(packDir, 'memes', 'happy'), { recursive: true })
writeFileSync(join(packDir, 'memes', 'happy', 'x.jpg'), BODY)
const db = new DatabaseSync(join(packDir, 'index.db'))
db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
db.prepare('INSERT INTO memes VALUES (?,?,?,?,?,?,?)').run('memes/happy/x.jpg', 'happy', 'x.jpg', '测试图', '测试图', 1, 1)
db.close()
writeFileSync(join(packDir, 'manifest.json'), JSON.stringify({ id: 'cache-pack', name: 'cache-pack', version: '1.0.0' }))

const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register() { return () => {} } },
  agentDefaultModel: null,
}

const mod = await import('../index.js')
mod.apply(ctx, {})
const route = handlers.find((h) => h.kind === 'prefix')
assert.ok(route, 'prefix 路由应已注册')

const callRoute = (url, headers = {}) => {
  let status = null
  let outHeaders = null
  let body
  route.handler({ method: 'GET', url, headers }, {
    writeHead(s, h) { status = s; outHeaders = h },
    end(b) { body = b },
  })
  return { status, headers: outHeaders, body }
}

const URL_OK = '/dsh-memes/cache-pack/memes/happy/x.jpg'

test('200 响应带 ETag / Accept-Ranges / Content-Length,内容不变', () => {
  const r = callRoute(URL_OK)
  assert.equal(r.status, 200)
  assert.equal(Buffer.from(r.body).toString(), BODY.toString())
  assert.match(String(r.headers.ETag), /^"[0-9a-f]+-[0-9a-f]+"$/)
  assert.equal(r.headers['Accept-Ranges'], 'bytes')
  assert.equal(r.headers['Content-Length'], String(BODY.length))
})

test('If-None-Match 命中 → 304 且没有响应体(省掉整张图)', () => {
  const first = callRoute(URL_OK)
  const second = callRoute(URL_OK, { 'if-none-match': first.headers.ETag })
  assert.equal(second.status, 304)
  assert.equal(second.headers.ETag, first.headers.ETag)
  assert.equal(second.body, undefined, '304 不允许带响应体')
})

test('If-None-Match 不匹配时照常回 200(图换过了)', () => {
  const r = callRoute(URL_OK, { 'if-none-match': '"deadbeef-1"' })
  assert.equal(r.status, 200)
  assert.equal(Buffer.from(r.body).toString(), BODY.toString())
})

test('Range 单区间 → 206 + Content-Range,只回对应字节', () => {
  const r = callRoute(URL_OK, { range: 'bytes=0-3' })
  assert.equal(r.status, 206)
  assert.equal(Buffer.from(r.body).toString(), '0123')
  assert.equal(r.headers['Content-Range'], 'bytes 0-3/' + BODY.length)
  assert.equal(r.headers['Content-Length'], '4')
})

test('Range 开区间(bytes=4-)到文件末尾', () => {
  const r = callRoute(URL_OK, { range: 'bytes=4-' })
  assert.equal(r.status, 206)
  assert.equal(Buffer.from(r.body).toString(), '456789ABCDEF')
  assert.equal(r.headers['Content-Range'], 'bytes 4-' + (BODY.length - 1) + '/' + BODY.length)
})

test('Range 后缀(bytes=-4)取最后 4 字节', () => {
  const r = callRoute(URL_OK, { range: 'bytes=-4' })
  assert.equal(r.status, 206)
  assert.equal(Buffer.from(r.body).toString(), 'CDEF')
  assert.equal(r.headers['Content-Range'], 'bytes ' + (BODY.length - 4) + '-' + (BODY.length - 1) + '/' + BODY.length)
})

test('Range 起点越界 → 416 + Content-Range: bytes */size', () => {
  const r = callRoute(URL_OK, { range: 'bytes=999-' })
  assert.equal(r.status, 416)
  assert.equal(r.headers['Content-Range'], 'bytes */' + BODY.length)
})

test('parseByteRange 纯函数:非法输入回 false,无 Range 回 null,多区间回 null', () => {
  const { parseByteRange } = mod
  assert.equal(parseByteRange(undefined, 10), null)
  assert.equal(parseByteRange('', 10), null)
  assert.equal(parseByteRange('items=0-1', 10), null)
  assert.equal(parseByteRange('bytes=0-1,5-6', 10), null, '多区间不支持,按整份返回')
  assert.equal(parseByteRange('bytes=10-', 10), false, '起点等于长度即越界')
  assert.equal(parseByteRange('bytes=5-2', 10), false)
  assert.equal(parseByteRange('bytes=-0', 10), false)
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseByteRange('bytes=2-999', 10), { start: 2, end: 9 }, '超出尾部要截到 size-1')
  assert.deepEqual(parseByteRange('bytes=-99', 10), { start: 0, end: 9 })
})

test('白名单仍然优先:不在索引里的路径 404,不因为加了缓存头而放行', () => {
  assert.equal(callRoute('/dsh-memes/cache-pack/memes/happy/nope.jpg').status, 404)
})
