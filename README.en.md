<p align="center">
  <img src="./docs/hero-banner-v4.jpg" alt="dsh-meme — find, send and learn memes" width="100%" />
</p>

<p align="center"><strong>Memes for DeepSeek Harness: pick an image yourself, or let your AI join in.</strong></p>

<p align="center"><sub>Personal maintenance branch
<a href="https://github.com/mmwmdxg/dsh-meme-new">mmwmdxg/dsh-meme-new</a>, forked from upstream
<a href="https://github.com/yyh-001/dsh-meme">yyh-001/dsh-meme</a>, with an independent version number
<strong>0.1.1</strong>. The pack marketplace still points at upstream <code>dsh-meme-packs</code>.</sub></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.1-blue?style=flat-square" alt="0.1.1" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" /></a>
  <img src="https://img.shields.io/badge/Node-%E2%89%A522.13-blue?style=flat-square" alt="Node ≥ 22.13" />
  <img src="https://img.shields.io/badge/tests-305%20passing-brightgreen?style=flat-square" alt="305 tests" />
</p>

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong><br />
  <a href="https://github.com/yyh-001/dsh-meme-packs">Pack marketplace</a> ·
  <a href="https://github.com/mmwmdxg/dsh-meme-new/issues/new/choose">Report an issue</a>
</p>

## What this branch changes

Fixes and additions on top of upstream. **The version number is independent** (upstream uses a 0.1.x three-part sequence; this branch starts at 0.1.1).

| Area | Change |
| --- | --- |
| Security | The URL branch of `learn_meme` now applies an address policy: loopback, private and link-local addresses are rejected (SSRF hardening). Validation is a pure, unit-tested function |
| Import compatibility | ZIP supports both `store` (method 0) and `deflate` (method 8) entries, with sizes / CRC32 checks so a corrupt archive cannot be silently installed |
| Image route | Serves `ETag` / `304` and `Range`, so a repeated sticker in one conversation no longer re-transfers the whole file |
| Dedupe & usage | sha256 dedupe on ingest (**same pack only** — the same bytes in another pack is allowed with a notice); `send_meme` counts a hit only when an image is actually delivered; listing can sort by hits and filter never-used |
| Performance | Index snapshot cache with explicit invalidation: image route **23.5ms → 0.72ms (33×)** on a 20k-row pack. FTS5 was measured and **rejected** (below) |
| Panel | Sort dropdown, never-used filter, duplicate check, hit counts and duplicate badges on cards |
| Prompt | The proactive-meme prompt was rewritten into actionable rules (when to send, when not to, how many per reply, how to copy the caption) |

**Why no FTS5**: Chinese substring search can only use unigram+bigram OR candidates. At 20k rows the candidate set is 40–60% of the table and costs 6.7–9.7ms — on par with, or slower than, the 6.6–7.6ms full scan. Real speedup requires changing search semantics (AND exact match), which is a product decision, not a performance optimization. Measurements live in [AGENTS.md](./AGENTS.md) so nobody adds it back by mistake.

## Features

- **Click to send**: open 😊 beside the composer, search or filter by pack and mood, then pick an image.
- **Chat with memes**: the AI searches by mood or keyword. Web chats render a text marker as an image (no image-input support needed); QQ / WeChat and other IM chats switch to native image delivery through dsh-im.
- **Learn new images**: upload an image and ask to save it; the AI identifies its category and caption.
- **Manage and share**: enable multiple packs, upload and edit images, import/export ZIPs, install or update marketplace packs.
- **No duplicates, no clutter**: content-hash dedupe, delivery counts, hit sorting, never-used filter.
- **Favourites survive updates**: uploads and learned images go to a "My Favourites" pack under `~/.dsh/meme-packs`, outside the plugin package.
- **Ready to use**: includes Big Fat Fish (24 images), with no third-party runtime dependencies; uses Node's built-in SQLite.

## Install

