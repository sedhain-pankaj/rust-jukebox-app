// =============================================================================
// src/main.rs — The Entry Point of Our Application
// =============================================================================
//
// This is the equivalent of index.php — it's the first thing that runs
// when you double-click rust-jukebox-app.exe.
//
// In PHP, the web server (Apache) calls your index.php for every request.
// In Rust + Tauri, this main() function runs ONCE when the app starts.
// It sets up a native window, loads your HTML/CSS/JS into it, and then
// sits there handling events (button clicks, song plays, etc.) until
// the user closes the window.
//
// =============================================================================
//
// RUST BASICS — Quick Reference (read this first!)
// -------------------------------------------------
//
// 1. VARIABLES:
//    In PHP:    $name = "Craig";
//    In Rust:   let name = "Craig";
//    By default, Rust variables are IMMUTABLE (can't be changed).
//    To make them changeable:  let mut name = "Craig";
//
// 2. FUNCTIONS:
//    In PHP:    function greet($name) { return "Hello " . $name; }
//    In Rust:   fn greet(name: &str) -> String { format!("Hello {}", name) }
//    Notice: Rust requires you to declare types. &str means "a reference
//    to a string" (like a read-only view). String means "an owned string"
//    (like a variable you can modify).
//
// 3. NO NULL:
//    Rust doesn't have null. Instead it uses Option<T> which is either:
//      Some(value)  — the value exists
//      None         — no value (like null, but the compiler FORCES you
//                     to handle the None case, preventing null pointer errors)
//
// 4. ERROR HANDLING:
//    Rust doesn't have try/catch. Instead functions return Result<T, E>:
//      Ok(value)    — success
//      Err(error)   — failure
//    The compiler forces you to handle errors. No more silent failures.
//
// 5. MACROS:
//    Things ending with ! like println!() are macros (code that generates
//    code at compile time). Don't worry about how they work internally —
//    just use them like regular functions for now.
//
// =============================================================================

// -----------------------------------------------------------------------------
// These lines are like PHP's "use" or JavaScript's "import".
// They bring specific items from the Tauri library into scope so we can use them.
// -----------------------------------------------------------------------------

// This is a special Rust attribute that tells the compiler:
// "On Windows, don't show a console/terminal window behind the app."
// Without this, you'd see a black command prompt window alongside your GUI.
// (Only applies to release builds — debug builds still show the console
// so you can see println! output for debugging.)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// -----------------------------------------------------------------------------
// MODULE DECLARATION
// -----------------------------------------------------------------------------
// `mod songs;` tells Rust: "there's a file called songs.rs in this folder,
// include it as a module." This is like PHP's include 'logic.php';
//
// After this line, we can use songs::Song, songs::Category, etc.
mod songs;

// In-process song library cache (primed in .setup(), see song_cache.rs).
mod song_cache;

// The local HTTP media server (see media_server.rs for why it exists:
// the <video> element on Linux can't play asset:// URLs).
mod media_server;

// Import types from our songs module so we don't have to write
// songs::Song, songs::Category everywhere.
use songs::{Category, Song};

// Import Path for filesystem path operations
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::OnceLock;

// The port the media server bound to (set in .setup(), read by the
// get_media_server_port IPC command the frontend uses to build its URLs).
static MEDIA_PORT_USED: AtomicU16 = AtomicU16::new(0);

// -----------------------------------------------------------------------------
// term_log() — terminal logging with blank-line separators
// -----------------------------------------------------------------------------
// ALL app terminal output goes through this. A blank line is printed before
// EVERY log line (except the very first line of the process), so entries
// never run together in the terminal — no matter how fast they arrive.
static TERM_LOG_STARTED: AtomicBool = AtomicBool::new(false);

pub(crate) fn term_log(message: &str) {
    // Exactly one caller wins the "first line" race (no leading gap);
    // everyone else gets a leading blank line.
    let first = TERM_LOG_STARTED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok();
    if !first {
        eprintln!();
    }
    eprintln!("{}", message);
}

// Import the Manager trait — this gives us access to methods like
// .asset_protocol_scope() on the AppHandle. Without this import,
// Rust wouldn't know those methods exist (traits must be "in scope").
use tauri::Manager;
// The Listener trait gives us .listen() so we can forward JS console/mejs
// errors into THIS terminal (the one running `cargo tauri dev`).
use tauri::Listener;
// The Emitter trait gives us .emit() (per-file admin copy progress events).
use tauri::Emitter;
#[derive(serde::Serialize)]
struct MusicStructureValidation {
    valid: bool,
    base_path: String,
    music_path: String,
    expected_folders: Vec<String>,
    errors: Vec<String>,
    warnings: Vec<String>,
}

#[derive(serde::Serialize)]
struct AdminDriveDetection {
    found: bool,
    root_path: String,
    music_path: String,
    reason: String,
}

#[derive(serde::Serialize)]
struct AdminFolderSummary {
    folder: String,
    label: String,
    new_with_thumbs: usize,
    new_missing_thumbs: usize,
    /// Videos on the USB that this jukebox already has locally.
    existing: usize,
}

#[derive(serde::Serialize)]
struct AdminSongEntry {
    folder: String,
    label: String,
    name: String,
    filename: String,
    video_rel: String,
    thumbnail_rel: String,
    is_new: bool,
    has_thumbnail: bool,
    is_selectable: bool,
}

#[derive(serde::Serialize)]
struct AdminFolderSongs {
    folder: String,
    label: String,
    songs: Vec<AdminSongEntry>,
}

#[derive(serde::Serialize)]
struct AdminUsbScanResult {
    valid_structure: bool,
    errors: Vec<String>,
    per_folder_counts: Vec<AdminFolderSummary>,
    songs_by_folder: Vec<AdminFolderSongs>,
}

#[derive(serde::Deserialize)]
struct AdminCopySelection {
    folder: String,
    filename: String,
    thumbnail_filename: String,
}

