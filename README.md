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
