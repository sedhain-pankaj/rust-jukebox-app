## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Performance & Improvement Backlog

Full-project audit (2026-11-04), prioritized for the target: Windows jukebox on low-end hardware. File:line refs are to the audited tree.

### Status (2026-11-05)

- [x] #1 async admin/speed commands — `scan_admin_usb`, `copy_admin_songs` (per-file progress events + cancel), `speed_test` now run via `spawn_blocking`.
- [x] #2 song cache — `song_cache.rs`: pre-scan in `.setup()`, mtime/size invalidation, `refresh_song_cache` command, auto-refresh after admin copy.
- [x] #3 `loading="lazy"` on song thumbnails; duplicate `id="index"` → `class="song_index"`.
- [x] #4 double page load — window opens on `about:blank`, navigates to localhost, falls back to the asset page.
- [x] #5 `get_music_base_path` memoized (`OnceLock`), unused param dropped, debug-log writes gated behind `debug_assertions`.
- [~] #6 thumbnails — decision: keep pre-generated jpgs as display source (fastest); "fill missing thumbnails in background" is future work (no code change yet).
- [x] #7 admin: done-marker (`jukebox-transfer.done`, written per actually-copied file; detection skips completed transfers), honest "…" countdown during scan, new-only manual list + "Show existing" toggle, row thumbnails via runtime USB asset-scope grant, cancel button + per-file progress in the modal, README workflow documented.
- [~] #8 fixed UI: category buttons + shuffle links hardcoded in HTML (keyboard hardcoding deferred — small win, risky timer/caps logic).
- [x] #9 smaller items: speed-test quality/icon unified in Rust, redundant `includes` dropped, shared `startupGate()`, `preload='metadata'` consistency, debug artifacts gated, unit tests for scan + cache invalidation. Remaining: `music/demo.png` stray (user file — confirm before deleting), comment bloat (owner's call).
- [x] #10 micro-opts: const `CATS`, `sort_by_key` ×2, `debug_paths` deleted, `is_video_file_name` wrapper dropped, `get_app_env` cached, media_server double-canonicalize fixed, clippy clean (0 warnings). Remaining: comment bloat (owner's call).

### 1. Rust: sync IPC commands block the main thread (highest impact)
Tauri v2 runs sync `#[tauri::command]`s on the main thread — they freeze the UI event loop while running.
- `speed_test` (src-tauri/src/main.rs:726) — `reqwest::blocking` 10 MB download; UI frozen for the whole transfer (seconds–minutes on a slow line).
- `copy_admin_songs` (src-tauri/src/main.rs:607) — blocking `fs::copy` of potentially gigabytes; UI frozen for the entire transfer, so the progress modal can't even animate.
- `scan_admin_usb` (src-tauri/src/main.rs:433) — `read_dir` + 2 stat calls per video over USB; a slow USB scan freezes the UI (admin screen shows a stale "10s" countdown meanwhile).
Fix: make these `async` and run the blocking work via `tauri::async_runtime::spawn_blocking`; emit per-file progress events during copy so the modal can show real progress.
- Note (external review 2026-11-05): "drop reqwest, use a raw `TcpStream` GET like media_server" is **not** a drop-in — the speed-test URL is HTTPS and `std` has no TLS (the media server is plain-HTTP localhost only). Dropping the dep only works with an HTTP-only endpoint or adding rustls; otherwise keep reqwest and run it in `spawn_blocking`.