#[derive(serde::Serialize)]
struct AdminCopyResult {
    copied: usize,
    skipped: usize,
    errors: Vec<String>,
}

// =============================================================================
// TAURI IPC COMMANDS
// =============================================================================
//
// These are the functions that JavaScript can call from the frontend.
//
// In your old PHP app, the frontend made AJAX requests:
//   $.ajax({ type: "GET", url: "logic.php", data: "5060" })
//
// In Tauri, the frontend calls Rust functions directly:
//   const categories = await invoke("get_all_categories");
//
// The #[tauri::command] attribute is a macro that:
//   1. Makes the function callable from JavaScript via invoke()
//   2. Automatically serializes the return value to JSON
//   3. Automatically deserializes any arguments from JSON
//
// Think of each command as a PHP endpoint, but instead of HTTP,
// communication happens through an internal bridge (IPC = Inter-Process
// Communication). It's faster than HTTP because there's no network involved.
// =============================================================================

/// Returns all categories with their songs.
///
/// Called once on frontend startup to populate the cache.
/// Replaces the 10 separate AJAX calls in songs.js that each hit logic.php.
///
/// JavaScript usage:
///   const categories = await window.__TAURI__.core.invoke("get_all_categories");
///   // categories = [{ key: "5060", label: "50's + 60's", songs: [...] }, ...]
#[tauri::command]
fn get_all_categories() -> Vec<Category> {
    // Served from the pre-scan cache (primed in .setup()); the 10 directory
    // mtime/size freshness checks (cheap metadata calls, no directory reads)
    // are TTL-gated inside the cache (see song_cache::FRESHNESS_TTL).
    let base_path = get_music_base_path();
    let categories = song_cache::categories(&base_path);

    // Log how many songs were found (visible in debug console)
    let total_songs: usize = categories.iter().map(|c| c.songs.len()).sum();
    term_log(&format!(
        "Loaded {} categories with {} total songs from: {:?}",
        categories.len(),
        total_songs,
        base_path
    ));

    // Log per-category counts for debugging
    for cat in &categories {
        term_log(&format!(
            "  {} ({}): {} songs | dir: {:?}",
            cat.key,
            cat.label,
            cat.songs.len(),
            base_path.join(&cat.dir)
        ));
    }

    categories
}

#[tauri::command]
fn validate_music_structure() -> MusicStructureValidation {
    let base_path = get_music_base_path();
    let music_path = base_path.join("music");
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let expected_folders: Vec<String> = songs::CATS
        .iter()
        .filter_map(|(_, _, dir)| {
            dir.trim_matches('/')
                .split('/')
                .nth(1)
                .map(|name| name.to_string())
        })
        .collect();

    if !music_path.exists() {
        errors.push(format!("Missing music folder: {}", music_path.display()));
    } else if !music_path.is_dir() {
        errors.push(format!(
            "music exists but is not a directory: {}",
            music_path.display()
        ));
    }

    let mut actual_folder_set: HashSet<String> = HashSet::new();
    if errors.is_empty() {
        match std::fs::read_dir(&music_path) {
            Ok(entries) => {
                for entry in entries.flatten() {
                    let Ok(file_type) = entry.file_type() else {
                        continue;
                    };
                    if file_type.is_dir() {
                        actual_folder_set.insert(entry.file_name().to_string_lossy().to_string());
                    }
                }
            }
            Err(e) => {
                errors.push(format!(
                    "Cannot read music folder '{}': {}",
                    music_path.display(),
                    e
                ));
            }
        }
    }

    let expected_folder_set: HashSet<String> = expected_folders.iter().cloned().collect();

    for folder in &expected_folders {
        if !actual_folder_set.contains(folder) {
            errors.push(format!("Missing category folder: music/{}", folder));
            continue;
        }

        let img_path = music_path.join(folder).join("img");
        if !img_path.exists() {
            errors.push(format!("Missing img folder: music/{}/img", folder));
        } else if !img_path.is_dir() {
            errors.push(format!(
                "img exists but is not a directory: music/{}/img",
                folder
            ));
        }
    }

    for folder in &actual_folder_set {
        if !expected_folder_set.contains(folder) {
            warnings.push(format!("Unexpected folder found in music/: {}", folder));
        }
    }

    let valid = errors.is_empty();

    MusicStructureValidation {
        valid,
        base_path: base_path.to_string_lossy().replace('\\', "/"),
        music_path: music_path.to_string_lossy().replace('\\', "/"),
        expected_folders,
        errors,
        warnings,
    }
}

/// USB root candidates. Windows (the target platform): drive letters D:\–Z:\.
/// Linux: udisks2 mounts — /run/media/<user>/<name>, /media/..., /mnt/... —
/// checked at both the <base>/<name> and <base>/<user>/<name> levels.
fn usb_candidate_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        ('D'..='Z')
            .map(|l| PathBuf::from(format!("{l}:\\")))
            .filter(|p| p.is_dir())
            .collect()
    }
    #[cfg(not(windows))]
    {
        let mut out: Vec<PathBuf> = Vec::new();
        for base in [
            PathBuf::from("/run/media"),
            PathBuf::from("/media"),
            PathBuf::from("/mnt"),
        ] {
            let entries = match fs::read_dir(&base) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_dir() {
                    continue;
                }
                if let Ok(sub) = fs::read_dir(&p) {
                    out.extend(sub.flatten().map(|e| e.path()).filter(|sp| sp.is_dir()));
                }
                out.push(p);
            }
        }
        out
    }
}

