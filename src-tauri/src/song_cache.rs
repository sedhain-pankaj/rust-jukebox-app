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
//   - Freshness checks are TTL-gated (FRESHNESS_TTL): inside the window,
//     commands serve the cache without re-statting the 10 category
//     directories (10 metadata() calls — the per-call cost on a slow 74 GB
//     disk). An external file change surfaces within one window; the admin
//     copy flow and the refresh_song_cache command are immediate (they call
//     refresh() explicitly).
//   - Single-category commands (get_songs_by_category, get_shuffle_paths)
//     serve ONE category's Vec via songs_for() — ~1/10 of the whole-library
//     memory copy categories() makes.
//   - refresh() forces a re-scan (refresh_song_cache command; called by
//     copy_admin_songs after a successful transfer).
//   - Under #[cfg(test)] the fingerprint check ALWAYS runs, so the
//     invalidation tests stay exact (the 15 s window is a production-only
//     optimization).
// =============================================================================

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, SystemTime};

use crate::songs::{scan_all_categories, Category, Song, CATS};
use crate::term_log;

/// How long a completed fingerprint check stays valid. Inside this window
/// the cache is served without re-statting the 10 category directories.
/// (Unused in the test build: under #[cfg(test)] the check always runs.)
#[cfg_attr(test, allow(dead_code))]
const FRESHNESS_TTL: Duration = Duration::from_secs(15);

struct Entry {
    /// Ordered categories — served by get_all_categories (whole-library copy).
    categories: Vec<Category>,
    /// key -> songs, for single-category commands (one category's copy).
    by_key: HashMap<String, Vec<Song>>,
    // category dir (relative) -> (mtime, size) of the directory itself
    fingerprints: HashMap<String, (SystemTime, u64)>,
    /// When the fingerprint check last ran.
    checked_at: Option<SystemTime>,
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

fn build_by_key(categories: &[Category]) -> HashMap<String, Vec<Song>> {
    categories
        .iter()
        .map(|c| (c.key.clone(), c.songs.clone()))
        .collect()
}

fn empty_entry() -> Entry {
    Entry {
        categories: Vec::new(),
        by_key: HashMap::new(),
        fingerprints: HashMap::new(),
        checked_at: None,
    }
}

/// Whether a fingerprint check should run now. Production: the check is
/// TTL-gated (skipped within FRESHNESS_TTL — the 10 stat calls are the
/// per-call cost it avoids). Under #[cfg(test)] the check always runs so
/// invalidation tests stay exact.
fn should_check_fingerprints(checked_at: Option<SystemTime>) -> bool {
    #[cfg(test)]
    {
        let _ = checked_at;
        true
    }
    #[cfg(not(test))]
    match checked_at {
        None => true,
        Some(t) => SystemTime::now()
            .duration_since(t)
            .map(|d| d > FRESHNESS_TTL)
            .unwrap_or(true),
    }
}

/// Full re-scan of all 10 category directories. The timing in this log
/// line is the visible cross-check for the scan cost (IPC latency itself
/// is hard to A/B on the kiosk — this number is what to watch).
fn rescan(base: &Path) -> Vec<Category> {
    let started = std::time::Instant::now();
    let out = scan_all_categories(base);
    term_log(&format!(
        "Song scan: {} songs across {} directories in {} ms",
        out.iter().map(|c| c.songs.len()).sum::<usize>(),
        out.len(),
        started.elapsed().as_millis()
    ));
    out
}

/// Replace the entry's data with a fresh scan.
fn scan_into(base: &Path, entry: &mut Entry) {
    entry.categories = rescan(base);
    entry.by_key = build_by_key(&entry.categories);
    entry.fingerprints = current_fingerprints(base);
    entry.checked_at = Some(SystemTime::now());
}

/// TTL-gated fingerprint check; re-scans when any category directory's
/// mtime/size changed (or this is the first check).
fn invalidate_on_change(base: &Path, entry: &mut Entry) {
    if !should_check_fingerprints(entry.checked_at) {
        return;
    }
    entry.checked_at = Some(SystemTime::now());
    if current_fingerprints(base) != entry.fingerprints {
        scan_into(base, entry);
    }
}

/// Build (or rebuild) the cache from disk and return the categories.
/// Called from .setup() so the scan overlaps with window/JS loading.
pub fn build(base: &Path) -> Vec<Category> {
    let mut guard = lock();
    let entry = guard.get_or_insert_with(empty_entry);
    scan_into(base, entry);
    entry.categories.clone()
}

/// Force a re-scan (refresh_song_cache command; after admin copies).
pub fn refresh(base: &Path) -> Vec<Category> {
    build(base)
}

/// Categories from the cache. Re-scans only when a category directory's
/// mtime/size changed AND the last check is older than FRESHNESS_TTL.
pub fn categories(base: &Path) -> Vec<Category> {
    let mut guard = lock();
    let entry = guard.get_or_insert_with(empty_entry);
    invalidate_on_change(base, entry);
    entry.categories.clone()
}

/// One category's songs, or None for an unknown key. Cheaper than
/// categories(): clones one category's Vec instead of all 10.
pub fn songs_for(base: &Path, key: &str) -> Option<Vec<Song>> {
    let mut guard = lock();
    let entry = guard.get_or_insert_with(empty_entry);
    invalidate_on_change(base, entry);
    entry.by_key.get(key).cloned()
}

fn lock() -> std::sync::MutexGuard<'static, Option<Entry>> {
    SONG_CACHE.lock().unwrap_or_else(PoisonError::into_inner)
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

    #[test]
    fn songs_for_serves_one_category_and_none_for_unknown_key() {
        let root = temp_root("songs-for");
        make_library(&root);
        build(&root);

        assert_eq!(songs_for(&root, "80").unwrap().len(), 2);
        assert_eq!(songs_for(&root, "70").unwrap().len(), 0);
        assert!(songs_for(&root, "nope").is_none());

        let _ = fs::remove_dir_all(&root);
    }
}
