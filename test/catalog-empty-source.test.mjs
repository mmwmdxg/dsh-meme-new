import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * 回归:内置目录源里有两条指向 docs/remote-packs.json,那个文件内容是 []。
 * 旧实现把「拉到空数组」当成功,于是:
 *   1) 发现页显示「0 个图库」而不是「源不可用 / 使用本地缓存」;
 *   2) fetchRemoteDirectory 走成功分支,把空数组写进 dsh-meme-catalog-cache.json,
 *      而 readCatalogCache 会因为 entries.length === 0 拒读 —— 上一次可用的离线目录
 *      被换成一份永远不会被使用的废文件,下次断网等于没有缓存。
 * 现在空列表按失败处理:竞速继续试下一个源,且空目录不落盘。
 */

const mod = await import('../index.js')
const { validDirectoryEntries, catalogCachePayload } = mod

test('空数组 / { packs: [] } 按失败处理,不再当作「市场里没有包」', () => {
  assert.throws(() => validDirectoryEntries([]), /目录为空/)
  assert.throws(() => validDirectoryEntries({ packs: [] }), /目录为空/)
})

test('合法目录照旧解析:裸数组与 { packs } 两种形状都支持', () => {
  const entries = validDirectoryEntries([{ manifestUrl: 'https://example.com/m.json' }])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].manifestUrl, 'https://example.com/m.json')

  const wrapped = validDirectoryEntries({ packs: [{ archiveUrl: 'https://example.com/a.zip' }] })
  assert.equal(wrapped.length, 1)
  assert.equal(wrapped[0].archiveUrl, 'https://example.com/a.zip')
})

test('既没有 manifestUrl 也没有 archiveUrl 的脏条目被过滤;全脏同样算空', () => {
  assert.equal(validDirectoryEntries([{ manifestUrl: 'https://e.com/m.json' }, { name: '脏条目' }]).length, 1)
  assert.throws(() => validDirectoryEntries([{ name: '只有名字' }]), /目录为空/)
})

test('非数组目录仍然报格式错误,不冒充空目录', () => {
  assert.throws(() => validDirectoryEntries({}), /目录不是数组/)
  assert.throws(() => validDirectoryEntries('[]'), /目录不是数组/)
  assert.throws(() => validDirectoryEntries(null), /目录不是数组/)
})

test('catalogCachePayload:空目录返回 null,非空才给落盘内容', () => {
  assert.equal(catalogCachePayload('https://m/catalog.json', [], 'https://o/catalog.json'), null)
  assert.equal(catalogCachePayload('https://m/catalog.json', null, 'https://o/catalog.json'), null)
  const payload = catalogCachePayload('https://m/catalog.json', [{ manifestUrl: 'https://e/m.json' }], 'https://o/catalog.json')
  assert.ok(payload && Array.isArray(payload.entries) && payload.entries.length === 1)
  assert.equal(payload.url, 'https://m/catalog.json')
  assert.equal(payload.sourceUrl, 'https://o/catalog.json')
  assert.equal(typeof payload.at, 'number')
})