// Detection is deliberately stateless: admin.key on any USB root is all it
// takes to offer admin mode. No per-machine "already transferred" record —
// the admin screen itself shows the state ("N new songs, M existing"), and
// a still-connected drive re-offering the screen after a restart is a
// feature (it confirms the drive is fully in sync). That keeps the same
// USB usable on any jukebox without writing files on the machines.
#[tauri::command]
fn detect_admin_drive() -> AdminDriveDetection {
    let reason = String::from("admin.key not found on any drive.");

    for root in usb_candidate_roots() {
        if !root.join("admin.key").exists() {
            continue;
        }

        let music_path = root.join("music");
        return AdminDriveDetection {
            found: true,
            root_path: root.to_string_lossy().replace('\\', "/"),
            music_path: music_path.to_string_lossy().replace('\\', "/"),
            reason: String::new(),
        };
    }

    AdminDriveDetection {
        found: false,
        root_path: String::new(),
        music_path: String::new(),
        reason,
    }
}

/// Async wrapper: the USB scan (10 read_dir passes + 2 stat calls per video
/// over a slow USB stick) runs on a blocking thread so the UI event loop
/// stays responsive while it runs (sync Tauri commands block the main
/// thread — the admin screen would freeze for the whole scan).
#[tauri::command]
async fn scan_admin_usb(music_path: String) -> AdminUsbScanResult {
    let base = get_music_base_path();
    tauri::async_runtime::spawn_blocking(move || {
        scan_admin_usb_impl(&PathBuf::from(&music_path), &base)
    })
    .await
    .unwrap_or(AdminUsbScanResult {
        valid_structure: false,
        errors: vec!["USB scan task failed".into()],
        per_folder_counts: Vec::new(),
        songs_by_folder: Vec::new(),
    })
}

fn scan_admin_usb_impl(usb_music: &Path, base: &Path) -> AdminUsbScanResult {
    let mut errors: Vec<String> = Vec::new();

    if !usb_music.exists() {
        errors.push(format!("Missing USB music folder: {}", usb_music.display()));
    } else if !usb_music.is_dir() {
        errors.push(format!(
            "USB music path is not a directory: {}",
            usb_music.display()
        ));
    }

    if errors.is_empty() {
        for (_, _, dir) in songs::CATS {
            let Some(folder_name) = folder_name_from_dir(dir) else {
                continue;
            };
            let folder_path = usb_music.join(&folder_name);
            if !folder_path.exists() {
                errors.push(format!(
                    "Missing category folder on USB: {}/{}",
                    usb_music.display(),
                    folder_name
                ));
                continue;
            }
            if !folder_path.is_dir() {
                errors.push(format!(
                    "Category path is not a directory on USB: {}",
                    folder_path.display()
                ));
                continue;
            }
            let img_path = folder_path.join("img");
            if !img_path.exists() {
                errors.push(format!(
                    "Missing img folder on USB: {}/img",
                    folder_path.display()
                ));
            } else if !img_path.is_dir() {
                errors.push(format!(
                    "img path is not a directory on USB: {}",
                    img_path.display()
                ));
            }
        }
    }

    let mut per_folder_counts: Vec<AdminFolderSummary> = Vec::new();
    let mut songs_by_folder: Vec<AdminFolderSongs> = Vec::new();

    if !errors.is_empty() {
        return AdminUsbScanResult {
            valid_structure: false,
            errors,
            per_folder_counts,
            songs_by_folder,
        };
    }

    let local_music = base.join("music");

    for (_, label, dir) in songs::CATS {
        let folder_name = folder_name_from_dir(dir).unwrap_or_else(|| label.to_string());
        let usb_folder = usb_music.join(&folder_name);
        let local_folder = local_music.join(&folder_name);
        let local_stems = collect_video_stems(&local_folder);

        let entries = match fs::read_dir(&usb_folder) {
            Ok(entries) => entries,
            Err(e) => {
                errors.push(format!(
                    "Cannot read USB folder {}: {}",
                    usb_folder.display(),
                    e
                ));
                continue;
            }
        };

        let mut songs: Vec<AdminSongEntry> = Vec::new();
        let mut new_with_thumbs: usize = 0;
        let mut new_missing_thumbs: usize = 0;
        let mut existing: usize = 0;

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }
            let filename = entry.file_name().to_string_lossy().to_string();
            if !songs::is_video_file(&filename) {
                continue;
            }
            let name = Path::new(&filename)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            let stem_key = name.to_lowercase();
            let is_new = !local_stems.contains(&stem_key);

            let mut thumbnail_filename = String::new();
            for ext in ["jpg", "jpeg"] {
                let candidate = usb_folder
                    .join("img")
                    .join(format!("{}.{}", name, ext));
                if candidate.exists() {
                    thumbnail_filename = format!("{}.{}", name, ext);
                    break;
                }
            }

            let has_thumbnail = !thumbnail_filename.is_empty();
            let is_selectable = is_new && has_thumbnail;

            if is_new {
                if has_thumbnail {
                    new_with_thumbs += 1;
                } else {
                    new_missing_thumbs += 1;
                }
            } else {
                existing += 1;
            }

            let video_rel = format!("{}/{}", folder_name, filename);
            let thumbnail_rel = if has_thumbnail {
                format!("{}/img/{}", folder_name, thumbnail_filename)
            } else {
                String::new()
            };

            songs.push(AdminSongEntry {
                folder: folder_name.clone(),
                label: label.to_string(),
                name,
                filename,
                video_rel,
                thumbnail_rel,
                is_new,
                has_thumbnail,
                is_selectable,
            });
        }

        // sort_by_key: one lowercase alloc per element (not two per
        // comparison) — see the same fix in songs.rs scan_directory.
        songs.sort_by_key(|s| s.name.to_lowercase());

        per_folder_counts.push(AdminFolderSummary {
            folder: folder_name.clone(),
            label: label.to_string(),
            new_with_thumbs,
            new_missing_thumbs,
            existing,
        });

        songs_by_folder.push(AdminFolderSongs {
            folder: folder_name,
            label: label.to_string(),
            songs,
        });
    }

    AdminUsbScanResult {
        valid_structure: errors.is_empty(),
        errors,
        per_folder_counts,
        songs_by_folder,
    }
}

