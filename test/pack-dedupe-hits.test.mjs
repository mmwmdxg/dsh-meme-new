import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'

/**
 * 索引可选列(sha256 / hits / last_used)带来的两件事:
 *   1) 去重:同一图库内重复收录同一份字节要拦(反复点入库/反复上传是纯噪音);
 *      跨图库重复只提示不拦(同图进两个库是合理用法),靠 meme_list duplicates 报告。
 *   2) 使用热度:send_meme 递出候选就 hits+1,清单能按热度排、能筛「从未使用」。
 *
 * 老 index.db 没有这些列,读写都要能降级:读退回基础列、写在落盘前 ALTER 补列。
 */

const home = mkdtempSync(join(tmpdir(), 'dsh-meme-dedupe-'))
process.env.DSH_MEME_HOME = home
process.env.HOME = home
const packsDir = join(home, '.dsh', 'meme-packs')

// 一份最小的「JPEG」字节:去重看的是字节,不是能不能解码
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0x33])
const IMG2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x44, 0x55, 0x66])

const handlers = []
const webServer = { host: '127.0.0.1', port: 3999, register(r) { handlers.push(r) }, tapIndex() {} }
const tools = []
const ctx = {
  effect(body) { return body() },
  on() { return () => {} },
  get(name) { return name === 'webServer' ? webServer : undefined },
  tools: { register(tool) { tools.push(tool) } },
  agentDefaultModel: null,
}
const mod = await import('../index.js')
const memesMod = await import('../memes.js')
mod.apply(ctx, {})

const api = handlers.find((h) => h.path === '/dsh-memes-api')
assert.ok(api, '管理 API 应已注册')

const post = (body) => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = 'POST'
  req.url = '/'
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(s) { res.statusCode = s },
    end(b) { res.body = String(b); resolve({ statusCode: res.statusCode, json: JSON.parse(res.body) }) },
  }
  api.handler(req, res).catch(reject)
  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
})

const get = (qs = '') => new Promise((resolve, reject) => {
  const req = new EventEmitter()
  req.method = 'GET'
  // 查询串要带 ?,否则 searchParams 是空的(packId=all / sort / dupes 全都不会生效)
  req.url = '/' + (qs ? '?' + qs : '')
  req.headers = { host: '127.0.0.1:3999' }
  const res = {
    statusCode: null, body: null,
    writeHead(s) { res.statusCode = s },
    end(b) { res.body = String(b == null ? '' : b); resolve({ statusCode: res.statusCode, json: JSON.parse(res.body) }) },
  }
  api.handler(req, res).catch(reject)
})

// upload 落在「当前激活图库」,所以每次上传前显式切库 —— 这也顺带钉住 setPack 的行为
const upload = async (packId, bytes, caption) => {
  const switched = await post({ op: 'setPack', packId })
  assert.equal(switched.json.ok, true, '切库失败: ' + JSON.stringify(switched.json))
  return post({ op: 'upload', tag: 'happy', fileName: 'x.jpg', caption, dataBase64: bytes.toString('base64') })
}
const tool = (name) => tools.find((t) => t.name === name)

test('建包走 API,两个包各自可上传', async () => {
  assert.equal((await post({ op: 'createMemePack', id: 'dedupe-a', name: '去重A' })).json.ok, true)
  assert.equal((await post({ op: 'createMemePack', id: 'dedupe-b', name: '去重B' })).json.ok, true)
  assert.equal((await upload('dedupe-b', IMG2, 'B 库的图')).json.ok, true)
})

test('同一图库重复收录同一份字节 → 拒绝,并指出已有那张', async () => {
  const first = await upload('dedupe-a', IMG, 'A 库的图')
  assert.equal(first.json.ok, true, JSON.stringify(first.json))
  const again = await upload('dedupe-a', IMG, 'A 库重复')
  assert.equal(again.json.ok, false, '同库重复应被拒绝')
  assert.match(again.json.error || '', /已经在图库里了/)
  assert.match(again.json.error || '', /去重A/, '报错里要说清是哪张/哪库')
})

test('跨图库收录同一份字节 → 允许(同图进两个库是合理用法)', async () => {
  const other = await upload('dedupe-b', IMG, 'B 库也放一张')
  assert.equal(other.json.ok, true, '跨库重复不该被拦:' + JSON.stringify(other.json))
})

