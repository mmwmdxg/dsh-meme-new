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
