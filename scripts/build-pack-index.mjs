// dsh-meme: 重建「内置图库」的 index.db
//
// 为什么需要它：`memes/*/index.db` 被 .gitignore 排除了（运行时产物），
// 于是从 git 检出仓库时，内置图库只剩 manifest.json + 图片目录、没有索引。
// 而插件的 MemesStore 在缺 index.db 时是「不可用」，apply() 会提前返回 ——
// 结果是 fresh clone 上跑 npm test 大面积红（路由/工具一条都没注册上）。
//
// 这个脚本只补**缺**的行：已有 index.db 时用 INSERT OR IGNORE，不会覆盖你
// 在面板里改过的 tag/caption/keywords，也不会清空 hits。
//
// 用法：
//   node scripts/build-pack-index.mjs            # 补缺（默认）
//   node scripts/build-pack-index.mjs --force    # 连已有行一起重算 sha256/mtime
//
// ★ caption/keywords 不在这里生成：那是 AI 学图产出的内容，仓库里没有副本。
//   如果你的图库带 captions.json（{ "<rel>": { caption, keywords } }），本脚本会用上它。
//   想把一份装好的图库导回仓库，用面板的「导出 ZIP」或 meme_list 取数据，
//   然后写成 captions.json —— 这样 clone 下来才复现得出「能搜得到」的图库。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const PACKS = join(ROOT, 'memes')
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
const FORCE = process.argv.includes('--force')

const SCHEMA = `CREATE TABLE IF NOT EXISTS memes (
  path TEXT PRIMARY KEY, tag TEXT, file_name TEXT, caption TEXT, keywords TEXT,
  mtime REAL, captioned_at REAL, sha256 TEXT,
  hits INTEGER DEFAULT 0, last_used REAL
)`

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 递归列出 memes/<tag>/ 下的图片，返回相对图库根目录的路径（统一用 / 分隔） */
function listImages(packDir) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.isFile()) continue
      if (!IMAGE_EXTS.has(extname(entry.name).toLowerCase())) continue
      out.push(relative(packDir, full).split(/[\\/]/).join('/'))
    }
  }
  walk(join(packDir, 'memes'))
  return out.sort()
}

function readCaptions(packDir) {
  const file = join(packDir, 'captions.json')
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch (error) {
    console.log('[build-index] captions.json 解析失败，忽略: ' + (error instanceof Error ? error.message : String(error)))
    return {}
  }
}

function buildPack(packId) {
  const packDir = join(PACKS, packId)
  const imagesDir = join(packDir, 'memes')
  if (!existsSync(imagesDir)) return null

  const db = new DatabaseSync(join(packDir, 'index.db'))
  try {
    db.exec(SCHEMA)
    db.exec('CREATE INDEX IF NOT EXISTS memes_tag_path_idx ON memes(tag, path)')
    const captions = readCaptions(packDir)
    const known = new Set(db.prepare('SELECT path FROM memes').all().map((r) => String(r.path)))
    const insert = db.prepare(
      'INSERT OR IGNORE INTO memes (path, tag, file_name, caption, keywords, mtime, captioned_at, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const update = db.prepare('UPDATE memes SET mtime = ?, sha256 = ? WHERE path = ?')
    const fillCaption = db.prepare("UPDATE memes SET caption = ?, keywords = ? WHERE path = ? AND COALESCE(caption, '') = '' AND COALESCE(keywords, '') = ''")
    const images = listImages(packDir)
    let added = 0
    let hashed = 0
    let filled = 0
    db.exec('BEGIN')
    try {
      for (const rel of images) {
        const tag = rel.split('/')[1] || 'misc'
        const meta = captions[rel] || captions[rel.replace(/^memes\//, '')] || {}
        const full = join(packDir, rel)
        const mtime = statSync(full).mtimeMs
        if (known.has(rel)) {
          if (FORCE) {
            update.run(mtime, sha256(readFileSync(full)), rel)
            hashed++
            continue
          }
          // 老行没有文案、而 captions.json 有 → 补上（只在两个字段都为空时写，绝不覆盖手改过的）
          if ((meta.caption || meta.keywords)) {
            const res = fillCaption.run(String(meta.caption || ''), String(meta.keywords || ''), rel)
            if (res && res.changes) filled++
          }
          continue
        }
        insert.run(
          rel, tag, rel.split('/').pop(), String(meta.caption || ''), String(meta.keywords || ''),
          mtime, null, sha256(readFileSync(full)),
        )
        added++
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { packId, total: images.length, added, hashed, captions: Object.keys(captions).length }
  } finally {
    db.close()
  }
}

if (!existsSync(PACKS)) {
  console.log('[build-index] 没有 memes/ 目录，跳过')
  process.exit(0)
}

const packs = readdirSync(PACKS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

let touched = 0
for (const id of packs) {
  const stat = buildPack(id)
  if (!stat) continue
  touched++
  const bits = [`${stat.total} 张`]
  if (stat.added) bits.push(`新增 ${stat.added} 行`)
  if (stat.hashed) bits.push(`重算 ${stat.hashed} 行`)
  if (stat.captions) bits.push(`captions.json ${stat.captions} 条`)
  if (!stat.added && !stat.hashed) bits.push('已是最新')
  console.log(`[build-index] ${stat.packId}: ${bits.join(', ')}`)
}
if (!touched) console.log('[build-index] 没找到图库目录（memes/<id>/memes/）')
