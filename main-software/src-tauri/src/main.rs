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

// Import types from our songs module so we don't have to write
// songs::Song, songs::Category everywhere.
use songs::{Category, Song};

// Import Path for filesystem path operations
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

// Import the Manager trait — this gives us access to methods like
// .asset_protocol_scope() on the AppHandle. Without this import,
// Rust wouldn't know those methods exist (traits must be "in scope").
use tauri::Manager;
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
fn get_all_categories(app_handle: tauri::AppHandle) -> Vec<Category> {
    let base_path = get_music_base_path(&app_handle);
    let categories = songs::scan_all_categories(&base_path);

    // Log how many songs were found (visible in debug console)
    let total_songs: usize = categories.iter().map(|c| c.songs.len()).sum();
    println!(
        "Loaded {} categories with {} total songs from: {:?}",
        categories.len(),
        total_songs,
        base_path
    );

    // Log per-category counts for debugging
    for cat in &categories {
        println!(
            "  {} ({}): {} songs | dir: {:?}",
            cat.key,
            cat.label,
            cat.songs.len(),
            base_path.join(&cat.dir)
        );
    }

    categories
}

/// Debug command to help diagnose path issues from the frontend.
/// Call from browser console: await invoke("debug_paths")
#[tauri::command]
fn debug_paths(app_handle: tauri::AppHandle) -> String {
    let base_path = get_music_base_path(&app_handle);
    let music_path = base_path.join("music");
    let music_exists = music_path.exists();
    let music_is_dir = music_path.is_dir();

    let mut info = format!(
        "Base path: {:?}\nMusic path: {:?}\nMusic exists: {}\nMusic is dir: {}\n",
        base_path, music_path, music_exists, music_is_dir
    );

    // List contents of music/ if it exists
    if music_exists && music_is_dir {
        if let Ok(entries) = std::fs::read_dir(&music_path) {
            info.push_str("\nMusic directory contents:\n");
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
                info.push_str(&format!(
                    "  {} {}\n",
                    if is_dir { "[DIR]" } else { "[FILE]" },
                    name
                ));
            }
        }
    }

    // Also check exe path and cwd
    if let Ok(exe) = std::env::current_exe() {
        info.push_str(&format!("\nExe path: {:?}\n", exe));
    }
    if let Ok(cwd) = std::env::current_dir() {
        info.push_str(&format!("CWD: {:?}\n", cwd));
    }

    // Test each category directory individually
    let defs = songs::get_category_definitions();
    info.push_str("\n=== Category Directory Test ===\n");
    for (key, label, dir) in &defs {
        let full = base_path.join(dir);
        let full_str = full.to_string_lossy().to_string();
        let exists = full.exists();
        let is_dir = full.is_dir();
        let read_result = std::fs::read_dir(&full);
        let file_count = match &read_result {
            Ok(_) => {
                // Re-read to count
                std::fs::read_dir(&full)
                    .map(|entries| entries.filter_map(|e| e.ok()).count())
                    .unwrap_or(0)
            }
            Err(_) => 0,
        };
        let read_ok = read_result.is_ok();
        let err_msg = match read_result {
            Err(e) => format!(" ERROR: {:?}", e),
            Ok(_) => String::new(),
        };
        info.push_str(&format!(
            "  {} ({}) => path={:?} exists={} is_dir={} read_dir={} files={}{}\n",
            key, label, full_str, exists, is_dir, read_ok, file_count, err_msg
        ));
    }

    info
}

