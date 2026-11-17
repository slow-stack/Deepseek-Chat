# DeepseekChat

English | [简体中文](README.zh-CN.md)

A chat client for the DeepSeek API that keeps the whole conversation: every branch you tried, every reply you kept.

No application backend is required. The browser talks to the configured API service directly. The same build runs as a static site, as a panel inside DeepSeek Harness, and as an Android app.

This is a fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). What the fork adds is listed [below](#what-this-fork-adds).

## Getting started

Install Node.js 22.12+ and pnpm, then:

```sh
git clone https://github.com/slow-stack/Deepseek-Chat.git
cd Deepseek-Chat
pnpm install
pnpm dev
```

Open http://localhost:8090. To build the static site:

```sh
pnpm build
```

The output lands in `dist/`. Serve it from a static host, or open `dist/index.html` directly — that needs browser support for storage on `file://` pages and an API service that allows their cross-origin requests.

## Install on an iPhone Home Screen

The web build is the whole app: no package to install, no jailbreak, no developer account. On iOS, open [slow-stack.github.io/Deepseek-Chat](https://slow-stack.github.io/Deepseek-Chat/) in Safari and use Share → Add to Home Screen. Launched from the icon it runs full screen, without the address bar.

**Open it once with a connection after adding it.** The offline shell is saved by the Service Worker during that visit; start it offline before that and you get the splash, then a blank page.

On first launch, enter your own API key and endpoint (Settings → Model). Conversations live in this device's IndexedDB and are never uploaded; the iOS "cleared after seven days without interaction" rule does not apply to a Home Screen app, but the system can still reclaim space under pressure, so export a backup of anything you would hate to lose.

On Android, install the APK instead ([release/README.md](release/README.md)): it adds a native shell and file associations.

GitHub Pages does not allow custom cache headers, so `sw.js` gets the platform default of ten minutes and an old version can linger that long after a release. That is a hosting limitation, not a bug; the local preview (`node deploy/serve.mjs`) sends `no-cache` for `sw.js` and the manifest, so it has no such delay.

## Features

- Conversations with automatic titles, renaming, deletion, prompt editing, regeneration, and switchable message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop a reply or continue it.
- Upload, paste, or drag attachments; voice input and read-aloud replies, with a live audio spectrum while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## What this fork adds

- **Long conversations stay inside the context window.** Older turns are compacted into summaries when a session grows past the limit, with a chip in the composer showing what was folded and a way to inspect it.
- **A way out of the panel.** Inside DeepSeek Harness the back button belongs to the host, not to the app: it calls `layout.selectPanel(null)` and says so when the host refuses, instead of leaving you with no exit.
- **A launch-time update check.** Sideloaded builds ask a release manifest whether a newer version exists, and point at the download if it does. It never installs anything by itself. See [release/README.md](release/README.md).
- **Faster history import.** Importing a 21MB archive took 11.2s on a phone-class CPU; it takes about 4.5s now, because the ZIP reader stopped verifying CRC32 one byte at a time.

## Where things live

```text
src/                   Application source
  app/                 Layout, themes, global styles
  components/          Chat, settings, markdown, and other UI
  services/
    api/               Requests, SSE, protocol types
    chat/              Conversations, branches, storage, import/export, compaction
  services/update.ts   Version manifest check
release/               Release manifest the update check reads
scripts/               Build helpers
```

Two integrations live beside it:

- `integration/dsh-chat-demo/` — the DeepSeek Harness panel: a host process serving `dist/` on a fixed port, plus a client that registers the sidebar entry and a full-page iframe. Fixed port because conversation storage is per-origin. See its [README](integration/dsh-chat-demo/README.md).
- The Android shell (Capacitor) is maintained outside this repository; it wraps the same `dist/` build.

## Data and storage

The API key and settings live in the browser's localStorage. Conversations and original attachments live in IndexedDB, isolated by browser profile and origin. Sending a message, uploading an attachment, or using speech sends that content to the configured API service.

History import and export use ZIP archives. Importing replaces all local conversations and attachments after validation; exports include conversations and available original images, but no API keys, settings, or non-image attachments. The archive format is documented in [src/services/chat/history/README.md](src/services/chat/history/README.md).

Settings → Data → Delete all chats clears local conversations, attachments, and drafts after confirmation. It keeps your API key and settings.

## Development

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `pnpm dev`        | Development server                   |
| `pnpm build`      | Build into `dist/`                   |
| `pnpm build:panel`| Build and deploy into the DSH panel  |
| `pnpm type`       | TypeScript type checks               |
| `pnpm lint`       | Lint with oxlint                     |
| `pnpm format`     | Format with oxfmt                    |

[rspack.config.ts](rspack.config.ts) points at `https://api.deepseek.com` by default; `createConfig({ apiOrigin, devServer })` changes that. Chat uses `deepseek-flash` through the Anthropic-compatible Messages and Files APIs, and speech uses the ASR/TTS endpoints. Requests carry extensions for search, link reading, titles, and `latest_reminder`, so the configured service has to support them. Supported attachment formats are decided by server-side validation.

## Feedback

No backend, no group chat. Three routes reach the same place:

- **GitHub issues** for bugs and feature requests — tracked publicly, so search first
- **Email** to work@modusensus.space when you would rather not have an account
- **Copy** the text out of Settings → About → Feedback and paste it wherever you like

Inside the app, that dialog fills in the title and body for you and can attach the version and platform (never your conversations or keys). Details in [docs/FEEDBACK.md](docs/FEEDBACK.md).
## Notices

- **Unofficial client.** This project is maintained by a third party and is not affiliated with, authorised by, or endorsed by DeepSeek. "DeepSeek" is a trademark of its owner.
- **Bring your own API.** The app ships no keys and runs no server of its own: requests go straight from your device to the endpoint you configure, and usage is billed to your account.
- **Your data stays on the device.** Chats, attachments, projects, and memory settings live in the browser's IndexedDB. Clearing site data or uninstalling deletes them, so keep your own backups.
- **Provided as is.** No warranty of any kind; you use it at your own risk.

## License

[MIT](LICENSE). The build copies the license and [NOTICE](NOTICE) into `dist/`; include both when distributing the app. Third-party dependencies keep their own licenses; icons come from [Lucide](https://lucide.dev) (ISC).

The upstream project is [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), also MIT. Interfaces kept from upstream remain compatible; the additions above are this fork's.