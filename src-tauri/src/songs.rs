// =============================================================================
// src/songs.rs — Song Scanner Module (replaces logic.php)
// =============================================================================
//
// In the PHP version, logic.php did two things:
//   1. Scanned the music/ directories for video files
//   2. Built HTML strings with <table> elements for each song
//
// In Rust, we separate concerns:
//   - This module ONLY scans directories and returns structured data (JSON)
//   - The frontend JavaScript builds the HTML from that data
//
// This is cleaner because:
//   - The backend doesn't need to know about HTML structure
//   - The frontend can display the data however it wants
//   - When we add encryption later, only this file changes
//
// =============================================================================

// -----------------------------------------------------------------------------
// Imports — bringing in the tools we need
// -----------------------------------------------------------------------------

// std::fs — Rust's standard library for filesystem operations.
// Like PHP's scandir(), file_exists(), etc.
use std::fs;

// std::path — For working with file paths in a cross-platform way.
// Instead of concatenating strings like PHP ($dir . $filename),
// Rust uses Path objects that handle / vs \ automatically.
use std::path::{Path, PathBuf};

// serde — For converting Rust structs to/from JSON.
// The #[derive(Serialize)] attribute below tells serde
// "this struct can be converted to JSON automatically".
use serde::Serialize;

// Terminal logging with blank-line separators (see term_log in main.rs).
use crate::term_log;

// -----------------------------------------------------------------------------
// CONSTANTS — equivalent to the PHP defines
// -----------------------------------------------------------------------------

// These are the video file extensions we look for.
// In PHP, this was: define('VIDEO_PATTERN', '/\.(mp4|m4v|mov|...)$/');
//
// In Rust, we use an array of strings instead of a regex.
// Checking if a file extension is in this list is actually faster
// than running a regex match for every file.
const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "flv", "ogv", "webm",
    "avchd", "avi", "mkv", "wmv", "mpg", "mpeg",
];

// -----------------------------------------------------------------------------
// DATA STRUCTURES — defining the shape of our data
// -----------------------------------------------------------------------------
//
// In PHP, you'd return an associative array:
//   ["name" => "Song Name", "thumbnail" => "path/img/song.jpg", ...]
//
// In Rust, we define a STRUCT (like a PHP class with only properties).
// The #[derive(...)] lines are "derive macros" — they auto-generate code:
//   - Serialize: can be converted to JSON (for sending to JavaScript)
//   - Clone: can be duplicated (like PHP's clone)
//   - Debug: can be printed for debugging (like PHP's var_dump)

/// Represents a single song/video file with all the info the frontend needs.
///
/// When this gets serialized to JSON, it looks like:
/// {
///     "name": "Bohemian Rhapsody",
///     "filename": "Bohemian Rhapsody.mp4",
///     "thumbnail": "music/Eighty/img/Bohemian Rhapsody.jpg",
///     "path": "music/Eighty/Bohemian Rhapsody.mp4",
///     "thumbnail_abs": "C:/Users/.../music/Eighty/img/Bohemian Rhapsody.jpg",
///     "path_abs": "C:/Users/.../music/Eighty/Bohemian Rhapsody.mp4",
///     "name_escaped": "Bohemian Rhapsody"
/// }
#[derive(Serialize, Clone, Debug)]
pub struct Song {
    /// Display name (filename without extension)
    /// PHP equivalent: $filename_no_ext
    pub name: String,

    /// Original filename with extension (e.g., "song.mp4")
    pub filename: String,

    /// Relative path to the thumbnail image
    /// PHP equivalent: $dir . 'img/' . $filename_no_ext . '.jpg'
    pub thumbnail: String,

    /// Relative path to the video file
    /// PHP equivalent: $dir . $filename
    pub path: String,

    /// Absolute filesystem path to the thumbnail (for Tauri's asset protocol)
    /// The frontend uses convertFileSrc(thumbnail_abs) to get a URL the
    /// webview can load. Without this, <img src="..."> can't access local files.
    pub thumbnail_abs: String,

    /// Absolute filesystem path to the video file (for Tauri's asset protocol)
    /// Same idea — needed for <video src="..."> to play local files.
    pub path_abs: String,

    /// The display name, pre-escaped for HTML (backlog: move escaping out
    /// of the JS and into Rust). The frontend injects this value directly
    /// into the queue DOM without escaping it itself, so a filename
    /// containing `<`, `>` or `&` can no longer break the markup.
    /// Computed once per scan in scan_directory().
    pub name_escaped: String,
}

/// Escapes a string for safe insertion into HTML (text or attribute
/// context). Kept in Rust on purpose: the old JS built DOM by string
/// concatenation, so every injection point needed its own escaping.
/// Now Rust escapes once at scan/IPC time and the frontend injects.
pub fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Represents a music category (e.g., "80's", "Country")
/// Contains the category metadata and all songs in it.
///
/// JSON output:
/// {
///     "key": "80",
///     "label": "80's",
///     "dir": "music/Eighty/",
///     "songs": [ { song1 }, { song2 }, ... ]
/// }
#[derive(Serialize, Clone, Debug)]
pub struct Category {
    /// Short key used for lookup (matches the old PHP/JS keys)
    /// e.g., "5060", "70", "80", "LatestHits"
    pub key: String,

