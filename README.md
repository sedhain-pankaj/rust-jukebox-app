# Craig Williams JukeBox

This is a rust port of my other project `Craigs Music Player` which was bulit with PHP and JS. This is a new kiosk-style desktop jukebox application built with **Tauri** (Rust + JavaScript) with every configuration required built into a single EXE file. Browse, queue, and play music videos from a local library — organized by genre — with shuffle, search, YouTube integration, and an on-screen keyboard for touch-friendly use.

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
- **Auto-shuffle 80's** when idle (no queue, no song playing)
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
- Modal dialogs for confirmations and notices
- Text selection disabled (kiosk mode)

---

## Prerequisites

- **Rust** — Install from [https://rustup.rs](https://rustup.rs)
- **Music files** — You need your own music/video library (not included in the repo due to size). A guard is present in `main.rs` to check for the `music/` folder and prompt you to create it if missing.
- **Missing variables** - _YT_API_KEY_ from `youtube.js` needed for searching youtube and _queue_clear_passowrd_ from `delete.js` needed to clear the whole queue. Create `ui\JS\config.js` file with these variables.

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
   - **Manual** — pick individual songs (thumbnails are shown, so you can see what you're transferring).
5. The copy runs with per-file progress and a **Cancel** button. New songs are skipped if the jukebox already has them.

After a successful transfer the app writes a **`jukebox-transfer.done`** file to the USB root (one `CategoryFolder/File.ext` line per copied song). On the next startup the app sees the marker, verifies the files are present locally, and **skips admin mode** — so "Done (Restart Jukebox)" doesn't re-trigger the admin screen until the USB is unplugged. To re-run a transfer (e.g. more songs were added to the USB), delete `jukebox-transfer.done`.

Notes:
- Songs without a thumbnail are **ignored** in AUTO mode (they'd show a grey box in the player grid) and are flagged in the summary.
- The admin flow works on Windows (drive-letter detection). On Linux `detect_admin_drive` simply finds nothing, so admin mode stays dormant.

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