### 2. Rust: pre-scan + cache the song library (the "cache in Rust, pass over IPC" ask)
Every `get_all_categories` / `get_songs_by_category` / `get_shuffle_paths` call re-reads the 10 category directories from disk (src-tauri/src/songs.rs:220). The JS `cache` (ui/JS/songs.js:7) already memoizes the payload, so re-scans only hit shuffle clicks and the idle 80's auto-shuffle at startup — but on slow disks each one is 10 `read_dir` calls.
- Scan once in `.setup()` (src-tauri/src/main.rs:989) before JS runs and keep the result in a global `RwLock<Vec<Category>>`; the scan then overlaps window/JS loading (faster startup) and every IPC call returns from memory.
- Invalidation: `fs::metadata` (mtime/size) of the 10 dirs, plus an explicit refresh after an admin copy (see #7) and/or a `refresh` IPC command.
- `get_songs_by_category` (src-tauri/src/main.rs:688) and `debug_paths` (src-tauri/src/main.rs:250) are not called by any UI JS — dead or console-only; the cache makes them free either way.

### 3. UI: song thumbnails are the biggest per-view cost on low-end hardware
Each category view injects a string of ~356 rows, each row a `<table>` with an `<img>` (ui/JS/songs.js:109-118) — no lazy loading, so every category click re-parses the cached HTML string and decodes ALL ~356 images (~11 MB of jpgs, ~30 KB each) at once.
- Add `loading="lazy"` to the row `<img>` — both WebView2 (Chromium) and WebKitGTK honor it; only visible rows (~15) decode. Immediate, low-risk win.
- Then consider: one real `<table>` (rows as `<tr>`) or divs instead of one `<table>` per row, and/or a windowed list rendering only visible rows (scroll is button-driven in 400px steps — virtualization is easy).
- Each row also has `id="index"` (ui/JS/songs.js:146) — duplicate DOM ids across rows; switch to a class.

### 4. UI: the double page load at startup
The window first loads the asset:// copy of the UI, then `.setup()` navigates it to `http://localhost:<port>` (src-tauri/src/main.rs:1061-1069) → the whole page reloads. jquery (87 KB) + jquery-ui (255 KB) + mejs (420 KB) + app JS parse twice (the first pass is cut mid-`defer` by the navigation — the reason for the `ensureMusicStructure` guards in ui/index.js:296-305 and ui/JS/songs.js:56-69).
Fix: point the initial window URL straight at the localhost URL (the plugin server is up before `.setup()` runs), or `about:blank` + navigate; keep the asset page as fallback only if the localhost server is down. Saves a full second pass over ~0.8 MB of scripts and the duplicate startup IPC gates on slow hardware.

### 5. Rust: per-IPC-call overhead in `get_music_base_path` (src-tauri/src/main.rs:884)
Called by EVERY IPC command: walks up to ~7 candidate paths and does a `std::fs::write` to `%TEMP%\jukebox-debug.log` on every call — the `MUSIC_BASE_LOGGED` flag only gates the `term_log`, not the debug-log write. A disk write on every IPC call on slow hardware.
Fix: cache the discovered base path in a `OnceLock` (re-detect only on explicit refresh); gate the debug-log writes (also in `.setup()`, main.rs:1092-1120) behind `debug_assertions`.

### 6. Thumbnails: pre-generated jpgs vs OS file-manager preview (the "why not the OS thumbnails?" question)
- Pre-generated jpgs (current; admin_tools/GenerateImage, embedded ffmpeg): ~30 KB/image, fastest to decode in-app, zero runtime work; cost = admin runs Generate_Images.exe per USB.
- OS/Explorer-style thumbnails (Windows Shell `IThumbnailProvider`): zero admin work, but a COM call per item, only cached sizes (32/48/64/256/1024), and video thumbs only exist if the shell already decoded them. Not a drop-in for a 1920×1080 kiosk grid.
- On-demand in-app decode (ffmpeg or Windows Media Foundation): eliminates the admin step; the first view of a category pays the decode (slow on low-end hardware); subsequent views are instant once written to `img/`.
- Recommendation: keep pre-generated jpgs as the display source (fastest); optionally add a background "fill missing thumbnails" pass (reuse GenerateImage's ffmpeg approach, or the Shell API on Windows) so the admin doesn't run the tool manually. The Shell API is a nice fit for the admin-mode manual list, where USB jpgs may not exist yet.

### 7. Admin-mode gaps (ui/JS/admin.js + src-tauri/src/main.rs:404-681)
- "Done (Restart Jukebox)" → `window.location.reload()` (admin.js:304-316) re-runs `detect_admin_drive`; the USB is still connected with admin.key, so the admin screen re-triggers on every restart until the USB is unplugged. Fix: write a marker file on the USB after a successful copy (or record drive serial + copied files) and skip detection until USB contents change.
- The auto-mode 10s countdown UI is visible while the (UI-freezing) scan runs, so the displayed timer lies; start the countdown only when the scan resolves.
- The manual list renders ALL songs (new + already-present) — hundreds of rows on a big USB; default to new-only with a toggle. Rows are text-only; the USB has `img/` jpgs — show them (needs the asset scope to cover the USB path).
- No cancel and no per-file progress during copy (ties into #1: async copy + progress events).
- The admin workflow (USB + admin.key + auto/manual transfer) is undocumented in README.md.

### 8. Fixed UI elements built in JS (the "hardcode categories/scrollbars" ask)
All static, built from hardcoded data — can move into ui/index.html:
- 10 category buttons (ui/JS/songs.js:21-36) → hardcoded `<button data-key>` (click delegation already exists).
- 9 sidenav shuffle links (ui/JS/shuffle.js:100-112) → hardcoded (click delegation already exists).
- On-screen keyboard, 35 keys (ui/JS/keyboard.js:83-255) → hardcoded HTML + delegated events.
Benefits: category buttons appear before the IPC round-trip; less JS to execute at startup. The category list is a compile-time constant in Rust (src-tauri/src/songs.rs:151), so hardcoding HTML is safe — keep the Rust list as the single source of truth for scanning. Scrollbar buttons are already hardcoded HTML (ui/index.html:278-285, 309-316) — nothing to do there.

### 9. Smaller items
- `speed_test` quality is duplicated: Rust returns `quality` (main.rs:739-747) and JS re-derives it from the number (ui/JS/youtube.js:150-159) — keep one copy.
- `ui/JS/youtube.js:106-109`: `queue_lookup.has(yt_dir)` then redundant `queue_array.includes(yt_dir)` — the Set check subsumes the array check.
- The adminReady/validation/mediaBase startup gate is copy-pasted in ui/index.js:282-338 and ui/JS/songs.js:46-80 — factor into one shared `startupGate()` promise; the duplicated logic is fragile (see the interrupted-asset-page guard comments).
- `resetPlayer()` recreates `<video preload='auto'>` (ui/index.js:163) while the initial markup uses `preload='metadata'` (ui/index.html:231) — pick one (metadata is lighter on a slow disk).
- Stray `music/demo.png` at the music root.
- Debug artifacts: `jukebox-debug.log` / `jukebox-setup.log` file writes (main.rs:906-943, 1092-1120) — gate behind debug builds.
- Tests: only one exists (media_server.rs:459). Add unit tests for `scan_directory`/`scan_all_categories` and for the song-cache invalidation when the cache (#2) is built.
- README.md documents the player and admin tools but not the in-app admin transfer workflow (see #7).

### 10. Micro-optimizations & dead code (external review 2026-11-05; clippy-verified: 7 warnings)
- `get_category_definitions()` allocates a Vec per call (songs.rs:151) and is called on every IPC command → make it `const CATS: [(&str, &str, &str); 10]` (zero runtime allocation; mechanical signature change across ~6 call sites).
- Sort allocates 2 strings per comparison: `a.name.to_lowercase().cmp(...)` (songs.rs:323, main.rs:582) — clippy flags both: use `sort_by_key(|s| s.name.to_lowercase())` (one alloc per element). `cmp_ignore_ascii_case` would be zero-alloc but changes ordering for non-ASCII titles (doesn't lowercase accented chars) — avoid.
- `debug_paths` (main.rs:249-315, registered at main.rs:1156): 67 lines of debug-only code with a bug — it calls `read_dir` twice per category (line 293, then re-reads at line 297 to count). Delete it, or count on the first read.
- `is_video_file_name` (songs.rs:197) is a no-op wrapper around `is_video_file` — make the inner one `pub`, drop the wrapper.
- `get_music_base_path(_app_handle)` — the parameter is unused; drop it from the helper (it's not a command, so no IPC shape change).
- `get_app_env` (main.rs:807) re-reads/re-parses `.env` on every call — cache with `OnceLock<BTreeMap>` (the UI calls it once, but the cost is a disk read per call).
- media_server.rs:98-105: `music_dir` is canonicalized twice (once pushed into `roots`, again in the `.map()`) — build `roots` directly from the `canonicalize` result.
- main.rs:1062-1069: 3× collapsible `if let` chains in `.setup()`; main.rs:1097: `useless format!` on a constant string.
- Comment bloat (owner's call): the PHP→Rust educational comments dominate the sources — ~301 comment lines in main.rs, ~228 in songs.rs (~40% of the lines). If they serve as onboarding material, move them to a `docs/` file and keep one-line `///` docs.
- `get_music_base_path` is the fan-out choke point: one helper feeding the media server, asset scope, env loading, and every category/admin command — memoizing it (#5) fixes all of them at once.

### Reference facts
- Library: 1569 videos (~74 GB, ~45 MB average) across 10 categories; ~11 MB of jpgs per category.
- Scripts parsed on every page load: mejs 420 KB, jquery-ui 255 KB, jquery 87 KB, plus app JS (~3.5 KB each, 15 files).
- Media: local HTTP server (src-tauri/src/media_server.rs, ports 1420-1427, one thread per connection — fine for single-playback kiosk); thumbnails via asset protocol (`convertFileSrc`); UI served over `tauri-plugin-localhost` (YouTube Referer fix).