    /// Human-readable display name
    /// e.g., "50's + 60's", "Latest Hits"
    pub label: String,

    /// The directory path relative to the app root
    /// e.g., "music/Eighty/"
    pub dir: String,

    /// All songs found in this category's directory
    pub songs: Vec<Song>,
}

// -----------------------------------------------------------------------------
// CATEGORY DEFINITIONS
// -----------------------------------------------------------------------------
//
// This replaces the PHP arrays:
//   $dir_array = ['music/Fifty Sixty/', 'music/Seventy/', ...]
//   $valid_keys = ['5060' => 0, '70' => 1, ...]
//   $categories = ["5060" => "50's + 60's", ...]
//
// In Rust, we combine all three into one data structure.
// Each tuple is: (key, label, directory_path)

/// All music categories as (key, label, directory path) — a compile-time
/// constant. Was a Vec-returning function that allocated on every call
/// (and every IPC command called it); now zero runtime allocation.
/// 'static strings are baked into the binary at compile time.
///
/// This is the single source of truth for the category list — the HTML
/// category buttons (ui/index.html) and the JS shuffle maps are hardcoded
/// to match it.
pub const CATS: [(&str, &str, &str); 10] = [
    ("5060",            "50's + 60's",      "music/Fifty Sixty/"),
    ("70",              "70's",             "music/Seventy/"),
    ("80",              "80's",             "music/Eighty/"),
    ("90",              "90's",             "music/Ninety/"),
    ("2000",            "2000's",           "music/2000/"),
    ("LatestHits",      "Latest Hits",      "music/Latest Hits/"),
    ("Country",         "Country",          "music/Country/"),
    ("Karaoke",         "Karaoke",          "music/Karaoke/"),
    ("SpecialOccasion", "Special Occasion", "music/Special Occasion/"),
    ("ChristmasSong",   "Christmas Song",   "music/Christmas Song/"),
];

// -----------------------------------------------------------------------------
// CORE FUNCTIONS — the actual logic
// -----------------------------------------------------------------------------

/// Checks if a filename has a video extension.
///
/// PHP equivalent:
///   preg_match(VIDEO_PATTERN, $filename)
///
/// # Arguments
/// * `filename` - The filename to check (e.g., "song.mp4")
///
/// # Returns
/// * `true` if the file has a recognized video extension
/// * `false` otherwise
pub fn is_video_file(filename: &str) -> bool {
    // Path::new() creates a Path object from a string.
    // .extension() returns the file extension (or None if there isn't one).
    // .and_then() is like: if extension exists, do this; otherwise return None.
    // .is_some_and() checks if the value exists AND satisfies the condition.
    Path::new(filename)
        .extension()                          // Get extension: Some("mp4") or None
        .and_then(|ext| ext.to_str())         // Convert to string: Some("mp4") or None
        .is_some_and(|ext| {                  // Check if it's in our list
            VIDEO_EXTENSIONS.iter().any(|&valid| valid.eq_ignore_ascii_case(ext))
        })
}