> **Note**: `dsh-meme` on npm and in the plugin marketplace is the **upstream** version, not this repository. To run this branch, install from here.

```bash
# 1) Get the code (use SSH below if github.com:443 is blocked)
git clone git@github.com:mmwmdxg/dsh-meme-new.git

# 2) Install into your profile (local directory — avoids the npm registry)
cd ~/.dsh/profiles/desktop
pnpm add file:/absolute/path/to/dsh-meme-new

# 3) Ensure profile package.json has "dsh-meme" in dsh.profile.bundles
```

Restart DSH, then confirm it is enabled under **Settings → Memes**.

Requires **Node.js ≥ 22.13.0** (built-in `node:sqlite`). The old package name `dsh-expression` is deprecated; its internal plugin ID is retained for compatibility.

### When github.com:443 is blocked

`github.com:443` is reset on some networks while `ssh.github.com:443` works:

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

## Usage

| Goal | How |
| --- | --- |
| Send an image yourself | Click 😊 beside the composer; search, filter, hover to preview, then send |
| Ask the AI to send one | "send a happy meme" or "find a cat doing a heart gesture" |
| Save a new image | Upload it, then ask to save it; automatic recognition needs an image-capable model |
| Save an animated GIF | Upload it from the management panel, or copy it into the pack directory and click "Scan for new" — the original animation is preserved. Sending a GIF into chat for the AI to learn flattens it to a single frame (host attachment behaviour), so avoid that path |
| Find duplicates / clean up | "Check duplicates" hashes contents; "Never used" filters cold images |
| View full size | Click a sticker in chat; scroll to zoom, double-click to reset, Esc or click the backdrop to close |

<p align="center">
  <img src="./docs/chat-example.png" alt="Chat example: the user sends one, the AI answers with one" width="80%" />
</p>

## Pack management

Open **Settings → Memes**:

- **Packs**: manage images per pack; the switch decides whether the AI may use that pack, and several can be on at once. Create, import, export, submit and delete; an "Update" badge appears for newer versions.
- **Discover**: preview marketplace packs and install in one click; release ZIPs are SHA-256 verified.
- **Settings**: change the scan directory, toggle proactive sending, edit the prompt, pick the delivery mode (auto / text only / image).

The default scan directory is `~/.dsh/meme-packs`; settings live in `~/.dsh/dsh-expression.json` and survive upgrades.

Delivery mode only controls how the **AI** sends; the front end still renders `[表情: caption]` as an image. **Auto** (default) follows the channel — a text marker in Web chats, a native image in IM chats. **Text only** never sends an image. **Image** requires the AI to actually deliver every image it picks. Changes apply from the next message.

## Tools

| Tool | Usage |
| --- | --- |
| `send_meme` | `tag` picks a random image in that mood; `query` searches caption/keywords/filename; they combine. Without `tag`, the mood is inferred from `query`. `limit` defaults to 8 (5–8 recommended) |
| `meme_list` | Read-only listing across enabled packs. Supports `duplicates`, `sort=hits\|recent`, `unused`, and `q`/`tag`/`packId` filters |
| `meme_update` | Change `tag` / `caption` / `keywords` of one image; index only, never the file |
| `learn_meme` | Save a new image; defaults to the latest user image, or pass `attachmentId` / `imageUrl` |

Mood buckets: `happy` / `angry` / `sad` / `shy` / `confused` / `daily`. The model should copy `[表情: caption]` verbatim from the candidates; the front end only renders it inside chat content. **Deleting images is panel-only — no agent tool exists for it.**

**Animated GIFs**: `learn_meme` and the upload dialog sample a GIF along its timeline into frames and compose a contact sheet with frame-order captions before calling the model, so the caption can describe motion ("cat shaking its head wildly") instead of the first frame. The original file is stored unchanged and still animates in chat. WebP / APNG currently yield metadata only (frame count, duration) and are captioned from the first frame. Decoding is pure JS with no third-party dependency.

