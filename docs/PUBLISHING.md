# 发布一个图库包（从零到别人能装上）

面向维护者。一条完整流程 + 沿途踩过的坑。**只加新图库或换图时才需要看这篇；只改文案走最后一节。**

前置：仓库是 **public**（私有库里 raw 和 release 附件匿名取不到，插件取不到就等于没发）。

---

## 一、造包

图库目录必须在 `memes/<packId>/` 下，且 `index.db` 是**构建产物**（不入库）：

```bash
node scripts/build-pack-index.mjs          # 补 index.db（只补缺的行）
node scripts/build-pack-index.mjs --force  # 重算 mtime/sha256
```

文案写 `memes/<packId>/captions.json`：

```json
{ "memes/happy/deyi.jpg": { "caption": "得意", "keywords": "骄傲 得意" } }
```

然后打 ZIP。**必须用插件自己的 `zipStore`**，别用系统 zip —— 编码、条目顺序、时间戳都影响哈希：

```bash
node -e "
import('./index.js').then(async (m) => {
  const fs = await import('node:fs'), path = await import('node:path'), c = await import('node:crypto');
  const dir = 'memes/dafeiyu-001', files = [];
  const walk = (d, b) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, b); else files.push({ name: path.relative(b, f).split(path.sep).join('/'), data: fs.readFileSync(f) });
  } };
  walk(dir, dir);
  files.sort((a, b) => a.name.localeCompare(b.name));
  const zip = m.zipStore(files);
  fs.mkdirSync('dist', { recursive: true });
  const out = 'dist/dafeiyu-001-1.3.0.zip';
  fs.writeFileSync(out, zip);
  console.log(out, zip.byteLength, c.createHash('sha256').update(zip).digest('hex'));
})
"
```

包内必须是**根目录直接**含 `index.db`、`manifest.json`、`memes/`。`dist/` 在 `.gitignore` 里，别提交。

> `zipStore` 可复现：同样输入连打两次字节相同。但 `index.db` 重建一次字节就变（SQLite 页布局、mtime），
> 所以**从仓库现状重新打包拿不到旧哈希**。发布之后，`dist/` 里那个 zip 或 release 附件就是唯一真品，别再重建覆盖。

---

## 二、填目录 + 签名

`docs/remote-packs.json`：

```json
{
  "schemaVersion": 1,
  "packs": [{
    "id": "dafeiyu-001",
    "name": "大肥鱼",
    "version": "1.3.0",
    "description": "……",
    "maintainer": "mmwmdxg",
    "count": 24,
    "archiveUrl": "https://github.com/mmwmdxg/dsh-meme-new/releases/download/dafeiyu-001-v1.3.0/dafeiyu-001-1.3.0.zip",
    "sha256": "<上一步打印的哈希>",
    "preview": "https://mmwmdxg.github.io/dsh-meme-new/dafeiyu/deyi.jpg",
    "keywords": ["大肥鱼", "鲸鱼娘"],
    "captionsUrl": "https://raw.githubusercontent.com/mmwmdxg/dsh-meme-new/main/memes/dafeiyu-001/captions.json",
    "captionsSha256": "<captions.json 的 sha256>"
  }]
}
```

- `id` 必须等于包里 `manifest.json` 的 `id`，否则安装时被拒。
- `archiveUrl` 里的 **tag 和文件名**要和你实际发的 release 完全一致。
- 目录改完**必须重签**（签名覆盖原始字节）：

```bash
node scripts/sign-catalog.mjs sign docs/remote-packs.json ~/.dsh/dsh-meme-catalog.key
node scripts/sign-catalog.mjs verify docs/remote-packs.json "<公钥 base64>"
```

一把新钥匙只需生成一次：`node scripts/sign-catalog.mjs keygen ~/.dsh/dsh-meme-catalog.key`
（私钥留本机、务必备份；换钥匙 = 已装旧客户端的验签全失效）。

---

## 三、发 release + 推代码