/// Set by the cancel_admin_copy command; checked between files.
static COPY_CANCELLED: AtomicBool = AtomicBool::new(false);

/// Per-file progress payload for the "admin-copy-progress" event.
#[derive(serde::Serialize, Clone)]
struct AdminCopyProgress {
    done: usize,
    total: usize,
    filename: String,
}

/// Async wrapper: copying gigabytes with blocking fs::copy used to freeze the
/// UI event loop for the entire transfer (sync Tauri commands run on the
/// main thread) — the progress modal couldn't even animate. Now the copy
/// runs on a blocking thread and emits per-file progress events.
#[tauri::command]
async fn copy_admin_songs(
    music_path: String,
    selections: Vec<AdminCopySelection>,
    app_handle: tauri::AppHandle,
) -> AdminCopyResult {
    let base = get_music_base_path();
    COPY_CANCELLED.store(false, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        copy_admin_songs_impl(&music_path, &base, &selections, &app_handle)
    })
    .await
    .unwrap_or(AdminCopyResult {
        copied: 0,
        skipped: 0,
        errors: vec!["Copy task failed".into()],
    })
}

fn copy_admin_songs_impl(
    music_path: &str,
    base: &Path,
    selections: &[AdminCopySelection],
    app_handle: &tauri::AppHandle,
) -> AdminCopyResult {
    let usb_music = PathBuf::from(music_path);
    let local_music = base.join("music");

    let mut copied: usize = 0;
    let mut skipped: usize = 0;
    let mut errors: Vec<String> = Vec::new();
    let total = selections.len();

    for (i, selection) in selections.iter().enumerate() {
        if COPY_CANCELLED.load(Ordering::SeqCst) {
            errors.push(format!(
                "Cancelled by user after {i} of {total} songs"
            ));
            break;
        }
        // Per-file progress for the admin modal (never fatal if it fails).
        let _ = app_handle.emit(
            "admin-copy-progress",
            AdminCopyProgress {
                done: i,
                total,
                filename: selection.filename.clone(),
            },
        );

        let src_video = usb_music.join(&selection.folder).join(&selection.filename);
        let dest_video = local_music.join(&selection.folder).join(&selection.filename);

        if dest_video.exists() {
            skipped += 1;
            continue;
        }

        if let Some(parent) = dest_video.parent() {
            let _ = fs::create_dir_all(parent);
        }

        match fs::copy(&src_video, &dest_video) {
            Ok(_) => copied += 1,
            Err(e) => {
                errors.push(format!(
                    "Failed to copy video {}: {}",
                    src_video.display(),
                    e
                ));
                continue;
            }
        }

        if selection.thumbnail_filename.is_empty() {
            errors.push(format!(
                "Missing thumbnail filename for {}",
                selection.filename
            ));
            continue;
        }

        let src_thumb = usb_music
            .join(&selection.folder)
            .join("img")
            .join(&selection.thumbnail_filename);
        let dest_thumb = local_music
            .join(&selection.folder)
            .join("img")
            .join(&selection.thumbnail_filename);

        if let Some(parent) = dest_thumb.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Err(e) = fs::copy(&src_thumb, &dest_thumb) {
            errors.push(format!(
                "Failed to copy thumbnail {}: {}",
                src_thumb.display(),
                e
            ));
        }
    }

    // The library changed — refresh the pre-scan cache so the new songs
    // are visible without a full app restart.
    song_cache::refresh(base);

    AdminCopyResult {
        copied,
        skipped,
        errors,
    }
}

/// Cancels a running admin copy (checked between files).
#[tauri::command]
fn cancel_admin_copy() {
    COPY_CANCELLED.store(true, Ordering::SeqCst);
}

/// Re-scans the song library from disk (public refresh entry point).
/// Async + spawn_blocking: the scan is 10 read_dir passes over the 74 GB
/// music tree — running it on the main IPC thread would freeze the UI
/// while it runs (backlog #2).
#[tauri::command]
async fn refresh_song_cache() -> Result<Vec<Category>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let base = get_music_base_path();
        Ok(song_cache::refresh(&base))
    })
    .await
    .map_err(|e| format!("refresh task failed: {e}"))?
}

/// Adds an admin USB music directory to the asset protocol scope at runtime,
/// so the manual list can show the USB's img/ thumbnails via convertFileSrc.
#[tauri::command]
fn admin_grant_usb_scope(music_path: String, app_handle: tauri::AppHandle) {
    let path = PathBuf::from(&music_path);
    let scope = app_handle.asset_protocol_scope();
    if let Err(e) = scope.allow_directory(&path, true) {
        term_log(&format!(
            "Warning: could not add USB music dir {:?} to asset scope: {e}",
            path
        ));
    }
    if let Ok(canonical) = fs::canonicalize(&path) {
        let _ = scope.allow_directory(&canonical, true);
    }
}
/// Returns songs for a single category by key.
///
/// JavaScript usage:
///   const songs = await window.__TAURI__.core.invoke("get_songs_by_category", { key: "80" });
///   // songs = [{ name: "Bohemian Rhapsody", path: "music/Eighty/...", ... }, ...]
#[tauri::command]
fn get_songs_by_category(key: String) -> Vec<Song> {
    let base_path = get_music_base_path();
    // songs_for() clones ONE category's Vec (~1/10 of the whole-library
    // copy the old categories() path made per call) — backlog #1.
    match song_cache::songs_for(&base_path, &key) {
        Some(songs) => songs,
        None => {
            term_log(&format!("Unknown category key: {key}"));
            Vec::new()
        }
    }
}

/// One shuffle entry: the media-server target path plus the display name,
/// pre-escaped in Rust (the JS used to re-derive the name from the URL —
/// decodeURIComponent + strip extension — which is now done once here).
#[derive(serde::Serialize)]
struct ShuffleSong {
    path_abs: String,
    name_escaped: String,
}

