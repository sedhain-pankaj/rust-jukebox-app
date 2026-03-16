# Generate Images (Standalone)

This is a tiny Rust tool that scans the `music/` folders on a USB drive and
creates missing thumbnails for each video. It replaces the old PHP script.

## What it does
- Scans all 10 music categories.
- Checks for `img/<song>.jpg` or `img/<song>.jpeg`.
- If missing, extracts a random frame from the middle of the video and saves it
  as `img/<song>.jpg`.

## Required FFmpeg files
This tool embeds FFmpeg at build time. You must place these three files in
`GenerateImage/bin/` before building:
- `ffmpeg.exe`
- `ffprobe.exe`
- `ffplay.exe` (not used directly, but keep it alongside the others)

These files are ignored by git, so you have to supply them locally.

## Build
From the `admin/GenerateImage` folder:

```powershell
cargo build --release
```

The EXE will be at:

```
admin/GenerateImage/target/release/Generate_Images.exe
```

## Run
Place `Generate_Images.exe` next to the `music/` folder on the USB drive and
double-click it.

The tool looks for `music/`:
- Next to the EXE
- Or in the EXE’s parent folder
