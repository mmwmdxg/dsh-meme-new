# AGENTS.md — dsh-meme 硬约定

面向在 DSH 里对 dsh-meme 干活的 agent。只放**必须提前在场**的约定和坑;人类视角见 README.md。

> **维护手册不在仓库里**。`.dsh/skills/dsh-meme-maintenance/SKILL.md`(整理图库/查重/批量改时先读它)被 `.gitignore` 的 `.dsh/` 规则排除,只随 npm 包分发(`package.json` 的 `files` 里列了 `.dsh/skills/`)。从 git 检出仓库时看不到它,别当成文件丢了;要看手册请装 `dsh-meme` 后读安装目录,或直接按本文件与 README 操作。

## 1. 发图说明以工具结果末尾为准

「发送方式」(自动/纯文字/图片)× 渠道(Web / dsh-im 的 QQ、微信 / companion QQ)的组合每次都可能不同,`send_meme` 每次执行都会在结果末尾给「发图」说明——**以那段说明为准,不要凭记忆**。候选 JSON 里的 `path`/`library` 只是出处信息(用户问「这图哪来的」可以引用),Web 聊天发图仍然只写 `[表情: 描述]`,不要把路径贴进回复。

## 2. path 前缀约定

候选/清单里的 path:**当前激活库不带前缀,其它库带 `packId/` 前缀**。原样传给 `meme_update`、两步模式的 `send`、`dsh_im_return_file`(IM 模式给的是绝对路径)都能对上。

## 3. GIF 的坑(宿主行为,无法还原)

聊天附件通道会把 GIF **压成单帧**再给工具。`learn_meme` 结果若提示「已被压成单帧」,告知用户保真路径:管理面板上传,或把 GIF 文件放进图库目录后面板点「扫描新增」。

## 4. 收藏落点

上传/AI 学图统一落「我的收藏」稳定图库(`~/.dsh/meme-packs/dsh-meme-user`,自动启用)。当前图库在内置包(插件目录)内时写入会被自动重定向——插件升级不清空收藏;内置图库只读。

## 5. 工具速查

| 工具 | 一句话 |
| --- | --- |
| `send_meme` | 抽候选 + 发图(说明看结果末尾) |
| `learn_meme` | 收录新图(附件/URL);GIF 附件会被压平,见上 |
| `meme_list` | 只读清单,跨启用图库,可筛;支持 `duplicates`(按内容哈希找重复)、`sort=hits\|recent`、`unused` |
| `meme_update` | 改 tag/caption/keywords,只改索引 |
| 删除 | 只在管理面板,agent 不删 |

## 6. 性能约定(别把这些改回去)

