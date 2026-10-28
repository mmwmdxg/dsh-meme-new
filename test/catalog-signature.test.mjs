import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { loadCatalogPublicKey, verifyCatalogSignature } from '../index.js'

/**
 * 目录签名的契约：签名覆盖**原始字节**，改一个空格就失败；公钥认钥匙不认域名。
 * 这里用内存里生成的 ed25519 钥匙，不碰网络也不读文件。
 */

const BODY = Buffer.from('{"packs":[{"id":"dafeiyu-001","archiveUrl":"https://example.com/a.zip","sha256":"' + 'a'.repeat(64) + '"}]}', 'utf8')

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey,
    b64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    pem: publicKey.export({ type: 'spki', format: 'pem' }),
    sig: (buf) => sign(null, buf, privateKey).toString('base64'),
  }
}

test('loadCatalogPublicKey: base64 DER 与 PEM 都能吃，空/垃圾输入返回 null', () => {
  const k = keypair()
  assert.ok(loadCatalogPublicKey(k.b64), 'base64 DER 应可解析')
  assert.ok(loadCatalogPublicKey(k.pem), 'PEM 应可解析')
  assert.equal(loadCatalogPublicKey(''), null)
  assert.equal(loadCatalogPublicKey(null), null)
  assert.equal(loadCatalogPublicKey('不是钥匙'), null)
})

test('verifyCatalogSignature: 原样字节 + 正确签名 → 通过', () => {
  const k = keypair()
  assert.equal(verifyCatalogSignature(BODY, k.sig(BODY), loadCatalogPublicKey(k.b64)), true)
})

test('verifyCatalogSignature: 改一个字节就失败（签名覆盖的是内容而不是结构）', () => {
  const k = keypair()
  const sig = k.sig(BODY)
  const tampered = Buffer.from(BODY.toString('utf8').replace('dafeiyu-001', 'dafeiyu-002'), 'utf8')
  assert.equal(verifyCatalogSignature(tampered, sig, loadCatalogPublicKey(k.b64)), false)
})

test('verifyCatalogSignature: 换一把钥匙就失败（镜像换域名无所谓，换钥匙不行）', () => {
  const a = keypair()
  const b = keypair()
  assert.equal(verifyCatalogSignature(BODY, a.sig(BODY), loadCatalogPublicKey(b.b64)), false)
})

test('verifyCatalogSignature: 缺签名 / 没配公钥 / 空签名一律不通过', () => {
  const k = keypair()
  assert.equal(verifyCatalogSignature(BODY, '', loadCatalogPublicKey(k.b64)), false)
  assert.equal(verifyCatalogSignature(BODY, k.sig(BODY), null), false)
  assert.equal(verifyCatalogSignature(Buffer.alloc(0), k.sig(BODY), loadCatalogPublicKey(k.b64)), false)
  assert.equal(verifyCatalogSignature(BODY, 'not-base64!!', loadCatalogPublicKey(k.b64)), false)
})