顺序：**先登记 tag 名，再传包**。tag 名就是 `archiveUrl` 里那段，写错一个字符插件就 404。

网页：

```
https://github.com/mmwmdxg/dsh-meme-new/releases/new
→ Choose a tag: 手打 dafeiyu-001-v1.3.0 → Create new tag on publish
→ Target: main
→ 附件拖 dist/dafeiyu-001-1.3.0.zip
→ Publish
```

命令行（需要 `gh` 且 `git` 在 PATH）：

```powershell
gh release create dafeiyu-001-v1.3.0 dist/dafeiyu-001-1.3.0.zip --repo mmwmdxg/dsh-meme-new --title "大肥鱼 v1.3.0" --notes "24 张"
git push origin HEAD:main
```

---

## 四、四道验证（缺一不可）

```bash
# ① 目录能匿名取到（私有库这里就是 404）
curl -s -o /dev/null -w "%{http_code}\n" https://raw.githubusercontent.com/mmwmdxg/dsh-meme-new/main/docs/remote-packs.json

# ② 签名验得过
node scripts/sign-catalog.mjs verify <下载的目录> "<公钥>"

# ③ 包能下、哈希与目录一致
curl -sL <archiveUrl> | sha256sum   # 与目录 sha256 比对

# ④ 包真能装：解出来看 manifest.id 与目录 id 是否一致
node -e "
import('./index.js').then(async (m) => {
  const fs = await import('node:fs');
  const e = m.unzipStore(fs.readFileSync('<下载的 zip>'));
  console.log(e.size, e.has('index.db'), JSON.parse(String(e.get('manifest.json'))).id);
})
"
```

线上实测（2026-10-28，dafeiyu-001 v1.3.0）：27 条目 / 940,605 字节 / sha256 `b6dd44a1…` / manifest.id 与目录 id 一致。

---

## 五、只改文案：不重新打包

`captionsUrl` 那条链路就是为这个准备的。

```bash
# 1) 改 memes/<packId>/captions.json
# 2) 换目录里的 captionsSha256
node -e "const c=require('crypto'),fs=require('fs');const f='docs/remote-packs.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.packs[0].captionsSha256=c.createHash('sha256').update(fs.readFileSync('memes/dafeiyu-001/captions.json')).digest('hex');fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
# 3) 重签目录
node scripts/sign-catalog.mjs sign docs/remote-packs.json ~/.dsh/dsh-meme-catalog.key
# 4) 推代码，ZIP 和 release 都不用动
git push origin HEAD:main
```

插件装完/更新完会自动拉一次并按行合并（只更新已有行，不新建）。拉不到只丢文案，不影响已装好的图。

---

## 六、这台机器上的环境坑

| 现象 | 真因 / 解法 |
|---|---|
| `git : 无法将"git"项识别为…` | 没装 Git for Windows；只有 DSH 自带的 MSYS git（`…\.dsh\profiles\desktop\node_modules\@dsh-ops\bash-win32-x64\ucrt64\bin\git.exe`）。要么用它全路径，要么 `winget install --id Git.Git -e` 后重开窗口 |
| `gh` 报 `unable to find git executable in PATH` | 同上；`$env:Path += ";<ucrt64 bin>"` 可临时解决 |
| `no matches found for C:\Windows\system32;…` | 把 `$env:Path += "…"` 粘到了上一条命令同一行，PowerShell 把整串当命令名 |
| 匿名 404 但自己能 clone | 仓库是私有；`Settings → Change visibility → Public` |
| `git push` 被拒 `shallow update not allowed` | 浅克隆；先 `git fetch --unshallow` |

## 七、目录换源

插件 config 里 `remoteDirUrl` 可指向任何 http(s) 上的目录 JSON；配了 `catalogPubkey` 就强制验签，
缺 `.sig`、验不过、签名过期都按「该镜像不可用」处理并换下一个候选 —— **绝不回退到未签名内容**。
