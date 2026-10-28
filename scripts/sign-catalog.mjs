// dsh-meme: 图库目录的签名工具（ed25519, detached）
//
// 为什么：图库目录（docs/remote-packs.json、别人仓库里的 catalog.json）从 GitHub raw
// 加一票镜像拉，每条 entry 的 ZIP 有 sha256，但那个 sha256 也来自目录 —— 镜像同时换掉
// 目录和包就自洽了。签名把「目录字节」钉在只在你手里的私钥上：镜像可以拒服务、可以给
// 旧文件，但改不动内容。插件侧用 `verifyCatalogSignature` 验（内置/配置公钥）。
//
// 三种用法：
//   node scripts/sign-catalog.mjs keygen [私钥路径]
//   node scripts/sign-catalog.mjs sign   <目录.json> <私钥路径>
//   node scripts/sign-catalog.mjs verify <目录.json> <公钥 base64 或 PEM>
//
// 私钥别进仓库：默认写到 ~/.dsh/dsh-meme-catalog.key 并 chmod 600。丢了只能换钥匙
// —— 那意味着已经装了旧版本的客户端会验不过，所以密钥要备份。

import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'

const [cmd, ...args] = process.argv.slice(2)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 公钥统一用 base64 DER(SPKI) —— 一行,塞进 config 里最省事 */
const publicKeyB64 = (key) => key.export({ type: 'spki', format: 'der' }).toString('base64')

function keygen() {
  const out = args[0] || join(homedir(), '.dsh', 'dsh-meme-catalog.key')
  if (existsSync(out)) {
    console.error('私钥已存在，拒绝覆盖: ' + out)
    console.error('要换钥匙请先手动移走旧文件（换了钥匙，老客户端会验不过）。')
    process.exit(1)
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8')
  try { chmodSync(out, 0o600) } catch { /* Windows 上权限位意义有限 */ }
  console.log('私钥已写入: ' + out)
  console.log('')
  console.log('把下面这一行填进插件 config（只填值，不要带引号里的换行）:')
  console.log('')
  console.log('  catalogPubkey: ' + publicKeyB64(publicKey))
  console.log('')
  console.log('或者临时试：set DSH_MEME_CATALOG_PUBKEY=' + publicKeyB64(publicKey))
}

function signCatalog() {
  const [file, keyPath] = args
  if (!file || !keyPath) {
    console.error('用法: node scripts/sign-catalog.mjs sign <目录.json> <私钥路径>')
    process.exit(1)
  }
  const body = readFileSync(file)
  const key = createPrivateKey(readFileSync(keyPath, 'utf8'))
  const sig = sign(null, body, key).toString('base64')
  const out = file + '.sig'
  writeFileSync(out, sig + '\n', 'utf8')
  console.log('已签名: ' + file)
  console.log('  字节 sha256: ' + sha256(body))
  console.log('  签名写入:   ' + out + '（' + sig.length + ' 字符 base64）')
  console.log('  对应公钥:   ' + publicKeyB64(createPublicKey(key)))
  console.log('')
  console.log('★ 把 .sig 和目录一起提交上去；目录再改一次就要重签一次。')
}

function verifyCatalog() {
  const [file, pub] = args
  if (!file || !pub) {
    console.error('用法: node scripts/sign-catalog.mjs verify <目录.json> <公钥 base64 或 PEM>')
    process.exit(1)
  }
  const body = readFileSync(file)
  const sigPath = file + '.sig'
  if (!existsSync(sigPath)) {
    console.error('没有签名文件: ' + sigPath)
    process.exit(1)
  }
  // 公钥两种写法都收：PEM 直接给 createPublicKey，base64 的当作 DER(SPKI) 解
  // ★ 不能把 base64 解成 utf8 再当 PEM —— DER 是二进制，那样必然 unsupported
  const raw = String(pub).trim()
  const key = raw.includes('BEGIN PUBLIC KEY')
    ? createPublicKey(raw)
    : createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' })
  const ok = verify(null, body, key, Buffer.from(readFileSync(sigPath, 'utf8').trim(), 'base64'))
  console.log((ok ? '✔ 验签通过' : '✖ 验签失败') + '：' + file + ' sha256=' + sha256(body).slice(0, 16))
  process.exit(ok ? 0 : 1)
}

if (cmd === 'keygen') keygen()
else if (cmd === 'sign') signCatalog()
else if (cmd === 'verify') verifyCatalog()
else {
  console.log('用法:')
  console.log('  node scripts/sign-catalog.mjs keygen [私钥路径]')
  console.log('  node scripts/sign-catalog.mjs sign   <目录.json> <私钥路径>')
  console.log('  node scripts/sign-catalog.mjs verify <目录.json> <公钥 base64 或 PEM>')
  process.exit(cmd ? 1 : 0)
}