With [dsh-im](https://github.com/xmanrui/dsh-im) (QQ / WeChat / Feishu / WeCom), stickers are delivered as native images in that chat: the plugin detects the IM channel and `send_meme` candidates carry **absolute paths**, which the model hands to `dsh_im_return_file`. IM chats do not render the text marker. This delivery rule ships with the proactive prompt, so you never have to explain to the model that it may send images in QQ/WeChat. Web chats keep the marker; both can coexist.

## Performance rules (do not regress)

- **Index snapshot cache**: `cachedStore(root)` keeps row arrays plus a path whitelist in memory, invalidated by `index.db` size+mtime. The image route checks the whitelist on every request; 20k rows measured 23.5ms → 0.72ms.
- **Invalidate explicitly on write**: upload / learn / edit / delete / scan / import / pack switch or delete must call `dropStoreCache(...)`, plus `invalidatePacks()` when counts or covers change. mtime alone is not enough — same-millisecond writes and deleted directories are invisible to it.
- **No expression ordering in cover queries**: `ORDER BY (tag = 'happy') DESC, path` cannot use an index; use `WHERE tag='happy' ORDER BY path LIMIT 1` with a fallback and a `(tag, path)` index.
- **Do not add FTS5**: see the measurements above.

```bash
npm test          # pretest generates the peer-dependency stub, so a clean checkout works
```

## Update failed / plugin disappeared?

The host updates a plugin by having pnpm rename and replace the whole `node_modules/dsh-meme` directory. **On Windows a directory cannot be renamed while any file inside it is open**, so pnpm fails with `exit 1` and the marketplace often shows only a truncated line.

Upstream fixed the plugin's own file lock in 0.1.59 (historically the bundled pack's `index.db` stayed open); this branch includes that fix — the index is read into memory once at startup and the database is opened only briefly for writes.

If it still fails:

1. **Quit DSH completely** (tray → quit; confirm no `dsh` / Electron process), then retry.
2. If the plugin vanished, reinstall from this repository (see Install).
3. Packs and settings live in `~/.dsh` and survive updates or reinstalls.

## Sharing your pack

1. Create a pack under **Packs** and add images.
2. **Export** produces a ZIP; others install it with **Import pack**.
3. To submit to the marketplace, click **Submit**: the plugin exports the ZIP and opens a prefilled GitHub form.

Use the ZIP exported by the plugin. GitHub's "Download ZIP" is a source archive and cannot replace a pack.

## Networks where the marketplace is unreachable

Pack catalogs and previews are hosted on GitHub. The plugin races several mirrors by default (`ghfast.top`, `gh-proxy.com`, `ghproxy.net`, `cdn.jsdmirror.com`, `fastly.jsdelivr.net`) and caches the last good catalog at `~/.dsh/dsh-meme-catalog-cache.json`. Installs stay SHA-256 verified — a mirror that returns the wrong hash is skipped.

If it still fails: click **Retry**; then under **Settings → Catalog source** pick **Mirror** (most reliable) or provide your own `catalog.json` URL; you can also edit `remoteDirUrl` in `~/.dsh/dsh-expression.json` (`auto` / `official` / `mirror` / URL).

## Security boundaries

- HTTP endpoints accept loopback addresses only (`localhost` / `127.0.0.1` / `[::1]`); LAN addresses and custom domains are rejected.
- URL ingestion in `learn_meme` rejects loopback, private and link-local addresses (SSRF hardening).
- Pack ZIP import validates entry sizes and CRC32.

## License

Code is [MIT](./LICENSE). **The license covers code only**: the bundled pack `memes/dafeiyu-001` declares `license: personal` in its `manifest.json`; it ships with the package but is not covered by MIT and is for personal use only. Confirm redistribution scope before making this repository public.

---

Remote pack specification: [docs/remote-pack-spec.md](./docs/remote-pack-spec.md). Agent-facing conventions and pitfalls: [AGENTS.md](./AGENTS.md).