/// Scans a directory and returns all video files as Song structs.
///
/// This is the Rust equivalent of PHP's get_video_files() + img_video_loader()
/// combined, but instead of returning HTML, it returns structured data.
///
/// # Arguments
/// * `base_path` - The root path of the application (where the music/ folder lives)
/// * `dir` - The relative directory to scan (e.g., "music/Eighty/")
///
/// # Returns
/// * `Vec<Song>` - A list of Song structs (empty if directory doesn't exist or has no videos)
///
/// # How it works step by step:
/// 1. Construct the full path: base_path + dir (e.g., "C:\Jukebox\music\Eighty\")
/// 2. Read all files in that directory
/// 3. Filter to only video files (using VIDEO_EXTENSIONS)
/// 4. For each video, create a Song struct with name, thumbnail path, etc.
/// 5. Sort alphabetically by name
/// 6. Return the list
pub fn scan_directory(base_path: &Path, dir: &str) -> Vec<Song> {
    // Build the full filesystem path to the directory.
    // In PHP: $full_path = __DIR__ . '/' . $dir;
    // In Rust: PathBuf is like a mutable String but for file paths.
    let full_path: PathBuf = base_path.join(dir);

    // Try to read the directory contents.
    // fs::read_dir() returns a Result — it might fail if the directory
    // doesn't exist or we don't have permission.
    //
    // In PHP, scandir() would trigger a warning and return false.
    // In Rust, we handle the error explicitly with match.
    let entries = match fs::read_dir(&full_path) {
        Ok(entries) => entries,
        Err(e) => {
            // term_log() prints to the terminal with blank-line separators.
            // The {:?} formats the error in debug mode with details.
            term_log(&format!(
                "Warning: Could not read directory '{}': {:?}",
                dir, e
            ));
            // Return an empty list — no songs in this category.
            // In PHP you'd return []; and in Rust it's Vec::new().
            return Vec::new();
        }
    };

    // Now we iterate over the directory entries and build our Song list.
    //
    // This uses Rust's "iterator" chain — think of it like piping
    // commands in a shell: ls | grep .mp4 | sort
    //
    // .filter_map() = keep only the items that succeed (skip errors)
    // .filter() = keep only items matching a condition
    // .map() = transform each item into something else
    // .collect() = gather all results into a Vec (array)
    let mut songs: Vec<Song> = entries
        // Step 1: Get each directory entry, skip any that error
        // (e.g., permission denied on a specific file)
        .filter_map(|entry| entry.ok())

        // Step 2: Get the filename as a String, skip if it's not valid UTF-8
        .filter_map(|entry| {
            entry.file_name().to_str().map(|s| s.to_string())
        })

        // Step 3: Keep only video files (skip directories, .DS_Store, etc.)
        // This replaces the PHP:
        //   if ($filename !== '.' && $filename !== '..' && preg_match(VIDEO_PATTERN, $filename))
        .filter(|filename| is_video_file(filename))

        // Step 4: Transform each filename into a Song struct
        .map(|filename| {
            // Remove the file extension to get the display name.
            // PHP: $filename_no_ext = preg_replace('/\.[^.]*$/', '', $filename);
            //
            // In Rust, we use Path utilities — more reliable than regex for this:
            let name = Path::new(&filename)
                .file_stem()                    // Get "song" from "song.mp4"
                .unwrap_or_default()            // If somehow empty, use ""
                .to_string_lossy()              // Convert to String
                .to_string();

            // Build the thumbnail path (relative).
            // PHP: $thumbnail = $dir . 'img/' . $filename_no_ext . '.jpg';
            let thumbnail = format!("{}img/{}.jpg", dir, name);

            // Build the video file path (relative).
            // PHP: $dir_link = $dir . $filename;
            let path = format!("{}{}", dir, filename);

            // Build absolute paths for the Tauri asset protocol.
            // The webview can't access local files directly (security sandbox),
            // so we need to provide absolute paths that Tauri's asset protocol
            // converts into loadable URLs.
            //
            // We use forward slashes even on Windows because URLs use /
            // and Tauri's convertFileSrc() expects forward slashes.
            let thumbnail_abs = base_path.join(&thumbnail)
                .to_string_lossy()
                .replace('\\', "/");

            let path_abs = base_path.join(&path)
                .to_string_lossy()
                .replace('\\', "/");

            // Create and return the Song struct.
            // In Rust, the last expression without a semicolon is the return value.
            Song {
                name_escaped: escape_html(&name),
                name,
                filename,
                thumbnail,
                path,
                thumbnail_abs,
                path_abs,
            }
        })
        // Step 5: Collect all the transformed items into a Vec<Song>
        .collect();

    // Sort songs alphabetically by name (case-insensitive).
    // PHP's scandir() returns files in directory order, but explicit
    // sorting is cleaner and more predictable.
    // sort_by_key: one lowercase allocation per element (not two per
    // comparison). cmp_ignore_ascii_case would be zero-alloc but changes
    // ordering for non-ASCII titles (it doesn't lowercase accented chars).
    songs.sort_by_key(|s| s.name.to_lowercase());

    songs
}

/// Scans ALL categories and returns them as a Vec<Category>.
///
/// This is what gets called on app startup to load everything into
/// the frontend cache — replacing the songs.js AJAX calls that
/// individually hit logic.php for each category.
///
/// # Arguments
/// * `base_path` - The root path of the application
///
/// # Returns
/// * `Vec<Category>` - All categories with their songs
pub fn scan_all_categories(base_path: &Path) -> Vec<Category> {
    CATS
        .iter()
        .map(|(key, label, dir)| {
            let songs = scan_directory(base_path, dir);
            Category {
                key: (*key).to_string(),
                label: (*label).to_string(),
                dir: (*dir).to_string(),
                songs,
            }
        })
        .collect()
}

// (Shuffle paths are served from the song cache in main.rs — the
// frontend's shuffle.js still does the Fisher-Yates shuffle itself.)

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_html_escapes_all_special_characters() {
        assert_eq!(escape_html("a & b"), "a &amp; b");
        assert_eq!(escape_html("<img>"), "&lt;img&gt;");
        assert_eq!(escape_html("a\"b'c"), "a&quot;b&#39;c");
        assert_eq!(escape_html("plain"), "plain");
    }

    #[test]
    fn escape_html_runs_once_at_the_data_boundary() {
        // '&' is replaced first, so pre-existing entities are not
        // double-escaped by a second pass.
        assert_eq!(escape_html("a &amp; b"), "a &amp;amp; b");
    }

    #[test]
    fn scan_prefills_name_escaped() {
        let root =
            std::env::temp_dir().join(format!("jukebox-songesc-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let dir = root.join("music/Eighty");
        fs::create_dir_all(dir.join("img")).unwrap();
        fs::write(dir.join("A <B & C>.mp4"), b"x").unwrap();

        let songs = scan_directory(&root, "music/Eighty/");
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].name, "A <B & C>");
        assert_eq!(songs[0].name_escaped, "A &lt;B &amp; C&gt;");

        let _ = fs::remove_dir_all(&root);
    }
}
