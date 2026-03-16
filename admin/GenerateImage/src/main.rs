use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "flv", "ogv", "webm", "avchd", "avi", "mkv", "wmv", "mpg", "mpeg",
];

const CATEGORY_FOLDERS: &[&str] = &[
    "Fifty Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
    "2000",
    "Latest Hits",
    "Country",
    "Karaoke",
    "Special Occasion",
    "Christmas Song",
];

const FFMPEG_BYTES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/ffmpeg-bin/ffmpeg.exe"
));
const FFPROBE_BYTES: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/ffmpeg-bin/ffprobe.exe"
));

fn is_video_file(filename: &str) -> bool {
    Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|&valid| valid.eq_ignore_ascii_case(ext))
        })
}

fn ensure_embedded_binary(name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("jukebox-thumbgen");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let path = dir.join(name);
    let should_write = match fs::metadata(&path) {
        Ok(meta) => meta.len() != bytes.len() as u64,
        Err(_) => true,
    };

    if should_write {
        fs::write(&path, bytes).map_err(|e| format!("Failed to write {}: {}", name, e))?;
    }

    Ok(path)
}

fn find_music_root(exe_dir: &Path) -> Option<PathBuf> {
    let direct = exe_dir.join("music");
    if direct.exists() && direct.is_dir() {
        return Some(direct);
    }
    if let Some(parent) = exe_dir.parent() {
        let parent_music = parent.join("music");
        if parent_music.exists() && parent_music.is_dir() {
            return Some(parent_music);
        }
    }
    None
}

fn probe_duration(ffprobe_path: &Path, video_path: &Path) -> Option<f64> {
    let output = Command::new(ffprobe_path)
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=1")
        .arg(video_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    stdout.parse::<f64>().ok()
}

fn middle_random_time(duration: f64) -> f64 {
    if duration <= 0.0 {
        return 0.0;
    }
    let start = duration * 0.4;
    let range = duration * 0.2;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as f64;
    let jitter = (nanos / 1_000_000_000.0) * range;
    let mut timestamp = start + jitter;
    if timestamp > duration {
        timestamp = duration * 0.9;
    }
    timestamp
}

fn generate_thumbnail(
    ffmpeg_path: &Path,
    ffprobe_path: &Path,
    video_path: &Path,
    thumb_path: &Path,
) -> Result<(), String> {
    let duration = probe_duration(ffprobe_path, video_path).unwrap_or(30.0);
    let timestamp = middle_random_time(duration);
    let timestamp_str = format!("{:.3}", timestamp);

    let output = Command::new(ffmpeg_path)
        .arg("-y")
        .arg("-ss")
        .arg(timestamp_str)
        .arg("-i")
        .arg(video_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(thumb_path)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {}", err.trim()));
    }

    Ok(())
}

fn main() {
    let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new("."));

    let Some(music_root) = find_music_root(exe_dir) else {
        eprintln!(
            "ERROR: music folder not found next to this executable or its parent.\nExpected: ./music/<Category>/img/"
        );
        std::process::exit(1);
    };

    let ffmpeg_path = ensure_embedded_binary("ffmpeg.exe", FFMPEG_BYTES).unwrap_or_else(|e| {
        eprintln!("ERROR: {}", e);
        std::process::exit(1);
    });
    let ffprobe_path = ensure_embedded_binary("ffprobe.exe", FFPROBE_BYTES).unwrap_or_else(|e| {
        eprintln!("ERROR: {}", e);
        std::process::exit(1);
    });

    println!("Music folder: {}", music_root.display());
    let mut created = 0usize;
    let mut skipped = 0usize;
    let mut errors = 0usize;

    for folder in CATEGORY_FOLDERS {
        let category_dir = music_root.join(folder);
        if !category_dir.exists() {
            eprintln!("Missing category folder: {}", category_dir.display());
            continue;
        }
        let img_dir = category_dir.join("img");
        if let Err(e) = fs::create_dir_all(&img_dir) {
            eprintln!("Failed to ensure img dir {}: {}", img_dir.display(), e);
            continue;
        }

        let entries = match fs::read_dir(&category_dir) {
            Ok(entries) => entries,
            Err(e) => {
                eprintln!("Cannot read folder {}: {}", category_dir.display(), e);
                continue;
            }
        };

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }
            let filename = entry.file_name().to_string_lossy().to_string();
            if !is_video_file(&filename) {
                continue;
            }

            let stem = Path::new(&filename)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let jpg = img_dir.join(format!("{}.jpg", stem));
            let jpeg = img_dir.join(format!("{}.jpeg", stem));
            if jpg.exists() || jpeg.exists() {
                skipped += 1;
                continue;
            }

            let video_path = category_dir.join(&filename);
            match generate_thumbnail(&ffmpeg_path, &ffprobe_path, &video_path, &jpg) {
                Ok(_) => {
                    created += 1;
                    println!("Generated: {}", jpg.display());
                }
                Err(e) => {
                    errors += 1;
                    eprintln!("Error on {}: {}", video_path.display(), e);
                }
            }
        }
    }

    println!();
    println!(
        "Done. Created: {} | Skipped: {} | Errors: {}",
        created, skipped, errors
    );
    println!("Press Enter to exit.");
    let mut input = String::new();
    let _ = std::io::stdin().read_line(&mut input);
}