#[tauri::command]
fn validate_music_structure(app_handle: tauri::AppHandle) -> MusicStructureValidation {
    let base_path = get_music_base_path(&app_handle);
    let music_path = base_path.join("music");
    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let expected_folders: Vec<String> = songs::get_category_definitions()
        .into_iter()
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

#[tauri::command]
fn detect_admin_drive() -> AdminDriveDetection {
    let reason = String::from("admin.key not found on any drive.");

    for letter in 'D'..='Z' {
        let root = PathBuf::from(format!("{}:\\", letter));
        if !root.exists() {
            continue;
        }
        let key_path = root.join("admin.key");
        if key_path.exists() {
            let music_path = root.join("music");
            return AdminDriveDetection {
                found: true,
                root_path: root.to_string_lossy().replace('\\', "/"),
                music_path: music_path.to_string_lossy().replace('\\', "/"),
                reason: String::new(),
            };
        }
    }

    AdminDriveDetection {
        found: false,
        root_path: String::new(),
        music_path: String::new(),
        reason,
    }
}

#[tauri::command]
fn scan_admin_usb(music_path: String, app_handle: tauri::AppHandle) -> AdminUsbScanResult {
    let usb_music = PathBuf::from(&music_path);
    let mut errors: Vec<String> = Vec::new();

    if !usb_music.exists() {
        errors.push(format!("Missing USB music folder: {}", usb_music.display()));
    } else if !usb_music.is_dir() {
        errors.push(format!(
            "USB music path is not a directory: {}",
            usb_music.display()
        ));
    }

    let definitions = songs::get_category_definitions();

    if errors.is_empty() {
        for (_, _, dir) in &definitions {
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

    let local_music = get_music_base_path(&app_handle).join("music");

    for (_, label, dir) in definitions {
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

        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }
            let filename = entry.file_name().to_string_lossy().to_string();
            if !songs::is_video_file_name(&filename) {
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

        songs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        per_folder_counts.push(AdminFolderSummary {
            folder: folder_name.clone(),
            label: label.to_string(),
            new_with_thumbs,
            new_missing_thumbs,
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

#[tauri::command]
fn copy_admin_songs(
    music_path: String,
    selections: Vec<AdminCopySelection>,
    app_handle: tauri::AppHandle,
) -> AdminCopyResult {
    let usb_music = PathBuf::from(&music_path);
    let local_music = get_music_base_path(&app_handle).join("music");

    let mut copied: usize = 0;
    let mut skipped: usize = 0;
    let mut errors: Vec<String> = Vec::new();

    for selection in selections {
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
            Ok(_) => {
                copied += 1;
            }
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

    AdminCopyResult {
        copied,
        skipped,
        errors,
    }
}
/// Returns songs for a single category by key.
///
/// JavaScript usage:
///   const songs = await window.__TAURI__.core.invoke("get_songs_by_category", { key: "80" });
///   // songs = [{ name: "Bohemian Rhapsody", path: "music/Eighty/...", ... }, ...]
#[tauri::command]
fn get_songs_by_category(key: String, app_handle: tauri::AppHandle) -> Vec<Song> {
    let base_path = get_music_base_path(&app_handle);

    // Find the directory for this category key
    let definitions = songs::get_category_definitions();
    let category = definitions.iter().find(|(k, _, _)| *k == key.as_str());

    match category {
        Some((_, _, dir)) => songs::scan_directory(&base_path, dir),
        None => {
            eprintln!("Unknown category key: {}", key);
            Vec::new()
        }
    }
}

/// Returns shuffled file paths for a category (used by shuffle/randomizer).
///
/// Replaces the PHP shuffle_img_video_loader() that returned paths
/// separated by <br>. Now returns a clean JSON array of paths.
///
/// JavaScript usage:
///   const paths = await window.__TAURI__.core.invoke("get_shuffle_paths", { key: "80" });
///   // paths = ["music/Eighty/song1.mp4", "music/Eighty/song2.mp4", ...]
#[tauri::command]
fn get_shuffle_paths(key: String, app_handle: tauri::AppHandle) -> Vec<String> {
    let base_path = get_music_base_path(&app_handle);
    songs::get_shuffle_paths(&base_path, &key)
}

/// Native internet speed test.
/// Downloads a large file and measures throughput in Mbps.
/// Runs in Rust (outside WebView) so no CSP restrictions apply.
///
/// JavaScript usage:
///   const result = await window.__TAURI__.core.invoke("speed_test");
///   // result = { speed_mbps: "12.34", quality: "Excellent for YouTube" }
#[tauri::command]
fn speed_test() -> Result<serde_json::Value, String> {
    // Cloudflare's speed test endpoint — purpose-built for speed testing.
    // Downloads 10MB of data. No burden on open-source infrastructure.
    let url = "https://speed.cloudflare.com/__down?bytes=10000000";

    let start = std::time::Instant::now();
    let response = reqwest::blocking::get(url).map_err(|e| e.to_string())?;
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    let duration = start.elapsed().as_secs_f64();

    let bits = bytes.len() as f64 * 8.0;
    let speed_mbps = bits / duration / 1_048_576.0;

    let quality = if speed_mbps >= 5.0 {
        "Excellent for YouTube"
    } else if speed_mbps >= 2.0 {
        "Good for YouTube"
    } else if speed_mbps >= 0.5 {
        "May buffer on YouTube"
    } else {
        "Too slow for YouTube"
    };

    Ok(serde_json::json!({
        "speed_mbps": format!("{:.2}", speed_mbps),
        "quality": quality
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
        if !songs::is_video_file_name(&filename) {
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

/// Determines the base path where the music/ folder lives.
///
/// In development: the workspace root (Craigs-Music-Player/rust-jukebox-app/)
/// In production: the directory containing rust-jukebox-app.exe
///
/// This is important because all song paths are relative:
///   base_path/music/Eighty/song.mp4
fn get_music_base_path(_app_handle: &tauri::AppHandle) -> PathBuf {
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

    // Write debug log to a file so we can see what's happening
    // even when the console is hidden by the fullscreen window
    let log_path = std::env::temp_dir().join("jukebox-debug.log");
    let mut log = String::new();
    log.push_str("=== Jukebox Path Debug ===\n");

    for candidate in &candidates {
        let music_check = candidate.join("music");
        let exists = music_check.exists();
        let is_dir = music_check.is_dir();
        log.push_str(&format!(
            "Checking: {:?}/music/ => exists={}, is_dir={}\n",
            candidate, exists, is_dir
        ));
        if exists && is_dir {
            log.push_str(&format!("FOUND music/ at: {:?}\n", candidate));
            let _ = std::fs::write(&log_path, &log);
            println!("Found music/ directory at: {:?}", candidate);
            return candidate.clone();
        }
    }

    log.push_str("ERROR: music/ not found anywhere!\n");
    let _ = std::fs::write(&log_path, &log);
    eprintln!("ERROR: Could not find music/ directory!");
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

    tauri::Builder::default()
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
        // path is OUTSIDE rust-jukebox-app/, so the default scope ("**") doesn't
        // match it. By explicitly adding the canonical music directory to
        // the scope at runtime, we tell Tauri "this path is allowed".
        // -----------------------------------------------------------------
        .setup(|app| {
            // Find the music directory using the same logic as IPC commands
            let base_path = get_music_base_path(&app.handle());
            let music_dir = base_path.join("music");

            // Get the asset protocol scope so we can add allowed directories
            let scope = app.asset_protocol_scope();

            // Allow the junction path (rust-jukebox-app/music/)
            if let Err(e) = scope.allow_directory(&music_dir, true) {
                eprintln!("Warning: Failed to add music dir to asset scope: {:?}", e);
            } else {
                println!("Added to asset scope (junction): {:?}", music_dir);
            }

            // Also allow the CANONICAL path (resolves the junction to the real location)
            // This is the path Tauri's scope check will canonicalize to,
            // so it MUST be in the allowed patterns.
            if let Ok(canonical) = std::fs::canonicalize(&music_dir) {
                if let Err(e) = scope.allow_directory(&canonical, true) {
                    eprintln!(
                        "Warning: Failed to add canonical music dir to asset scope: {:?}",
                        e
                    );
                } else {
                    println!("Added to asset scope (canonical): {:?}", canonical);
                }
            }

            // Log the scope for debugging
            let log_path = std::env::temp_dir().join("jukebox-debug.log");
            let mut log = String::new();
            if let Ok(existing) = std::fs::read_to_string(&log_path) {
                log = existing;
            }
            log.push_str(&format!("\n=== Asset Scope Setup ===\n"));
            log.push_str(&format!("Music dir (junction): {:?}\n", music_dir));
            if let Ok(canonical) = std::fs::canonicalize(&music_dir) {
                log.push_str(&format!("Music dir (canonical): {:?}\n", canonical));
            }
            log.push_str(&format!("Scope: {:?}\n", scope));

            // Test each category directory from within the setup
            let defs = songs::get_category_definitions();
            log.push_str("\n=== Category Dir Test (from setup) ===\n");
            for (key, label, dir) in &defs {
                let full = base_path.join(dir);
                let exists = full.exists();
                let read_ok = std::fs::read_dir(&full).is_ok();
                let canonical = std::fs::canonicalize(&full).ok();
                log.push_str(&format!(
                    "  {} ({}) => exists={} read_dir={} canonical={:?}\n",
                    key, label, exists, read_ok, canonical
                ));
            }

            // Write to a SEPARATE file so get_all_categories doesn't overwrite it
            let setup_log_path = std::env::temp_dir().join("jukebox-setup.log");
            let _ = std::fs::write(&setup_log_path, &log);

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
            get_all_categories,
            get_songs_by_category,
            get_shuffle_paths,
            debug_paths,
            speed_test,
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
