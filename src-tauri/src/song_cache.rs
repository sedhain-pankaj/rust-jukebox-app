// =============================================================================
// song_cache.rs — In-Process Song Library Cache
// =============================================================================
//
// WHY: every category/shuffle IPC command used to re-read the 10 category
// directories from disk (songs.rs scan). On the target hardware (Windows
// jukebox on slow disks) that is 10 read_dir passes per call.
//
// Design:
//   - build() runs in .setup() BEFORE the JS is ready, so the scan overlaps
//     with window/JS loading and the first IPC call (get_all_categories)
//     returns instantly.
//   - categories() checks the mtime+size fingerprints of the 10 category
//     directories (cheap metadata() calls — no directory reads) and only
//     re-scans when a directory actually changed. A file added/removed
//     inside a directory changes its size (and mtime); a same-name file
//     REPLACEMENT inside a directory is not detected — the admin copy flow
//     and the refresh_song_cache command cover that explicitly.
//   - refresh() forces a re-scan (refresh_song_cache command; called by
//     copy_admin_songs after a successful transfer).
// =============================================================================

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, PoisonError};
use std::time::SystemTime;

use crate::songs::{scan_all_categories, Category, CATS};

struct Entry {
    categories: Vec<Category>,
    // category dir (relative) -> (mtime, size) of the directory itself
    fingerprints: HashMap<String, (SystemTime, u64)>,
}

static SONG_CACHE: Mutex<Option<Entry>> = Mutex::new(None);

/// (mtime, size) of a directory — None if it doesn't exist.
fn fingerprint(path: &Path) -> Option<(SystemTime, u64)> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    Some((modified, meta.len()))
}

fn current_fingerprints(base: &Path) -> HashMap<String, (SystemTime, u64)> {
    CATS.iter()
        .filter_map(|(_, _, dir)| {
            fingerprint(base.join(dir).as_path())
                .map(|fp| (dir.to_string(), fp))
        })
        .collect()
}

fn scan(base: &Path) -> Entry {
    Entry {
        categories: scan_all_categories(base),
        fingerprints: current_fingerprints(base),
    }
}

fn lock() -> std::sync::MutexGuard<'static, Option<Entry>> {
    SONG_CACHE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Build (or rebuild) the cache from disk and return the categories.
/// Called from .setup() so the scan overlaps with window/JS loading.
pub fn build(base: &Path) -> Vec<Category> {
    let entry = scan(base);
    let categories = entry.categories.clone();
    *lock() = Some(entry);
    categories
}

/// Force a re-scan (refresh_song_cache command; after admin copies).
pub fn refresh(base: &Path) -> Vec<Category> {
    build(base)
}

/// Categories from the cache. Re-scans only when a category directory's
/// mtime/size changed — the freshness check is 10 metadata() calls, never
/// a directory read.
pub fn categories(base: &Path) -> Vec<Category> {
    let mut guard = lock();
    let stale = match guard.as_ref() {
        None => true,
        Some(entry) => current_fingerprints(base) != entry.fingerprints,
    };
    if stale {
        let entry = scan(base);
        let categories = entry.categories.clone();
        *guard = Some(entry);
        return categories;
    }
    guard
        .as_ref()
        .expect("cache present")
        .categories
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A temp music/ tree with all 10 categories (2 videos in Eighty, one
    /// uppercase name to exercise the case-insensitive sort, a non-video
    /// file and a subdirectory that must be ignored).
    fn make_library(root: &Path) {
        for (_, _, dir) in CATS {
            fs::create_dir_all(root.join(dir).join("img")).unwrap();
        }
        let eighty = root.join("music/Eighty");
        fs::write(eighty.join("B Song.mp4"), b"x").unwrap();
        fs::write(eighty.join("a song.MP4"), b"x").unwrap();
        fs::write(eighty.join("notes.txt"), b"x").unwrap();
        fs::create_dir_all(eighty.join("subdir")).unwrap();
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("jukebox-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        root
    }

    #[test]
    fn scan_filters_sorts_and_builds_paths() {
        let root = temp_root("scan");
        make_library(&root);

        let cats = scan_all_categories(&root);
        assert_eq!(cats.len(), 10);

        let eighty = cats.iter().find(|c| c.key == "80").unwrap();
        // txt file + subdirectory filtered out, both videos kept
        assert_eq!(eighty.songs.len(), 2);
        // case-insensitive alphabetical: "a song" < "B Song"
        assert_eq!(eighty.songs[0].name, "a song");
        assert_eq!(eighty.songs[1].name, "B Song");
        assert!(eighty.songs[0]
            .path_abs
            .ends_with("a song.MP4"));
        assert!(eighty.songs[0]
            .thumbnail_abs
            .ends_with("img/a song.jpg"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cache_serves_scan_and_invalidates_on_change() {
        let root = temp_root("cache");
        make_library(&root);

        build(&root);
        // second call hits the cache (same data)
        assert_eq!(categories(&root)[2].songs.len(), 2);

        // add a video → the Eighty directory size/mtime changes →
        // categories() must re-scan and surface the new file
        fs::write(root.join("music/Eighty/New Hit.mp4"), b"x").unwrap();
        assert_eq!(categories(&root)[2].songs.len(), 3);

        // explicit refresh returns the same (fresh) data
        assert_eq!(refresh(&root)[2].songs.len(), 3);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cache_invalidates_on_file_removal() {
        let root = temp_root("cache-remove");
        make_library(&root);

        build(&root);
        assert_eq!(categories(&root)[2].songs.len(), 2);

        // remove a video → directory size/mtime changes → re-scan
        fs::remove_file(root.join("music/Eighty/a song.MP4")).unwrap();
        assert_eq!(categories(&root)[2].songs.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }
}