test('meme_list duplicates:按 sha256 报告跨库重复', async () => {
  const list = tool('meme_list')
  assert.ok(list, 'meme_list 应注册')
  const r = await list.execute({ duplicates: true })
  assert.equal(r.ok, true, r.message)
  assert.ok(r.duplicateGroups >= 1, '应发现至少一组重复:' + r.message)
  const group = r.groups.find((g) => g.count >= 2)
  assert.ok(group, '重复组里应有 >=2 张')
  const libs = new Set(group.items.map((it) => it.library))
  assert.ok(libs.size >= 2, '同一份字节应分布在多个图库:' + JSON.stringify(group))
  assert.match(r.message, /扫描新增|重复/)
})

test('send_meme 递出候选 → hits 递增,清单可按热度排序', async () => {
  const send = tool('send_meme')
  const list = tool('meme_list')
  const before = await list.execute({ sort: 'hits' })
  const beforeTop = before.rows[0] ? before.rows[0].hits : 0

  const sent = await send.execute({ tag: 'happy', limit: 20 })
  assert.equal(sent.ok, true, sent.message)

  const after = await list.execute({ sort: 'hits' })
  assert.ok(after.rows.some((row) => row.hits > 0), '应有图被记了使用次数:' + JSON.stringify(after.rows.map((r) => r.hits)))
  assert.ok(after.rows[0].hits >= beforeTop, '按热度排序后首位不应变低')
})

test('unused 只列从未被抽中过的图', async () => {
  const r = await tool('meme_list').execute({ unused: true })
  assert.equal(r.ok, true)
  for (const row of r.rows) assert.equal(row.hits, 0, 'unused 里不该出现用过的图')
})

test('老索引(无可选列)可读:退回基础列并把 hits 当 0', () => {
  const dir = join(packsDir, 'legacy-pack')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'index.db'))
  db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL)')
  db.prepare('INSERT INTO memes VALUES (?,?,?,?,?,?,?)').run('memes/happy/old.jpg', 'happy', 'old.jpg', '老图', '', 1, 1)
  db.close()
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id: 'legacy-pack', name: '老库', version: '1.0.0' }))

  const store = new memesMod.MemesStore(dir)
  const rows = store.rows
  store.close()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].hits, 0, '缺列时 hits 兜底为 0')
  assert.equal(rows[0].sha256, null, '缺列时 sha256 兜底为 null')
})

test('ensureIndexSchema 补齐列且幂等;之后 hits 能累加', () => {
  const dir = join(packsDir, 'legacy-pack')
  const writer = memesMod.openIndexWriter(dir)
  try {
    const added = memesMod.ensureIndexSchema(writer)
    assert.deepEqual(added.sort(), ['hits', 'last_used', 'sha256'])
    assert.deepEqual(memesMod.ensureIndexSchema(writer), [], '再调一次不应重复加列')
  } finally { writer.close() }

  assert.equal(memesMod.bumpHits(dir, ['memes/happy/old.jpg'], 1234), 1)
  assert.equal(memesMod.bumpHits(dir, ['memes/happy/old.jpg'], 2345), 1)
  const store = new memesMod.MemesStore(dir)
  const row = store.rows.find((r) => r.path === 'memes/happy/old.jpg')
  store.close()
  assert.equal(row.hits, 2)
  assert.equal(row.last_used, 2345)
})

test('bumpHits 对不存在的路径不抛错(统计失败不影响发图)', () => {
  assert.equal(memesMod.bumpHits(join(packsDir, 'legacy-pack'), ['memes/happy/nope.jpg']), 1)
  assert.equal(memesMod.bumpHits(join(packsDir, 'legacy-pack'), []), 0)
  assert.equal(memesMod.bumpHits(join(packsDir, 'not-a-pack'), ['x.jpg']), 0)
})

test('上传时写入的 sha256 与字节一致', () => {
  const expectImg2 = createHash('sha256').update(IMG2).digest('hex')
  const expectImg = createHash('sha256').update(IMG).digest('hex')
  const rowsOf = (packId) => {
    const db = new DatabaseSync(join(packsDir, packId, 'index.db'), { readOnly: true })
    try { return db.prepare('SELECT path, sha256 FROM memes').all() } finally { db.close() }
  }
  assert.ok(rowsOf('dedupe-b').some((r) => r.sha256 === expectImg2), 'B 库应有 IMG2 的哈希')
  assert.ok(rowsOf('dedupe-b').some((r) => r.sha256 === expectImg), 'B 库跨库收录的 IMG 也应带哈希')
  assert.ok(rowsOf('dedupe-a').some((r) => r.sha256 === expectImg), 'A 库应有 IMG 的哈希')
})

