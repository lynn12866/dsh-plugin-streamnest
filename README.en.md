# StreamNest · 拾流

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek-Harness-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness)
[![Version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgit.aimz.cc.cd%2Fapi%2Fv1%2Frepos%2Flynn1286%2Fdsh-plugin-streamnest%2Fraw%2Fpackage.json%3Fref%3Dmain&query=%24.version&prefix=v&label=version&color=blue)](package.json)
[![License: MIT (original code)](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[中文](README.md) | English

Parse audio and video links, select quality, audio tracks or subtitles, and save files locally. The UI and Agent share services and the download queue.

![StreamNest installed and enabled in the DeepSeek Harness desktop app, showing the Link Download page](assets/screenshots/deepseek-harness-installed.png)

## Features

- Parse media with yt-dlp, dedicated APIs and browser fallbacks for Douyin and Kuaishou, and single-video WeChat Channels share links.
- Select quality and audio tracks, extract MP3 audio, and download subtitles in their original format or SRT.
- Queue downloads, control concurrency, view progress and speed, pause, resume and retry; supports chunked direct downloads with resume, concurrent HLS / DASH segments, and optional aria2.
- Search completed downloads, view local thumbnails, play media, open folders and sync the directory; permanently delete individual or multiple downloads after a second confirmation.
- Configure the download directory, filename template, default quality, proxy, and explicitly selected browser profile or Cookie file; supports Chinese and English.
- Detect or install yt-dlp, FFmpeg and ffprobe, inspect redacted logs, and generate feedback drafts.

## Installation

Targets DeepSeek Harness Desktop `0.2.1-rc.3`. In **Plugins → Add Plugin**, enter `dsh-plugin-streamnest`, select the official npm registry, then install and enable it. Alternatively, use the CLI:

```bash
dsh plugin --profile desktop add dsh-plugin-streamnest --registry=https://registry.npmjs.org/

# Web: run on the server
dsh plugin --profile web add dsh-plugin-streamnest --registry=https://registry.npmjs.org/
```

For a local `.tgz` package, select it on the plugin page or run:

```bash
dsh plugin --profile desktop add file:/absolute/path/dsh-plugin-streamnest-0.1.1.tgz
```

Replace the path and version with those of your package. Restart the app / Web service after installation or update. Installation requires no compilation. See `peerDependencies` in `package.json` for supported host SDK versions.

## Usage

1. Open StreamNest in the host, go to **Settings**, select a local download directory, and check the runtime dependencies.
2. Paste a media link into **Link Download**, parse it, select video quality, audio tracks or subtitles, and add a download to the queue.
3. Monitor and control tasks in **Download Queue**; play media or open its folder in **Completed Downloads**.

Ask the Agent in a host conversation to parse links, create downloads, inspect the queue or pause tasks. Results stay in sync with the UI.

## Limitations

- Parses one video at a time without expanding playlists; live streams are not supported.
- Site availability depends on platform APIs, access permissions, login state, and runtime tool versions.
- Standard WeChat Channels share links require a Tencent Yuanbao login session. Links containing valid playback parameters can be parsed directly. Only single videos are supported.
- Browser Cookies are read only after a source is explicitly configured. Without a configured source, requests use an unauthenticated session.
- Downloads do not resume automatically after the host restarts; resume them manually.
- Deleting items in **Completed Downloads** permanently deletes their registered files after a second confirmation and cannot be undone. Directory sync only updates records and does not delete files.
- aria2 is optional and must be installed separately or provided through a configured path.

## Development and publishing

Requires Node.js ≥ 22.13 and pnpm 11.5.0.

```bash
pnpm install --frozen-lockfile
pnpm verify                            # Format, lint, types, build and tests
pnpm pack --pack-destination artifacts  # Verify, build and create a local package
pnpm release --dry-run                  # Verify and preview the npm package
pnpm release                           # Log in to npm, verify, build and publish
```

`verify` runs `check → build → test`. Packing and publishing run the same validation through `prepack`. Local packages are written to `artifacts/dsh-plugin-streamnest-<version>.tgz`.

`release` opens npm browser login, verifies the account with `whoami`, then publishes to the official npm registry (public / latest). Any failure stops the process. `--dry-run` only verifies and previews the package; it does not log in, upload or write an install archive. Update `version` in `package.json` before publishing again; published versions cannot be overwritten.

The npm package contains only compiled JavaScript, runtime configuration, locale files, required assets, documentation, licenses and source attribution. It excludes TypeScript / TSX source, source maps, tests and build scripts.

Run `pnpm dev` for a local preview at `http://127.0.0.1:5179`, with the API at `http://127.0.0.1:4322/streamnest/api`. The preview uses official theme and UI primitives; Desktop inherits the host theme.

| Directory                        | Responsibility                                            |
| -------------------------------- | --------------------------------------------------------- |
| `apps/api`                       | NestJS business services, DTO validation, media downloads |
| `apps/web`                       | React UI and Chinese / English translations               |
| `apps/shared`                    | Shared contracts for tasks, settings and output files     |
| `packages/harness`               | Host integration, official UI adapters and Agent tools    |
| `assets/reference-projects.json` | Reference project source list                             |
| `licenses`                       | Original license texts for reference projects             |

## Acknowledgments

Reference implementations: [DownVid](https://github.com/yxxbc/downvid) · [wx_channels_download](https://github.com/ltaoo/wx_channels_download)

## License

Original contributions are licensed under the [MIT License](LICENSE); the MIT badge above applies only to those contributions. Referenced and adapted portions retain their original authors' copyrights and license terms. The wx_channels_download license includes the Commons Clause; its full license text governs those portions. The build collects reference project sources, original licenses and bundled client dependency licenses in `lib/THIRD_PARTY_LICENSES.txt`.

## Disclaimer

- This is an independently developed third-party plugin with no official affiliation with or endorsement by DeepSeek or the relevant media platforms.
- Download only content you own, are authorized to download, or may lawfully download under applicable law. Follow the source platform's terms of service and respect copyright and privacy requirements. Do not use this software to bypass paywalls, DRM or other access controls, distribute content without authorization, or engage in other unlawful activities.
- The software is provided “as is,” without guarantees of continued third-party site availability or the completeness, accuracy or fitness of downloads for a particular purpose. Keep account credentials secure and back up important files. To the extent permitted by applicable law, authors and contributors are not liable for losses arising from use of this software, subject to [LICENSE](LICENSE) and the relevant third-party licenses.
