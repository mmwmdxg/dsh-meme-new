import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * learn_meme 的 imageUrl 由模型/用户给,是不可信输入。旧实现直接
 * `fetch(imageUrl, { redirect: 'follow' })`,靠「响应必须 image/* + 魔数 + 8MB」兜底:
 * 拿不到内网响应体,但「下载失败: HTTP 403」与「该 URL 不是图片」的文案差异足以当
 * oracle 探内网端口;而且 follow 会让任何一次校验被 302 到 127.0.0.1 绕过。
 *
 * 现在发请求前先过 assertPublicImageUrl,跳转每跳各校验一次。这里只测纯判断,不发言网络请求。
 */

const mod = await import('../index.js')
const { isPrivateIPv4, isPrivateIPv6, assertPublicImageUrl } = mod

test('isPrivateIPv4:私网 / 回环 / 链路本地 / 保留段全部拦下', () => {
  for (const ip of [
    '127.0.0.1', '127.10.20.30', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  ]) {
    assert.equal(isPrivateIPv4(ip), true, ip + ' 应被判为不可用')
  }
})

test('isPrivateIPv4:公网地址放行,畸形输入当不可用', () => {
  for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1']) {
    assert.equal(isPrivateIPv4(ip), false, ip + ' 应放行')
  }
  for (const bad of ['', 'abc', '1.2.3', '1.2.3.4.5', '999.1.1.1', '-1.2.3.4', null]) {
    assert.equal(isPrivateIPv4(bad), true, String(bad) + ' 畸形输入应拒绝')
  }
})

test('isPrivateIPv6:回环 / 链路本地 / 唯一本地 / v4 映射都拦下', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIPv6(ip), true, ip + ' 应被判为不可用')
  }
  assert.equal(isPrivateIPv6('2606:4700:4700::1111'), false, '公网 v6 应放行')
})

test('assertPublicImageUrl:本机与内网目标在发请求前就拒绝', async () => {
  const blocked = [
    'http://127.0.0.1:8080/a.gif',
    'http://localhost/a.gif',
    'http://app.localhost/a.gif',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/x.png',
    'http://192.168.1.10/x.png',
    'http://[::1]/a.gif',
    'http://[::ffff:127.0.0.1]/a.gif',
  ]
  for (const url of blocked) {
    await assert.rejects(() => assertPublicImageUrl(url), /拒绝/, url + ' 应被拒绝')
  }
})

test('assertPublicImageUrl:非 http(s) 与畸形地址拒绝', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/a.gif', 'data:image/png;base64,AAAA', 'not a url', '']) {
    await assert.rejects(() => assertPublicImageUrl(url), /(只支持 http\(s\)|不是合法 URL|缺少主机名)/, String(url) + ' 应被拒绝')
  }
})

test('assertPublicImageUrl:公网字面 IP 放行,不触发解析', async () => {
  await assert.doesNotReject(() => assertPublicImageUrl('https://93.184.216.34/pic.gif'))
})