test('GET 列表:sort=hits / unused=1 只影响展示顺序和筛选', async () => {
  const all = await get('packId=all')
  assert.equal(all.json.ok, true)
  assert.ok(all.json.memes.length >= 2, '应有图:' + JSON.stringify(all.json.memes))

  const byHits = await get('packId=all&sort=hits')
  const hits = byHits.json.memes.map((m) => Number(m.hits || 0))
  assert.deepEqual(hits, [...hits].sort((a, b) => b - a), 'sort=hits 应按使用次数降序:' + JSON.stringify(hits))

  const unused = await get('packId=all&unused=1')
  for (const m of unused.json.memes) assert.equal(Number(m.hits || 0), 0, 'unused=1 不该出现用过的图')
  assert.ok(unused.json.memes.length < all.json.memes.length, '用过的图应被筛掉一些')
})

test('GET 列表:dupes=1 返回分组而不是平铺清单', async () => {
  const r = await get('packId=all&dupes=1')
  assert.equal(r.json.ok, true)
  assert.ok(r.json.duplicateGroups >= 1, '应发现重复组')
  assert.deepEqual(r.json.memes, [], '查重模式不回平铺清单')
  const group = r.json.groups.find((g) => g.count >= 2)
  assert.ok(group && Array.isArray(group.items) && group.items.length === group.count)
  assert.ok(group.items.every((it) => typeof it.path === 'string' && it.url), '重复项要带 path 与 url 供面板渲染')
})

test('索引快照缓存:上传后立刻能取到新图,删掉后立刻 404', async () => {
  const route = handlers.find((h) => h.kind === 'prefix')
  assert.ok(route, '图片路由应已注册')
  const fetchImage = (url) => {
    let status = null
    let body
    route.handler({ method: 'GET', url, headers: { host: '127.0.0.1:3999' } }, {
      writeHead(s) { status = s },
      end(b) { body = b },
    })
    return { status, body }
  }

  const FRESH = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x99, 0x88, 0x77])
  const up = await upload('dedupe-a', FRESH, '缓存后的新图')
  assert.equal(up.json.ok, true, JSON.stringify(up.json))

  // 先读一次把快照建起来(缓存命中路径)
  const list = await get('packId=all')
  const row = list.json.memes.find((m) => (m.caption || '') === '缓存后的新图')
  assert.ok(row, '新图应出现在清单里:' + JSON.stringify(list.json.memes.map((m) => m.caption)))

  const served = fetchImage(row.url)
  assert.equal(served.status, 200, '上传后白名单必须立刻包含新图(缓存不得挡住新文件)')
  assert.deepEqual(Buffer.from(served.body), FRESH)

  // 再取一次,走缓存命中路径,结果必须一致
  const again = fetchImage(row.url)
  assert.equal(again.status, 200)
  assert.deepEqual(Buffer.from(again.body), FRESH)

  // 删除后立刻 404:快照要跟着索引一起失效
  const del = await post({ op: 'delete', path: row.path.replace(/^dedupe-a\//, '') })
  assert.equal(del.json.ok, true)
  assert.equal(fetchImage(row.url).status, 404, '删掉的文件不能让缓存继续供给')
})

test('shapeMemeRows:排序稳定、缺列按 0 处理、unused 只留 0', () => {
  const rows = [
    { path: 'a', hits: 3, last_used: 10 },
    { path: 'b', hits: 0 },
    { path: 'c', hits: 1, last_used: 30 },
  ]
  assert.deepEqual(mod.shapeMemeRows(rows, { sort: 'hits' }).map((r) => r.path), ['a', 'c', 'b'])
  assert.deepEqual(mod.shapeMemeRows(rows, { sort: 'recent' }).map((r) => r.path), ['c', 'a', 'b'])
  assert.deepEqual(mod.shapeMemeRows(rows, { unused: true }).map((r) => r.path), ['b'])
  assert.deepEqual(mod.shapeMemeRows(rows, { sort: 'nope' }).map((r) => r.path), ['a', 'b', 'c'])
  assert.deepEqual(mod.shapeMemeRows(null, {}), [])
})

test('groupDuplicateRows:只返回 >1 的组,没哈希的行跳过', () => {
  const rows = [
    { path: 'a', sha256: 'x' },
    { path: 'b', sha256: 'x' },
    { path: 'c', sha256: 'y' },
    { path: 'd', sha256: null },
  ]
  const groups = mod.groupDuplicateRows(rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].sha256, 'x')
  assert.equal(groups[0].count, 2)
  assert.deepEqual(groups[0].items.map((r) => r.path), ['a', 'b'])
  assert.deepEqual(mod.groupDuplicateRows([]), [])
})