/// Returns shuffled entries (path + pre-escaped name) for a category
/// (used by shuffle/randomizer).
///
/// Replaces the PHP shuffle_img_video_loader() that returned paths
/// separated by <br>. Now returns a clean JSON array of entries.
///
/// JavaScript usage:
///   const songs = await window.__TAURI__.core.invoke("get_shuffle_paths", { key: "80" });
///   // songs = [{ path_abs: "C:/.../music/Eighty/song1.mp4", name_escaped: "Song 1" }, ...]
#[tauri::command]
fn get_shuffle_paths(key: String) -> Vec<ShuffleSong> {
    let base_path = get_music_base_path();
    // songs_for() — one category's clone instead of all 10 (backlog #1).
    match song_cache::songs_for(&base_path, &key) {
        Some(songs) => songs
            .into_iter()
            .map(|s| ShuffleSong {
                path_abs: s.path_abs,
                name_escaped: s.name_escaped,
            })
            .collect(),
        None => {
            term_log(&format!("Unknown category key: {key}"));
            Vec::new()
        }
    }
}

/// One YouTube search result. `title_html` is pre-escaped in Rust so the
/// frontend can inject it directly into the DOM (same policy as
/// Song.name_escaped).
#[derive(serde::Serialize)]
struct YouTubeSearchItem {
    video_id: String,
    title_html: String,
    thumbnail: String,
}

#[derive(serde::Serialize)]
struct YouTubeSearchResult {
    items: Vec<YouTubeSearchItem>,
}

/// YouTube search executed in Rust (backlog: reduce JS computation,
/// move work to Rust over IPC). Replaces the $.ajax call that built the
/// Google API URL by string concatenation — a query containing `&`, `#`
/// or `+` silently corrupted it. reqwest percent-encodes every query
/// parameter, and the API key stays in Rust (read from .env) instead of
/// being shipped to the webview via get_app_env.
#[tauri::command]
async fn youtube_search(query: String) -> Result<YouTubeSearchResult, String> {
    tauri::async_runtime::spawn_blocking(move || youtube_search_impl(&query))
        .await
        .map_err(|e| format!("youtube search task failed: {e}"))?
}