- **索引快照缓存**:`cachedStore(root)` 在内存里缓存行数组 + 路径白名单,按 `index.db` 的 size+mtime 失效。图片路由每个请求都要判白名单,2 万行图库实测 23.5ms/请求 → 0.7ms。`MemesStore` 读完就关连接(#43),所以缓存**不占图库文件**,不影响 pnpm 改名更新。
- **写完要显式失效**:上传 / 学图 / 编辑 / 删除 / 扫描 / 导入 / 切换或删除图库,写完调 `dropStoreCache(...)`,改到张数或封面时再加 `invalidatePacks()`。只靠 mtime 不够稳——同毫秒连写、目录被删都判不出来。
- **图库清单缓存**:`listAllPacks()` 有 1s TTL;`readPackMeta` 每个包都要 COUNT + 取封面,而图片路由解析包前缀时每个请求都会走它。
- **封面查询别写表达式排序**:`ORDER BY (tag = 'happy') DESC, path` 用不上索引,2 万行是一次全表排序。现在是 `WHERE tag='happy' ORDER BY path LIMIT 1` 加一条兜底,配 `(tag, path)` 索引。
- **FTS5 不要加**(实测过):中文子串检索只能靠 unigram+bigram 的 OR 候选,2 万行时候选集占 40%~60%,耗时 6.7~9.7ms,与全表扫描的 6.6~7.6ms 打平甚至更慢。要真提速就得改检索语义(AND 精确匹配),那是产品决定,不是性能优化。

## 7. 去重与使用热度

- **同库拦、跨库提示**:同一图库内重复收录同一份字节(sha256 相同)会被拒绝并指出已有那张;别的库有同款只提示不拦——同图进两个库是合理用法。
- **老图补哈希**:升级前入库的图没有 sha256,去重和 `meme_list duplicates` 都看不到它们。在图库页点一次「扫描新增」就会顺手补算(结果里会报 `hashed` 张数)。
- **热度只在真发图时记**:`send_meme` 递出候选即 `hits+1`;发送方式为「纯文字」时不计(那是查候选拿描述,没发图)。

## 8. 索引与文案:clone 下来要能跑

`memes/*/index.db` 是 `.gitignore` 里的运行时产物,**仓库里没有**。而插件的 `MemesStore` 在缺 `index.db` 时是「不可用」,`apply()` 会提前返回——路由和工具一条都注册不上,`npm test` 大面积假红。所以:

- `npm run build:index`(= `scripts/build-pack-index.mjs`)负责补:**只补缺的行**,已存在行走 `INSERT OR IGNORE`,`--force` 才重算 mtime/sha256。`pretest` 会先跑它,干净 clone 直接 `npm test` 就行。
- **caption / keywords 不在 index.db 之外就没有了**:那是 AI 学图的产出,index.db 又不入库。想让 clone 出来还搜得到,必须给图库写一份 `memes/<pack>/captions.json`(`{ "<rel>": { caption, keywords } }`),脚本会读它并填进空行;**已有非空文案的行不会被覆盖**。
- 新增内置图库时,顺手写 captions.json——不然新用户装 npm 包能搜、从 git 检出搜不到,同一个库两种表现。

## 9. SSRF 守卫的 DNS 可注入

`assertPublicImageUrl` 会真解析域名。测试里别指望它:`import { setDnsLookup } from '../index.js'` 后调 `setDnsLookup(async () => [{ address: '93.184.216.34', family: 4 }])`,把答案钉成公网。否则「本机 DNS 把 example.com 解析到保留地址」会让用例假红——守卫本身没错,是测试不该依赖网络。

## 10. 目录签名(ed25519):目录被镜像篡改也认得出来

**为什么需要**:目录从 GitHub raw 加一票镜像拉,每条 entry 的 ZIP 有 sha256,但那个 sha256 也来自目录 —— 镜像同时换掉目录和包就自洽了。

**形态**:目录旁边一个同名 `.sig`(base64 的 64 字节签名),签名覆盖**目录文件原始字节**;插件用内置/配置的公钥验签。公钥不绑域名 —— 镜像换多少域名都认同一把钥匙。

```bash
node scripts/sign-catalog.mjs keygen ~/.dsh/dsh-meme-catalog.key   # 只跑一次，私钥留本机
node scripts/sign-catalog.mjs sign   docs/remote-packs.json ~/.dsh/dsh-meme-catalog.key
node scripts/sign-catalog.mjs verify docs/remote-packs.json <公钥base64>
```

- 插件侧开关:`catalogPubkey`(插件 config)或 `DSH_MEME_CATALOG_PUBKEY`(环境变量,先试后写配置)。没配就不验,行为和以前一致。
- 配了就**强制**:拿不到 `.sig`、验不过、签名是旧的,一律按「这个镜像不可用」处理并换下一个候选;全挂走磁盘缓存。**绝不回退到未签名内容** —— 那等于没签。
- 目录改一次就要重签一次(`sign` 覆盖同名 `.sig`)。
- 换钥匙 = 已装旧版客户端从此验不过。**私钥要备份,公钥换了要发版。**

判据:`verify` 通过;把目录尾部加一个空格再验 → 必须失败(2026-10-28 实测:通过→失败→还原后又通过)。

## 11. 发布一个包

造包 → 填目录 → 签名 → 发 release → 四道验证，完整流程见 `docs/PUBLISHING.md`（含这台机器上 git/gh 的坑）。只改文案走该文第五节，不用重新打包。
