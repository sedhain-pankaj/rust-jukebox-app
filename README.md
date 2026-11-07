# Craig Williams JukeBox

This is a rust port of my other project `Craigs Music Player` which was built with PHP and JS. This is a new kiosk-style desktop jukebox application built with **Tauri** (Rust + JavaScript) with every configuration required built into a single EXE file. Browse, queue, and play music videos from a local library — organized by genre — with shuffle, search, YouTube integration, and an on-screen keyboard for touch-friendly use.

![Platform: Windows](https://img.shields.io/badge/platform-Windows-blue)
![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange)

---

## Features

### Music Library

- **10 genre categories**: 50's + 60's, 70's, 80's, 90's, 2000's, Latest Hits, Country, Karaoke, Special Occasion, Christmas Songs
- Supports video formats: mp4, m4v, mov, flv, ogv, webm, avi, mkv, wmv, mpg, mpeg
- Song thumbnails displayed alongside titles for easy browsing

### Playback & Queue

- **Queue system** — add songs from any category; queue plays in order
- **Duplicate prevention** — can't queue the same song twice
- **Skip** — context-aware skip for both queue and shuffle modes
- **Move to top / remove** — reorder or remove queued songs
- Auto-plays the first queued song immediately

### Shuffle / Randomizer

- **Per-category shuffle** using Fisher-Yates algorithm
- **Auto-shuffle 80's** when idle (no queue, no song playing) — restarts automatically when a shuffle or queue ends, with no user input needed (immediate + 4 delayed retries, so the restart can't race the player's teardown)
- Shuffle pauses when queue has songs; resumes when queue empties

### Video Player

- Powered by **MediaElement.js** with full controls (play/pause, seek, volume, fullscreen)
- Auto-enters fullscreen after 7 seconds of inactivity
- Click to exit fullscreen

### Search

- **Real-time search** across all songs or karaoke-only with debounced input
- Highlights matching text in results

### YouTube Integration

- Search YouTube from within the app (top 10 results)
- Queue YouTube videos alongside local songs
- Built-in internet speed test to check streaming viability

### On-Screen Keyboard

- Touch-friendly virtual keyboard for kiosk/touchscreen setups
- Auto-closes after 60 seconds of inactivity
- Caps lock, backspace, and full alphanumeric support

### UI

- **3-column layout**: categories + volume (left), video player + song browser (center), search + queue (right)
- Smooth scroll controls for song lists and queue
- Side navigation for shuffle category selection
- Modal dialogs for confirmations and notices — one shared dialog slot: when a modal follows another (password → success, confirm → progress → result) its content swaps in place, no close→gap→open flicker
- Text selection disabled (kiosk mode)

---

## Prerequisites

- **Rust** — Install from [https://rustup.rs](https://rustup.rs)
- **Music files** — You need your own music/video library (not included in the repo due to size). A guard is present in `main.rs` to check for the `music/` folder and prompt you to create it if missing.
- **Secrets in `.env`** — a `KEY=VALUE` file next to the `music/` folder (fallback: the working directory), parsed once at startup — changes require an app restart. It is gitignored; `config.js` is tracked app code and no longer holds any secrets:
  - `YT_API_KEY` — consumed by Rust only (the `youtube_search` IPC command); it never enters the webview.
  - `QUEUE_CLEAR_PASSWORD` — consumed by the webview (`config.js` fetches it over IPC, where `YT_API_KEY` is stripped from the payload) to clear the whole queue.

## Setting Up the Music Library

Create a `music/` folder in the project root with this structure:

```
music/
├── 2000/
│   ├── img/          ← song thumbnails (.jpg)
│   └── *.mp4         ← video files
├── Christmas Song/
│   ├── img/
│   └── *.mp4
├── Country/
│   ├── img/
│   └── *.mp4
├── Eighty/
│   ├── img/
│   └── *.mp4
├── Fifty Sixty/
│   ├── img/
│   └── *.mp4
├── Karaoke/
│   ├── img/
│   └── *.mp4
├── Latest Hits/
│   ├── img/
│   └── *.mp4
├── Ninety/
│   ├── img/
│   └── *.mp4
├── Seventy/
│   ├── img/
│   └── *.mp4
└── Special Occasion/
    ├── img/
    └── *.mp4
```

Each category folder holds video files and an `img/` subfolder with matching `.jpg` thumbnails (e.g., `Song Name.mp4` → `img/Song Name.jpg`).

Missing thumbnails can be generated with the standalone tool in `admin_tools/GenerateImage/` (see its README) — the app itself plays fine without a thumbnail, it just shows a grey box.

---

## Admin Mode (Transferring Songs from a USB Drive)

Admin mode is a built-in song-transfer workflow — no separate tool needed:

1. Put a `music/` folder with the same category structure as above (videos + `img/` thumbnails) on a USB drive.
2. Place an empty `admin.key` file at the **root of the USB drive**.
3. Plug the USB in and (re)start the jukebox. The app detects `admin.key` on any drive letter and opens the **Admin Mode** screen.
4. Choose a mode:
   - **AUTO** — after a 10 s countdown (cancelled by any input), every *new* song that has a thumbnail is copied automatically.
   - **Manual** — pick individual songs (thumbnails are shown, so you can see what you're transferring). The summary shows per category `N new songs, M existing`.
5. The copy runs with per-file progress and a **Cancel** button. New songs are skipped if the jukebox already has them.
6. When finished (or if you Cancel on the chooser screen) press **Start Jukebox** — the app reloads (a clean-slate reset, like the old kiosk). **Remove the update drive before pressing it** (both dialogs say so in bold): with the drive still connected, admin mode is simply offered again on the reload — it will show 0 new songs, and Cancel → Start Jukebox takes you in.

Detection is stateless — no files are written on the machine and nothing is recorded per drive — so the same USB can be plugged into any jukebox, and each one offers the transfer and shows its own "N new / M existing" state. (The reload is not needed for data correctness: the song list comes from Rust over IPC, recomputed from disk and refreshed right after a copy, so the old PHP+Firefox stale-list problem can't happen here. It resets player/queue state and matches the kiosk workflow.)

Notes:
- Songs without a thumbnail are **ignored** in AUTO mode (they'd show a grey box in the player grid) and are flagged in the summary.
- Drive detection is cross-platform: Windows drive letters `D:\`–`Z:\` (the target platform) and udisks2 mounts on Linux (`/run/media/<user>/<name>`, `/media/...`, `/mnt/...`).

---

## Building the App

### Run in development mode

```powershell
cd src-tauri
cargo run
```

### Build a release .exe

```powershell
cd src-tauri
cargo build --release
```

The compiled binary will be at:

```
src-tauri/target/release/rust-jukebox-app.exe
```

### Build a Windows installer (MSI / NSIS)

Install the Tauri CLI first, then build:

```powershell
cargo install tauri-cli
cd src-tauri
cargo tauri build
```

This produces the `.exe` and a Windows installer in `src-tauri/target/release/bundle/`.

---

## Performance Notes

The app targets a Windows kiosk jukebox on **low-end hardware** with a big library (~1,569 videos, ~74 GB, 10 categories, ~11 MB of jpgs per category). The design decisions below are for that target — each note says what, how, and why.

### Startup & IPC

- **Song library cached in Rust** (`song_cache.rs`). *How:* scanned once in `.setup()` before JS runs (the scan overlaps window/JS loading; every scan logs `Song scan: N songs across 10 directories in X ms` to the terminal); every IPC call (`get_all_categories`, `get_songs_by_category`, `get_shuffle_paths`) returns from memory; per-category serving (`songs_for`) clones only the requested category (≈1/10 of the old all-10 copy); the 10 directory mtime/size freshness checks are 15 s TTL-gated (zero stat calls inside the window); re-scan on fingerprint mismatch, immediately after an admin copy, or via the async `refresh_song_cache` command (its re-scan runs on a blocking thread, so it never blocks the main IPC thread). *Why:* every IPC call used to re-read 10 directories from disk and copy all 10 categories into the response — on a slow disk each category click, shuffle, and the startup auto-shuffle paid for it.
- **Media server resolution cache** (`media_server.rs`). *How:* the first request for a URL does the full work — `canonicalize` (re-resolves the Windows junction) + root check + `metadata()` — and the result (canonical path, length, mime, mtime) is cached per URL (bounded, 2048 entries); later requests (seek bursts = many Range requests on the same file) cost one `metadata()` re-validation (size + mtime). A replaced or removed file invalidates the entry and re-resolves; the first-contact canonicalize + root check is never skipped. *Why:* a seek/scrub used to pay the junction re-resolution once per Range request.
- **Fast port acquisition** (`media_server.rs`). *How:* the previous-instance probe read timeout is 250 ms (was 2 s — a live server answers in <5 ms on loopback, a dead port is refused in ~0 ms) and the bind retry is 100 ms (was 500 ms), with 2 attempts per port before moving to the next candidate. Worst case across all 8 candidate ports: ≈2.8 s (was ≈16 s). *Why:* the app must not stall startup if the previous instance's socket is still releasing — but the 2 retries per port keep the "reuse the same port" protection; a slow release just lands on the next candidate, which is harmless (all 8 ports are enumerated in the CSP and the JS reads the actual bound port over IPC).
- **YouTube search in Rust** (`youtube_search` IPC). *How:* the webview sends only the query text; Rust reads `YT_API_KEY` from `.env`, fetches the top 10 results, and returns them with the title pre-escaped once (`title_html`) for display. Each search logs `YouTube search '<q>' -> N results in X ms`. *Why:* the old webview XHR corrupted `&`, `#`, `+` in query strings and shipped the API key into the page; the `googleapis` origin it needed is gone from the CSP's `connect-src`.
- **Auto-shuffle restart is autonomous** (`index.js`). *How:* every idle transition (startup, shuffle end in `shuffle.js`, queue end in `queue.js`) calls `scheduleAutoShuffleRestart()` — an immediate check plus up to 4 delayed retries (1 s apart). *Why:* the old code checked `$("video").attr("src") == ""` inline right after `resetPlayer()`, but mejs's teardown settles over a short window — the check raced it, the second cycle only restarted after a mouse move / fake click, and the queue-end path triggered nothing at all. The delayed retries let the teardown settle; no user input is needed (the old activity-listener remnant was removed).
- **Single page load.** *How:* the window opens on `about:blank`, navigates to the localhost plugin server (YouTube Referer fix), and falls back to the bundled asset page if the server is down. *Why:* the page used to load twice (asset page → navigation → full reload), parsing ~0.8 MB of scripts (jquery, jquery-ui, mejs) two times.
- **No UI freezes.** *How:* the blocking work — USB scan, song copy, speed-test download — runs in `spawn_blocking` behind `async` IPC commands; the copy emits per-file `admin-copy-progress` events and is cancelable (flag checked between files). *Why:* sync Tauri commands run on the main thread and freeze the UI event loop — a USB scan or a multi-GB copy would have frozen the screen for seconds to minutes.
- **Memoized path lookup.** *How:* `get_music_base_path` and the `.env` parse are `OnceLock`-cached; debug-log file writes are gated behind `debug_assertions`. *Why:* the base path is looked up by *every* IPC command and used to write a temp file on each call — a disk write per IPC call on slow hardware.

### UI

- **`loading="lazy"` song thumbnails** — a category view (~356 rows) decodes only the ~15 visible images instead of all ~11 MB of jpgs at once.
- **Hardcoded static UI** — the 10 category buttons and 9 shuffle links live in `ui/index.html` (kept in sync with the compile-time `CATS` list in Rust, which remains the single source of truth for scanning). They render before the IPC round-trip instead of after. The on-screen keyboard stays JS-built (its timer/caps logic made hardcoding not worth the risk).
- **One shared startup gate** — `startupGate()` in `validation.js` (admin check → media-server port → music-structure validation, memoized) replaces the copy-pasted gate in `index.js` and `songs.js`.
- **`preload='metadata'`** on the video element (consistent in markup and `resetPlayer()`) — lighter on a slow disk than `auto`.
- **Single modal slot** (`modal.js`). *How:* every dialog reuses one `#dialog-confirm` widget (jQuery UI re-opens it on every `.dialog()` call because `autoOpen` re-runs); when a modal is requested while the slot is still occupied — open, or with its blind-close animation queued/running — `jquery_modal` swaps the content in place (title, HTML, buttons, class, size, timer; no open animation). An in-flight blind hide is cancelled with `stop(true, false)`, i.e. *without* letting it complete, so its delayed "close" event (which fires only when the animation finishes) can never clear the new modal's countdown. The countdown is an idempotent `startCountdown()` that always kills the previous timer first and resets to the new modal's full `closeTime` — no timer bleed between modals; `closeTime: 0` starts no timer at all. *Why:* the old patterns (explicit close + delayed reopen, or `closeOnClick` + a follow-up modal) played close-animation → gap → open-animation on the same element — the clear-queue password box "handing over" to the success box, and admin confirm → progress → result, looked like jitter.

### Thumbnails

- Pre-generated jpgs (~30 KB each, from `admin_tools/GenerateImage`) stay the display source — fastest to decode, zero runtime work. Alternative considered: OS/Shell video thumbnails need a COM call per item and cached sizes only go to 1024px, so they aren't a drop-in for a 1920×1080 kiosk grid. Future work: a background "fill missing thumbnails" pass so the tool doesn't have to be run manually.

### Admin mode

- **Stateless admin detection** — `admin.key` on a USB root is the only trigger; no transfer files are written on the machines. The admin screen itself is the status view (`N new songs, M existing`), and a restart with the drive connected re-offers it — the Cancel/Done dialogs tell the admin to unplug the drive before restarting. The same USB works on any jukebox, nothing to clean up.
- **Reload exit** — Cancel and "Transfer Complete" both offer **Start Jukebox**, which reloads the app (clean-slate reset, old kiosk workflow). The reload is a UX choice, not a data necessity: the Rust song cache is refreshed the moment a copy finishes, so new songs would appear without it. Dialogs warn to remove the drive first, since a reload with it connected re-offers admin mode.
- **Honest countdown** — the 10 s auto-timer starts only when the (async) scan resolves; the UI shows "…" meanwhile.
- **New-only manual list** with a "Show existing" toggle, row thumbnails (runtime USB asset-scope grant), and a progress modal with per-file line and Cancel.

### Security

- **Asset protocol locked down** — the static `assetProtocol` scope is `[]` (nothing is readable through `asset://` by default); every real use is a runtime `allow_directory` grant: the music directory (junction + canonical) at setup, the USB drive in admin mode. Thumbnails (`convertFileSrc`) are covered by those grants.
- **Hand-written CSP, Tauri's CSP modification disabled** (`dangerousDisableAssetCspModification: true`) — the CSP in `tauri.conf.json` already enumerates the asset origins in `default/img/media/connect-src`; letting Tauri "modify" the CSP actually rewrites it and drops hand-written directives (it once broke `script-src 'unsafe-inline'`, which the app's inline handlers need), so the flag is load-bearing despite its scary name.
- **Secrets stay in Rust** — `YT_API_KEY` is read from `.env` by the `youtube_search` command only; `get_app_env` strips it before anything reaches the webview (which receives just `QUEUE_CLEAR_PASSWORD`).
- **Media server paths are canonicalized + root-checked** on first contact (the resolution cache re-validates with size + mtime but never skips the first check).
- HTML escaping happens once at the data boundary in Rust (`Song.name_escaped`, `ShuffleSong.name_escaped`, `YouTubeSearchItem.title_html`); the JS injects it through `textContent`/`innerHTML` exactly once and never re-derives it (the old decode + extension-strip + re-escape round trip is gone).

### Housekeeping

- `const CATS` (zero-allocation), `sort_by_key` sorts (one lowercase alloc per element instead of two per comparison — `cmp_ignore_ascii_case` was rejected: it changes ordering for accented titles), speed-test quality/icon owned by Rust (one threshold source), debug-only commands deleted, dead wrappers dropped, clippy clean (0 warnings), 9 unit tests (escape, scan, song-cache + media-file-cache invalidation).
- The speed test uses `reqwest` in `spawn_blocking` rather than a raw `TcpStream`: the test URL is HTTPS and `std` has no TLS (the media server is plain-HTTP localhost only, which is why it can use raw sockets).
- Known leftovers: stray `music/demo.png`; the PHP→Rust educational comments in the sources are kept as onboarding material.

---

## Tech Stack

| Layer    | Technology                |
| -------- | ------------------------- |
| Backend  | Rust + Tauri 2            |
| Frontend | HTML / CSS / JavaScript   |
| Player   | MediaElement.js           |
| UI Libs  | jQuery UI, Material Icons |

---

## License

Private project — Craig Williams.
