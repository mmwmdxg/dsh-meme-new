/**
 * 给测试生成 @deepseek-ai/dsh-tools 的本地存根。
 *
 * 这个包是 dsh-meme 的 peerDependency,由 DeepSeek Harness 宿主提供,不在公共 npm 源上,
 * 所以从仓库直接 `npm test` 时 index.js / memes.js 的
 * `import { defineTool } from '@deepseek-ai/dsh-tools'` 会 ERR_MODULE_NOT_FOUND,
 * 测试还没跑就先失败。
 *
 * 插件只用到 defineTool 一个导出(它给工具定义补宿主需要的元信息,测试里原样返回即可),
 * 所以放一个最小存根,让测试能在没有宿主的环境里跑。真包已存在时什么都不做,
 * 免得盖掉宿主或 CI 装好的版本。
 *
 * 本文件不随 npm 包发布(package.json 的 files 里没有 scripts/)。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'node_modules', '@deepseek-ai', 'dsh-tools')
const marker = join(dir, 'package.json')

if (existsSync(marker)) {
  console.log('[test] @deepseek-ai/dsh-tools 已存在,跳过存根生成')
  process.exit(0)
}

mkdirSync(dir, { recursive: true })
writeFileSync(marker, JSON.stringify({
  name: '@deepseek-ai/dsh-tools',
  version: '0.0.0-local-stub',
  private: true,
  type: 'module',
  main: 'index.js',
  exports: { '.': './index.js' },
}, null, 2) + '\n')
writeFileSync(join(dir, 'index.js'), [
  '// 测试用最小存根:插件只用到 defineTool。',
  '// 真宿主里它还会补工具元信息;测试只关心 execute 的行为,原样返回足够。',
  'export function defineTool(spec) { return spec }',
  'export default { defineTool }',
  '',
].join('\n'))
console.log('[test] 已生成 @deepseek-ai/dsh-tools 存根: ' + dir)