fn youtube_search_impl(query: &str) -> Result<YouTubeSearchResult, String> {
    let started = std::time::Instant::now();
    let key = APP_ENV
        .get_or_init(load_app_env)
        .get("YT_API_KEY")
        .map(|s| s.as_str())
        .unwrap_or("");
    if key.is_empty() {
        return Err(
            "YT_API_KEY is not set in .env — YouTube search is disabled".into(),
        );
    }

    // query() percent-encodes each parameter value (the old JS
    // concatenation did not — see the doc comment above).
    let response = reqwest::blocking::Client::new()
        .get("https://www.googleapis.com/youtube/v3/search")
        .query(&[
            ("part", "snippet"),
            ("q", query),
            ("type", "video"),
            ("videoEmbeddable", "true"),
            ("maxResults", "10"),
            ("key", key),
        ])
        .send()
        .map_err(|e| format!("YouTube search request failed: {e}"))?;

    let status = response.status();
    // text() + from_str: the reqwest "json" feature is not enabled, and
    // the speed test already uses the text()/bytes() style.
    let body: serde_json::Value = serde_json::from_str(
        &response
            .text()
            .map_err(|e| format!("YouTube search response read failed: {e}"))?,
    )
    .map_err(|e| format!("YouTube search response is not JSON: {e}"))?;

    if status != reqwest::StatusCode::OK {
        let message = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(format!("YouTube search failed ({status}): {message}"));
    }

    let mut items = Vec::new();
    if let Some(list) = body.get("items").and_then(|i| i.as_array()) {
        for item in list {
            let video_id = item
                .get("id")
                .and_then(|v| v.get("videoId"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let title = item
                .get("snippet")
                .and_then(|s| s.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            let thumbnail = item
                .get("snippet")
                .and_then(|s| s.get("thumbnails"))
                .and_then(|t| t.get("default"))
                .and_then(|t| t.get("url"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            items.push(YouTubeSearchItem {
                video_id,
                title_html: songs::escape_html(title),
                thumbnail,
            });
        }
    }

    term_log(&format!(
        "YouTube search '{query}' -> {} results in {} ms",
        items.len(),
        started.elapsed().as_millis()
    ));
    Ok(YouTubeSearchResult { items })
}

/// Native internet speed test.
/// Downloads a large file and measures throughput in Mbps.
/// Runs in Rust (outside WebView) so no CSP restrictions apply.
///
/// Async wrapper: the blocking download used to run on the main thread —
/// the whole UI froze for the entire transfer (seconds–minutes on a slow
/// line). Now it runs on a blocking thread.
#[tauri::command]
async fn speed_test() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(speed_test_impl)
        .await
        .map_err(|e| format!("speed test task failed: {e}"))?
}

fn speed_test_impl() -> Result<serde_json::Value, String> {
    // Cloudflare's speed test endpoint — purpose-built for speed testing.
    // Downloads 10MB of data. No burden on open-source infrastructure.
    let url = "https://speed.cloudflare.com/__down?bytes=10000000";

    let start = std::time::Instant::now();
    let response = reqwest::blocking::get(url).map_err(|e| e.to_string())?;
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    let duration = start.elapsed().as_secs_f64();

    let bits = bytes.len() as f64 * 8.0;
    let speed_mbps = bits / duration / 1_048_576.0;

    // quality + icon share one set of thresholds — the single source of
    // truth (the JS used to re-derive the same breakpoints).
    let (quality, icon) = if speed_mbps >= 5.0 {
        ("Excellent for YouTube", "verified")
    } else if speed_mbps >= 2.0 {
        ("Good for YouTube", "verified")
    } else if speed_mbps >= 0.5 {
        ("May buffer on YouTube", "warning")
    } else {
        ("Too slow for YouTube", "error")
    };

    Ok(serde_json::json!({
        "speed_mbps": format!("{:.2}", speed_mbps),
        "quality": quality,
        "icon": icon
    }))
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

fn folder_name_from_dir(dir: &str) -> Option<String> {
    dir.trim_matches('/')
        .split('/')
        .nth(1)
        .map(|name| name.to_string())
}

fn collect_video_stems(dir: &Path) -> HashSet<String> {
    let mut stems: HashSet<String> = HashSet::new();
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return stems,
    };

    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let filename = entry.file_name().to_string_lossy().to_string();
        if !songs::is_video_file(&filename) {
            continue;
        }
        let name = Path::new(&filename)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        stems.insert(name.to_lowercase());
    }

    stems
}

/// The port the media server bound to (0 if it failed to start).
/// The frontend calls this once at startup to build its media URLs.
#[tauri::command]
fn get_media_server_port() -> u16 {
    MEDIA_PORT_USED.load(Ordering::Relaxed)
}

/// KEY=VALUE pairs from the app's .env file (next to the music/ directory,
/// falling back to the current directory). config.js uses this to fetch
/// the queue-clear password that is no longer hardcoded in the tracked
/// config.js.
///
/// Parsed once per process (OnceLock) — was a disk read + re-parse on every
/// call. Changing the .env requires an app restart (acceptable: it is a
/// startup config file).
static APP_ENV: OnceLock<std::collections::BTreeMap<String, String>> = OnceLock::new();

#[tauri::command]
fn get_app_env() -> std::collections::BTreeMap<String, String> {
    let mut env = APP_ENV.get_or_init(load_app_env).clone();
    // The YouTube API key is consumed by the Rust-side youtube_search
    // command — keep it out of the webview (it used to be shipped here).
    env.remove("YT_API_KEY");
    env
}

fn load_app_env() -> std::collections::BTreeMap<String, String> {
    let candidates = vec![
        get_music_base_path().join(".env"),
        std::env::current_dir()
            .map(|cwd| cwd.join(".env"))
            .unwrap_or_default(),
    ];

    for path in &candidates {
        if let Ok(contents) = std::fs::read_to_string(path) {
            let mut env = std::collections::BTreeMap::new();
            for line in contents.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                if let Some((k, v)) = line.split_once('=') {
                    let k = k.trim();
                    let mut v = v.trim();
                    // Strip matching surrounding quotes, if present.
                    if v.len() >= 2
                        && ((v.starts_with('"') && v.ends_with('"'))
                            || (v.starts_with('\'') && v.ends_with('\'')))
                    {
                        v = &v[1..v.len() - 1];
                    }
                    if !k.is_empty() {
                        env.insert(k.to_string(), v.to_string());
                    }
                }
            }
            term_log(&format!(
                "[pid {}] Loaded {} key(s) from .env ({:?})",
                std::process::id(),
                env.len(),
                path
            ));
            return env;
        }
    }

    term_log("Warning: no .env file found — YT_API_KEY / QUEUE_CLEAR_PASSWORD will be empty");
    std::collections::BTreeMap::new()
}

/// A free port for tauri-plugin-localhost, which serves the app's own UI
/// over http://localhost:<port> (see the .plugin(...) + set_url below).
///
/// WHY: YouTube's IFrame Player API refuses to play (error 153, "the
/// request does not include the HTTP Referer header or equivalent API
/// Client identification") when the embedding page's origin is the
/// tauri.localhost / tauri:// protocol — the page can't identify itself
/// to YouTube. Serving the app over a real http://localhost origin gives
/// the page a valid Referer, so YouTube embeds play again.
///
/// Tries 1428-1435 (just after the media server's 1420-1427 candidates),
/// falls back to an OS-assigned port. The port is probed here because the
/// plugin's server panics if the port is taken.
fn pick_localhost_port() -> u16 {
    for port in 1428..=1435 {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:0") {
        return listener.local_addr().unwrap().port();
    }
    1428
}

/// The base path where the music/ folder lives, detected ONCE per process.
///
/// In development: the workspace root (Craigs-Music-Player/rust-jukebox-app/)
/// In production: the directory containing rust-jukebox-app.exe
///
/// This is important because all song paths are relative:
///   base_path/music/Eighty/song.mp4
///
/// Memoized in a OnceLock: the answer never changes per process, and the
/// detection (candidate walk + stat calls) used to run on EVERY IPC command
/// — a real cost on slow hardware. This helper feeds the media server, the
/// asset scope, env loading, and every category/admin command, so caching it
/// fixes all of them at once.
static MUSIC_BASE_PATH: OnceLock<PathBuf> = OnceLock::new();

fn get_music_base_path() -> PathBuf {
    MUSIC_BASE_PATH.get_or_init(detect_music_base_path).clone()
}

fn detect_music_base_path() -> PathBuf {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe_path) = std::env::current_exe() {
        let mut dir = exe_path.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            if let Some(d) = dir {
                candidates.push(d.clone());
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.clone());
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for candidate in &candidates {
        let music_check = candidate.join("music");
        if music_check.is_dir() {
            term_log(&format!(
                "[pid {}] Found music/ directory at: {:?}",
                std::process::id(),
                candidate
            ));
            return candidate.clone();
        }
    }

    // Debug builds: write the search trail to a file so we can see what
    // happened even when the console is hidden by the fullscreen window.
    // Release builds: no per-call temp-file writes (was a disk write on
    // every IPC call before the OnceLock memoization).
    #[cfg(debug_assertions)]
    {
        let log_path = std::env::temp_dir().join("jukebox-debug.log");
        let mut log = String::new();
        log.push_str("=== Jukebox Path Debug ===\n");
        for candidate in &candidates {
            let music_check = candidate.join("music");
            log.push_str(&format!(
                "Checking: {:?}/music/ => exists={}, is_dir={}\n",
                candidate,
                music_check.exists(),
                music_check.is_dir()
            ));
        }
        log.push_str("ERROR: music/ not found anywhere!\n");
        let _ = std::fs::write(&log_path, &log);
    }

    term_log("ERROR: Could not find music/ directory!");
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn main() {
    // =========================================================================
    // APPLICATION STARTUP
    // =========================================================================
    // This is where we configure and launch the Tauri application.
    //
    // The "Builder" pattern is common in Rust. Instead of passing 20 arguments
    // to a constructor (like a massive PHP __construct), you chain method calls:
    //    Builder::new()
    //        .setting_a(value)
    //        .setting_b(value)
    //        .build();
    //
    // Each .method() call returns the builder back, so you can keep chaining.
    // The final .run() actually starts the application.
    // =========================================================================

    let localhost_port = pick_localhost_port();

    tauri::Builder::default()
        // -----------------------------------------------------------------
        // .plugin(tauri_plugin_localhost) — Serve the UI over real HTTP
        // -----------------------------------------------------------------
        // Serves the embedded UI (frontendDist) at http://localhost:<port>.
        // The main window is pointed at that URL in .setup() (see set_url
        // below) so the page's origin is a real HTTP origin instead of
        // tauri.localhost — required for YouTube IFrame embeds (error 153).
        // -----------------------------------------------------------------
        .plugin(tauri_plugin_localhost::Builder::new(localhost_port).build())
        // -----------------------------------------------------------------
        // .setup() — Run code once after the app is initialized
        // -----------------------------------------------------------------
        // This runs AFTER Tauri creates the window but BEFORE JS is loaded.
        // We use it to add the music/ directory to the asset protocol scope.
        //
        // WHY THIS IS NEEDED:
        // The music/ directory uses a junction (Windows symlink for folders)
        // that points from rust-jukebox-app/music/ → ../music/. When Tauri's
        // asset protocol tries to serve a file, it canonicalizes the path
        // (resolves junctions/symlinks to the real location). The canonical
        // path is OUTSIDE rust-jukebox-app/, so the static asset scope
        // (deliberately EMPTY in tauri.conf.json — nothing is allowed
        // statically; the whole filesystem must not be readable through
        // asset://) would not match it. By explicitly adding the music
        // directory (junction + canonical form) to the scope at runtime,
        // we tell Tauri "these paths are allowed". The USB admin scope is
        // granted the same way (admin_grant_usb_scope) when a USB is
        // inserted.
        // -----------------------------------------------------------------
        .setup(move |app| {
            // Find the music directory (memoized — IPC commands share this)
            let base_path = get_music_base_path();
            let music_dir = base_path.join("music");

            // Get the asset protocol scope so we can add allowed directories
            let scope = app.asset_protocol_scope();

            // Allow the junction path (rust-jukebox-app/music/)
            if let Err(e) = scope.allow_directory(&music_dir, true) {
                term_log(&format!(
                    "Warning: Failed to add music dir to asset scope: {:?}",
                    e
                ));
            } else {
                term_log(&format!(
                    "Added to asset scope (junction): {:?}",
                    music_dir
                ));
            }

            // Also allow the CANONICAL path (resolves the junction to the real location)
            // This is the path Tauri's scope check will canonicalize to,
            // so it MUST be in the allowed patterns.
            if let Ok(canonical) = std::fs::canonicalize(&music_dir) {
                if let Err(e) = scope.allow_directory(&canonical, true) {
                    term_log(&format!(
                        "Warning: Failed to add canonical music dir to asset scope: {:?}",
                        e
                    ));
                } else {
                    term_log(&format!(
                        "Added to asset scope (canonical): {:?}",
                        canonical
                    ));
                }
            }

            // -----------------------------------------------------------------
            // Song cache — pre-scan the library BEFORE the JS is ready
            // -----------------------------------------------------------------
            // The scan (10 category directory reads) overlaps window/JS
            // loading, so the first IPC call (get_all_categories, fired by
            // the JS startup gate) returns instantly instead of re-reading
            // the disk. Later calls hit mtime/size fingerprints and only
            // re-scan a category whose directory actually changed.
            let primed = song_cache::build(&base_path);
            let total_songs: usize = primed.iter().map(|c| c.songs.len()).sum();
            term_log(&format!(
                "[pid {}] Song cache primed: {} categories, {} songs",
                std::process::id(),
                primed.len(),
                total_songs
            ));

            // -----------------------------------------------------------------
            // Media server — HTTP fallback for <video> playback
            // -----------------------------------------------------------------
            // On Linux the webview's <video> element (GStreamer) can't load
            // asset:// URLs, so media is served over plain HTTP. Rust picks
            // a free candidate port from media_server::MEDIA_PORTS (a
            // random starting offset — the CSP has to enumerate every
            // candidate since the CSP spec has no wildcard ports). The
            // frontend fetches the chosen port via get_media_server_port
            // and builds URLs as http://127.0.0.1:<port> + encodeURI(path).
            // start() itself logs the bound port (with pid).
            match media_server::start(&music_dir, &media_server::MEDIA_PORTS) {
                Ok(port) => MEDIA_PORT_USED.store(port, Ordering::Relaxed),
                Err(e) => term_log(&format!(
                    "Warning: Failed to start media server: {}",
                    e
                )),
            }

            // -----------------------------------------------------------------
            // Localhost UI — real HTTP origin for YouTube IFrame embeds
            // -----------------------------------------------------------------
            // The window initially loads the asset-protocol copy of the UI;
            // point it at the tauri-plugin-localhost copy so the page's
            // origin is http://localhost:<port>. YouTube's IFrame Player
            // API error 153 ("request does not include the HTTP Referer
            // header or equivalent API Client identification") goes away
            // because the page can now identify itself to YouTube.
            //
            // The localhost URL is "remote" from Tauri's ACL point of view,
            // so re-grant the same permissions as capabilities/default.json
            // (core:default + the app's "default" set) for that URL —
            // otherwise IPC (every #[tauri::command]) breaks once the page
            // loads over http.
            // The window opens on about:blank (tauri.conf.json) so the
            // embedded asset page is never parsed (backlog #4: it used to
            // load the asset:// UI and then reload the whole page when this
            // navigation happened). Point it at the localhost UI; if that
            // fails, fall back to the embedded asset page.
            let localhost_url = format!("http://localhost:{localhost_port}");
            if let Some(window) = app.get_webview_window("main") {
                // Unreachable for a locally-constructed URL; the let-else
                // keeps the single-statement nesting out of clippy's way.
                let Ok(url) = tauri::Url::parse(&localhost_url) else {
                    term_log("Warning: could not parse the localhost URL — window stays on the blank page");
                    return Ok(());
                };
                if let Err(e) = window.navigate(url) {
                    term_log(&format!(
                        "Warning: Failed to point main window at localhost: {e} — falling back to the asset page"
                    ));
                    if let Ok(fallback) = tauri::Url::parse("index.html") {
                        let _ = window.navigate(fallback);
                    }
                }
            }
            if let Err(e) = app
                .handle()
                .add_capability(
                    tauri::ipc::CapabilityBuilder::new("localhost-main")
                    .remote(localhost_url)
                    .window("main")
                    .permission("core:default")
                    // "default" (no prefix) is the app plugin's default
                    // permission set — allows every #[tauri::command].
                    .permission("default"),
                ) {
                term_log(&format!(
                    "Warning: Failed to add localhost-main capability: {e}"
                ));
            }
            term_log(&format!(
                "[pid {}] App UI served at http://localhost:{localhost_port} (YouTube embed fix)",
                std::process::id()
            ));

            // Debug-build artifacts: scope dump + per-category dir test.
            // Gated so release builds do no startup disk writes or extra
            // canonicalize/read_dir calls on the target hardware.
            #[cfg(debug_assertions)]
            {
                let log_path = std::env::temp_dir().join("jukebox-debug.log");
                let mut log = String::new();
                if let Ok(existing) = std::fs::read_to_string(&log_path) {
                    log = existing;
                }
                log.push_str("\n=== Asset Scope Setup ===\n");
                log.push_str(&format!("Music dir (junction): {music_dir:?}\n"));
                if let Ok(canonical) = std::fs::canonicalize(&music_dir) {
                    log.push_str(&format!("Music dir (canonical): {canonical:?}\n"));
                }
                log.push_str(&format!("Scope: {scope:?}\n"));

                log.push_str("\n=== Category Dir Test (from setup) ===\n");
                for (key, label, dir) in songs::CATS {
                    let full = base_path.join(dir);
                    let exists = full.exists();
                    let read_ok = std::fs::read_dir(&full).is_ok();
                    let canonical = std::fs::canonicalize(&full).ok();
                    log.push_str(&format!(
                        "  {key} ({label}) => exists={exists} read_dir={read_ok} canonical={canonical:?}\n"
                    ));
                }

                // Write to a SEPARATE file so other debug logs don't overwrite it
                let setup_log_path = std::env::temp_dir().join("jukebox-setup.log");
                let _ = std::fs::write(&setup_log_path, &log);
            }

            // -----------------------------------------------------------------
            // mejs-terminal-log — Forward JS console/mejs errors to THIS terminal
            // -----------------------------------------------------------------
            // The mejs player's errors (e.g. "can't handle the path assets://")
            // currently only show in the webview devtools console. This listener
            // pipes them into the terminal running `cargo tauri dev`, so we can
            // watch playback errors without opening devtools.
            // The JS side emits via window.__TAURI__.event.emit("mejs-terminal-log", ...).
            app.listen("mejs-terminal-log", |event| {
                term_log(&format!("[JS] {}", event.payload()));
            });

            Ok(())
        })
        // -----------------------------------------------------------------
        // .invoke_handler() — Register our IPC commands
        // -----------------------------------------------------------------
        // This tells Tauri which Rust functions can be called from JavaScript.
        //
        // tauri::generate_handler![...] takes a list of function names and
        // creates a dispatcher that routes invoke("function_name") calls
        // from JS to the correct Rust function.
        //
        // If you add a new #[tauri::command] function, you MUST add it here
        // too, otherwise JavaScript won't be able to call it.
        // -----------------------------------------------------------------
        .invoke_handler(tauri::generate_handler![
            validate_music_structure,
            detect_admin_drive,
            scan_admin_usb,
            copy_admin_songs,
            cancel_admin_copy,
            admin_grant_usb_scope,
            get_all_categories,
            get_songs_by_category,
            get_shuffle_paths,
            refresh_song_cache,
            speed_test,
            youtube_search,
            get_media_server_port,
            get_app_env,
        ])
        // -----------------------------------------------------------------
        // .run() — Start the application event loop
        // -----------------------------------------------------------------
        // This does several things:
        //   1. Creates a native window on your screen
        //   2. Loads the WebView2 engine (built into Windows 10/11)
        //   3. Loads your HTML file into the WebView
        //   4. Starts listening for events (clicks, IPC calls, etc.)
        //   5. BLOCKS here until the window is closed (the app stays alive)
        //
        // tauri::generate_context!() is a macro that reads your tauri.conf.json
        // at compile time and embeds all your frontend files (HTML, CSS, JS)
        // directly into the binary. This is how you get a single .exe —
        // the HTML is literally inside the executable.
        //
        // .expect() is Rust's way of saying "if this fails, crash with
        // this error message". In production, we'd handle this more
        // gracefully, but for now it's fine — if Tauri can't start,
        // there's nothing we can do anyway.
        // -----------------------------------------------------------------
        .run(tauri::generate_context!())
        .expect("Failed to start the Jukebox application");

    // =========================================================================
    // IMPORTANT: Code after .run() will only execute AFTER the window is closed.
    // The .run() call blocks (waits) until the user closes the app.
    // So if you put println!("goodbye") here, it would print when the app exits.
    // =========================================================================
}
