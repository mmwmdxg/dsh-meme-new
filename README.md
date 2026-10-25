<p align="center">
  <img src="./docs/hero-banner-v4.jpg" alt="dsh-meme — 找得到、发得出、学得会" width="100%" />
</p>

<p align="center"><strong>给 DeepSeek Harness 加上表情包：自己点图发，也能让 AI 接着斗图。</strong></p>

<p align="center"><sub>本仓库是个人维护分支
<a href="https://github.com/mmwmdxg/dsh-meme-new">mmwmdxg/dsh-meme-new</a>，基于上游
<a href="https://github.com/yyh-001/dsh-meme">yyh-001/dsh-meme</a> 修改，版本号独立为
<strong>0.1.1</strong>。图库市场仍指向上游 <code>dsh-meme-packs</code>。</sub></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.1-blue?style=flat-square" alt="0.1.1" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.13-blue?style=flat-square" alt="Node ≥ 22.13" />
  <img src="https://img.shields.io/badge/tests-305%20passing-brightgreen?style=flat-square" alt="305 tests" />
</p>

<p align="center">
  <strong>中文</strong> · <a href="./README.en.md">English</a><br />
  <a href="https://github.com/yyh-001/dsh-meme-packs">图库市场</a> ·
  <a href="https://github.com/mmwmdxg/dsh-meme-new/issues/new/choose">反馈问题</a>
</p>

## 这一版和上游有什么不同

本分支在上游基础上做了修复与增强，**版本号独立**（上游用 0.1.x 三位序列，本分支从 0.1.1 起）。

| 类别 | 内容 |
| --- | --- |
| 安全修复 | `learn_meme` 的 URL 分支增加地址策略：回环、私网、链路本地地址一律拒绝（防 SSRF）；校验抽成可单测的纯函数 |
| 导入兼容 | ZIP 支持 `store`(method 0) 与 `deflate`(method 8) 两种条目；补 sizes / CRC32 校验，坏包不会被静默装入 |
| 图片路由 | 支持 `ETag` / `304` 与 `Range` 请求，同一张表情在一轮对话里重复出现时省掉整图传输 |
| 去重与热度 | 入库按 sha256 去重（**只拦同库**，跨库同款只提示）；`send_meme` 真发图时累计使用次数，清单可按热度排序、可筛「从未使用」 |
| 性能 | 索引快照缓存 + 写点显式失效，2 万行图库下图片路由 **23.5ms → 0.72ms（33×）**；FTS5 经实测后**不采用**（见下） |
| 面板 | 排序下拉、只看未使用、查重按钮、卡片显示使用次数与重复角标 |
| 提示词 | 主动斗图提示词重写为可执行版本（何时发 / 何时不发 / 一次几张 / 描述怎么抄） |

**为什么不加 FTS5**：中文子串检索只能靠 unigram+bigram 的 OR 候选，2 万行时候选集占 40%~60%，耗时 6.7~9.7ms，与全表扫描的 6.6~7.6ms 打平甚至更慢。要真提速得改检索语义（AND 精确匹配），那是产品决定而非性能优化。实测数据与结论写在 [AGENTS.md](./AGENTS.md) 的性能约定里，防止后来者误加。

## 能做什么

- **一键发图**：输入框旁点 😊，搜索、按图库或情绪筛选，点一张就发送。
- **跟 AI 斗图**：按情绪或关键词找图；Web 聊天里模型输出文字标记、前端显示图片，发图无需模型支持图片输入；QQ/微信等 IM 聊天里自动改走 dsh-im 原生图片发送。
- **学会新图**：上传图片后说「把这张图入库」，AI 自动识别分类和描述；也可以把图片文件直接拷进图库目录，点「扫描新增」一键入库（动图 GIF 建议走这条，原始动画保留）。
- **管理与分享**：多图库开关、上传与编辑、ZIP 导入导出、市场安装与更新。
- **不重复、不积灰**：内容哈希去重 + 使用次数统计 + 热度排序 + 「从未使用」筛选。
- **收藏不丢**：上传和 AI 学图统一存到 `~/.dsh/meme-packs` 下的「我的收藏」图库（自动启用）——内置图库随插件升级会被整个替换，收藏放在包外，更新插件不再清空。
- **开箱即用**：内置大肥鱼图库（24 张），零第三方运行依赖，使用 Node 内置 SQLite。

## 安装

> **注意**：npm 与插件市场里的 `dsh-meme` 是**上游版本**，不是本仓库。要用本分支，请从本仓库装。

```bash
# 1) 取得代码（github.com:443 不通的环境请走 SSH，见下方「网络」）
git clone git@github.com:mmwmdxg/dsh-meme-new.git

# 2) 装进 profile（本地目录方式最稳，不经过 npm registry）
cd ~/.dsh/profiles/desktop
pnpm add file:/绝对路径/dsh-meme-new

# 3) 确认 profile 的 package.json 里 dsh.profile.bundles 含 "dsh-meme"
```

