import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { mergeCaptions } from '../index.js'

/**
 * 文案外挂（captionsUrl）的合并契约：
 * 只更新已有行、不新建；默认只在两个字段都为空时填；overwrite 才整段覆盖；
 * 认 `memes/x/y.jpg` 与 `x/y.jpg` 两种 key；对不上任何行的 key 记进 missing。
 */

function makePack(rows) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-meme-captions-'))
  mkdirSync(join(root, 'memes', 'happy'), { recursive: true })
  const db = new DatabaseSync(join(root, 'index.db'))
  db.exec('CREATE TABLE memes (path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT, mtime REAL, captioned_at REAL, sha256 TEXT, hits INTEGER DEFAULT 0, last_used REAL)')
  const ins = db.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords) VALUES (?, ?, ?, ?, ?)')
  for (const r of rows) ins.run(r.path, r.tag || 'happy', r.path.split('/').pop(), r.caption || '', r.keywords || '')
  db.close()
  return root
}

function read(root) {
  const db = new DatabaseSync(join(root, 'index.db'), { readOnly: true })
  try {
    return db.prepare('SELECT path, caption, keywords FROM memes ORDER BY path').all()
  } finally {
    db.close()
  }
}

test('默认只填空行：已经有文案的行一个字不动', () => {
  const root = makePack([
    { path: 'memes/happy/deyi.jpg', caption: '得意', keywords: '骄傲' },
    { path: 'memes/happy/ok.jpg' },
  ])
  const res = mergeCaptions(root, {
    'memes/happy/deyi.jpg': { caption: '被覆盖了', keywords: '被覆盖了' },
    'memes/happy/ok.jpg': { caption: '点赞', keywords: '好的 ok' },
  })
  assert.equal(res.updated, 1)
  assert.equal(res.kept, 1)
  const rows = read(root)
  assert.deepEqual({ ...rows[0] }, { path: 'memes/happy/deyi.jpg', caption: '得意', keywords: '骄傲' })
  assert.deepEqual({ ...rows[1] }, { path: 'memes/happy/ok.jpg', caption: '点赞', keywords: '好的 ok' })
})

test('overwrite 才整段覆盖（显式刷新文案时用）', () => {
  const root = makePack([{ path: 'memes/happy/deyi.jpg', caption: '旧描述', keywords: '旧词' }])
  const res = mergeCaptions(root, { 'memes/happy/deyi.jpg': { caption: '新描述', keywords: '新词' } }, { overwrite: true })
  assert.equal(res.updated, 1)
  assert.deepEqual({ ...read(root)[0] }, { path: 'memes/happy/deyi.jpg', caption: '新描述', keywords: '新词' })
})

test('不新建行：文案里写了图库里没有的图，只记 missing', () => {
  const root = makePack([{ path: 'memes/happy/deyi.jpg' }])
  const res = mergeCaptions(root, { 'memes/happy/ghost.jpg': { caption: '不存在的图' } })
  assert.equal(res.missing, 1)
  assert.equal(res.updated, 0)
  assert.equal(read(root).length, 1, '行数不能变')
})

test('key 两种写法都认：带 memes/ 前缀和相对路径', () => {
  const root = makePack([
    { path: 'memes/happy/deyi.jpg' },
    { path: 'memes/happy/ok.jpg' },
  ])
  mergeCaptions(root, {
    'happy/deyi.jpg': { caption: '得意' },
    'memes/happy/ok.jpg': { caption: '点赞' },
  })
  const rows = read(root)
  assert.equal(rows[0].caption, '得意')
  assert.equal(rows[1].caption, '点赞')
})

test('脏输入不炸：非对象 / 空对象直接返回零', () => {
  const root = makePack([{ path: 'memes/happy/deyi.jpg' }])
  assert.deepEqual(mergeCaptions(root, null), { updated: 0, kept: 0, missing: 0 })
  assert.deepEqual(mergeCaptions(root, []), { updated: 0, kept: 0, missing: 0 })
  assert.deepEqual(mergeCaptions(root, {}), { updated: 0, kept: 0, missing: 0 })
})