装好后重启 DSH，在 **设置 → 表情包** 确认已启用。

需要 **Node.js ≥ 22.13.0**（用到内置 `node:sqlite`）。旧包名 `dsh-expression` 已弃用，内部插件 ID 保留兼容。

### 网络：GitHub 直连不通时

`github.com:443` 在某些网络下会被重置，而 `ssh.github.com:443` 可用。配套做法：

```ini
# ~/.ssh/config
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

```bash
git config --global core.sshCommand "<PortableGit>/usr/bin/ssh.exe -F ~/.ssh/config"
```

## 开始使用

| 想做什么 | 怎么操作 |
| --- | --- |
| 自己发表情 | 点输入框旁的 😊，选图发送；支持搜索、多选筛选和悬停预览 |
| 让 AI 发图 | 说「发个开心的表情」或「找一张猫猫比心」 |
| 收藏一张新图 | 上传图片，再说「把这张图入库」；自动识图需要支持图片输入的模型 |
| 收藏动图 | 从管理面板上传 GIF，或把 GIF 拷进图库目录点「扫描新增」——原始动画保留。注意：把 GIF 直接发到聊天里让 AI 学图会被聊天端压成单帧（宿主附件服务的行为），动图别走这条路 |
| 查重 / 清理 | 面板点「查重」按内容哈希找重复；「从未使用」筛出冷门图 |
| 查看大图 | 点击聊天里的表情；滚轮缩放，双击复位，Esc 或点背景关闭 |

<p align="center">
  <img src="./docs/chat-example.png" alt="斗图示例：吃白饭的大肥鱼，用户发一张，AI 接着回一张" width="80%" />
</p>

![输入框表情选择器：搜索、图库与情绪筛选](./docs/quick-picker.png)

## 图库管理

打开 **设置 → 表情包**：

- **图库**：点卡片管理图片；卡片开关决定 AI 能否使用该图库，可同时启用多个。支持新建、导入、导出、投稿和删除，有新版时显示「更新」。
- **发现**：预览市场图库，一键安装；Release ZIP 安装时校验 SHA-256。
- **设置**：修改扫描目录，开启或关闭 AI 主动发表情，编辑提示词，选择 AI 的发送方式（自动 / 纯文字 / 图片）。

![图库管理：已安装图库与独立开关](./docs/panel-library.png)

默认扫描 `~/.dsh/meme-packs`，设置保存在 `~/.dsh/dsh-expression.json`，升级插件会保留。更多图库可在「发现」安装，也可导入别人分享的 ZIP。

「发送方式」只控制 AI 怎么发图，不影响前端把 `[表情: 描述]` 配成图片：**自动**（默认）按渠道来，Web 聊天写标记、IM 聊天发原生图片；**纯文字**只让 AI 用文字接梗，不发图片；**图片**要求 AI 每次挑好图都真的发出去。保存后下一条消息生效。

## 工具

| 工具 | 用法 |
| --- | --- |
| `send_meme` | `tag` 按情绪随机抽图；`query` 按描述/关键词/文件名搜索；两者可组合。不传 `tag` 时按 `query` 推断情绪。`limit` 默认 8（建议 5~8） |
| `meme_list` | 只读清单，跨启用图库。支持 `duplicates`（按内容哈希找重复）、`sort=hits\|recent`、`unused`（只看从未发过的图）、按 `q`/`tag`/`packId` 筛选 |
| `meme_update` | 改单张图的 `tag` / `caption` / `keywords`，只改索引不动文件 |
| `learn_meme` | 收录新图；默认收录最近一张用户图片，也可指定 `attachmentId` 或 `imageUrl` |

```text
send_meme tag=happy
send_meme query="猫 比心"
meme_list sort=hits
meme_list unused=true
learn_meme
```

情绪桶：`happy` / `angry` / `sad` / `shy` / `confused` / `daily`。模型应把候选中的 `[表情: 描述]` 原样写进回复；前端只在聊天内容中配图。没有合适的候选时，换关键词或用文字回复。**删除图只在管理面板进行，不提供 agent 工具。**

**动图读取**：`learn_meme` 和上传弹窗的 AI 识图支持 GIF——先把动图按时间轴均匀采样成几帧、拼成一张带帧序说明的胶片条再送模型，所以 caption 能描述「猫疯狂摇头」这类动作，而不是只看见第一帧。原图照旧入库，聊天里仍然会动。WebP / APNG 目前只能读帧数、时长等元数据（仍按第一帧识别），提示词里会注明它是动图。解码是纯 JS 实现，不引入第三方依赖。

通过 [dsh-im](https://github.com/xmanrui/dsh-im) 接入 QQ / 微信 / 飞书 / 企业微信等 IM 时，表情包会以该聊天的原生图片消息发出：插件按会话来源识别 IM 渠道后，`send_meme` 的候选会额外带**绝对路径**，模型随后调用 dsh-im 的 `dsh_im_return_file` 把图交给渠道；IM 聊天不渲染 `[表情: 描述]`，所以不会再写标记。这条投递规则随主动斗图提示词一起自动注入——**不需要先跟模型说明「可以在 QQ/微信里发表情包」**。Web 聊天保持原来的 `[表情: 描述]` 配图方式，两种会话可以同时存在。

## 性能约定（别改回去）

这些是实测结论，改回原样会明显变慢：

- **索引快照缓存**：`cachedStore(root)` 在内存缓存行数组 + 路径白名单，按 `index.db` 的 size+mtime 失效。图片路由每请求都要判白名单，2 万行图库实测 23.5ms → 0.72ms。
- **写完要显式失效**：上传 / 学图 / 编辑 / 删除 / 扫描 / 导入 / 切换或删除图库，写完调 `dropStoreCache(...)`；改到张数或封面时再加 `invalidatePacks()`。只靠 mtime 不够稳——同毫秒连写、目录被删都判不出来。
- **封面查询别写表达式排序**：`ORDER BY (tag = 'happy') DESC, path` 用不上索引；现在是 `WHERE tag='happy' ORDER BY path LIMIT 1` 加兜底，配 `(tag, path)` 索引。
- **FTS5 不要加**：见上文实测数据。

开发与测试：

```bash
npm test          # pretest 自动生成 peer 依赖存根，从干净状态也能跑
```

## 更新失败 / 更新后消失？

宿主更新插件的方式是用 pnpm 把 `node_modules/dsh-meme` 整个目录改名替换。**Windows 上只要目录里还有打开的文件，rename 就会 `EPERM`**，pnpm 只能报 `exit 1`；市场界面常常只留一行截断的错误，看起来像「没报错但失败了」。

上游在 0.1.59 修掉了插件自身占用包内文件的问题（历史上是内置图库的 `index.db` 被长期打开），本分支已包含该修复：图库索引只在启动时读一次进内存，写入时临时打开、写完立即关闭。

仍然失败时按序处理：

1. **完全退出 DSH**（托盘退出，任务管理器确认没有 dsh / Electron 进程），重开后再更新。
2. 插件已从列表消失：退出 DSH 后手动重装（见「安装」）。
3. 图库与设置都存在 `~/.dsh`，更新或重装不会丢。

## 分享自己的图库

1. 在「图库」新建图包库，添加图片。
2. 点 **导出** 得到 ZIP，朋友用 **导入图库** 即可安装。
3. 想收录到市场，点 **投稿**：插件导出 ZIP 并打开预填的 GitHub 表单；登录后附上 ZIP、图片来源与许可，再提交审核。

请使用插件导出的 ZIP。GitHub 的「Download ZIP」是仓库源码压缩包，不能替代图库分享包。

## 国内网络 / 图库市场拉不到？

图库目录和预览图托管在 GitHub 上，国内直连 `raw.githubusercontent.com` / `cdn.jsdelivr.net` 经常超时，发现页于是显示「图库目录暂不可用(检查网络或稍后重试)」。插件默认走多镜像：

- **自动竞速**：目录、清单 JSON、安装 ZIP 和逐图下载都会尝试原始地址与 `ghfast.top`、`gh-proxy.com`、`ghproxy.net`、`cdn.jsdmirror.com`、`fastly.jsdelivr.net` 等镜像，取最先成功的；封面和预览图逐个候选回退，并记住能用的镜像。
- **磁盘缓存**：成功拉到的目录存到 `~/.dsh/dsh-meme-catalog-cache.json`，网络暂时不通时先用它显示。
- **安装仍校验 SHA-256**：镜像只换下载通道，哈希对不上会换下一个，不会装进坏包。

拉不到时：① 点发现页 **重试**；② 在 **设置 →「图库目录源」** 选 **镜像源**（最稳）或填自定义 `catalog.json` 地址；③ 也可直接改 `~/.dsh/dsh-expression.json` 的 `remoteDirUrl`（`auto` / `official` / `mirror` / 自定义 URL），即时生效。

## 安全边界

- HTTP 接口仅接受本机回环地址（`localhost` / `127.0.0.1` / `[::1]`），局域网地址与自定义域名一律拒绝。
- `learn_meme` 的 URL 抓取拒绝回环、私网、链路本地地址，避免被当成 SSRF 跳板。
- 图库 ZIP 导入校验条目大小与 CRC32。

## 许可

代码采用 [MIT](./LICENSE)。**许可范围只覆盖代码**：内置图库 `memes/dafeiyu-001` 的 `manifest.json` 标的是 `license: personal`，随包分发但不受 MIT 约束，仅限个人使用。仓库公开前请确认该图库的再分发范围；其它图库图片的来源与许可请分别查看各图库说明。

---

自建图库目录或市场源见 [远程图库规范](./docs/remote-pack-spec.md)。面向 agent 的硬约定与坑见 [AGENTS.md](./AGENTS.md)。
