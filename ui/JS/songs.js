// =============================================================================
// songs.js - Load and Display Song Categories (Tauri Version)
// =============================================================================

// Cache structure:
// cache[key] = { songs: [...], msg: label, html: "..." }
var cache = {};

var invoke = window.__TAURI__.core.invoke;
var convertFileSrc = window.__TAURI__.core.convertFileSrc;
var categoriesLoaded = false;

// Fills the song cache from Rust. The category BUTTONS are hardcoded in
// index.html (they match the compile-time constant songs::CATS in Rust),
// so they appear before the IPC round-trip; this only loads the data.
function loadCategoriesOnce() {
  if (categoriesLoaded) {
    return;
  }
  categoriesLoaded = true;

  invoke("get_all_categories")
    .then(function (categories) {
      categories.forEach(function (category) {
        cache[category.key] = {
          songs: category.songs,
          msg: category.label,
          html: null,
        };
      });
    })
    .catch(function (error) {
      console.error("Failed to load categories from Rust:", error);
      categoriesLoaded = false;
    });
}

window.loadCategoriesOnce = loadCategoriesOnce;

// Category buttons + song table initialization. Runs behind the startup
// gate at page load (every load, including the "Start Jukebox" reload
// from admin mode).
window.initJukeboxSongs = function (validation) {
  if (!validation) {
    return; // admin mode owns the UI, or validation failed
  }
  loadCategoriesOnce();
};

$(document).ready(function () {
  // Shared startup gate (validation.js): admin check + media server port +
  // music structure validation, memoized. The song table builds video URLs
  // synchronously, so the port must be known before this resolves.
  window.startupGate().then(function (validation) {
    window.initJukeboxSongs(validation);
  });
});

// data-key on the hardcoded category buttons (id kept as a fallback so the
// speedtest button — also class .button-left — is ignored via the cache
// guard below).
$(document).on("click", ".button-left", function () {
  var id = $(this).attr("data-key") || $(this).attr("id");
  if (cache[id]) {
    if (cache[id].html === null) {
      cache[id].html = buildSongTableHtml(cache[id].songs);
    }
    showSongs(cache[id].html, cache[id].msg + ": ");
  }
  $("#div_img_video_loader").scrollTop(0);
});

function showSongs(response, msg) {
  $("#div_img_video_loader").html(
    "<h3>" + msg + "</h3><br>" + "<div id='showSongs'></div>",
  );
  $("#showSongs").append(response);
}

// Resolve the Rust-pre-escaped display name for a media-server URL.
// Backlog: move escaping out of the JS and into Rust — Song.name_escaped
// is computed once per scan in scan_directory() and rides over IPC, so the
// queue can inject it into the DOM directly (no JS escaping, no escaping
// at all if the lookup hits).
// mediaUrl() is MEDIA_SERVER_BASE + encodeURI(path_abs), so the reverse is
// strip base + decodeURI (encodeURI leaves '/' alone, so path_abs round-trips).
function songNameHtmlFromDir(dir) {
  if (
    typeof MEDIA_SERVER_BASE !== "string" ||
    !MEDIA_SERVER_BASE ||
    dir.indexOf(MEDIA_SERVER_BASE) !== 0
  ) {
    return null;
  }
  var abs = decodeURI(dir.substring(MEDIA_SERVER_BASE.length));
  for (var key in cache) {
    if (!Object.prototype.hasOwnProperty.call(cache, key)) continue;
    var songs = cache[key].songs || [];
    for (var i = 0; i < songs.length; i++) {
      if (songs[i].path_abs === abs) {
        return songs[i].name_escaped || null;
      }
    }
  }
  return null;
}

// Delegated click handler avoids inline onclick attributes on every table row.
// The name comes pre-escaped from Rust (name_escaped); the fallback escapes
// in JS only if the cache lookup misses (e.g. a row built before load).
$(document).on("click", ".song_table", function () {
  var dir = $(this).attr("data-dir");
  var name =
    songNameHtmlFromDir(dir) ||
    escapeHtmlText($(this).attr("data-filename") || "");
  queue_array_create(name, $(this).attr("data-img"), dir);
});

function buildSongTableHtml(songs) {
  var html = "";

  songs.forEach(function (song, index) {
    var imgSrc = convertFileSrc(song.thumbnail_abs);
    var videoSrc = mediaUrl(song.path_abs);
    html += buildSongTableRowHtml(index + 1, song.name, imgSrc, videoSrc);
  });

  return html;
}

function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlText(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildSongTableRowHtml(index, songName, imgSrc, videoSrc, nameHtml) {
  return (
    "<table class='song_table' data-filename=\"" +
    escapeHtmlAttr(songName) +
    "\" data-img=\"" +
    escapeHtmlAttr(imgSrc) +
    "\" data-dir=\"" +
    escapeHtmlAttr(videoSrc) +
    "\">" +
    // class instead of id="index" (was a duplicate DOM id on every row)
    "<th class='song_index'>" +
    index +
    ".</th>" +
    // loading=lazy (backlog #3): only the ~15 visible rows decode —
    // a category view no longer decodes all ~356 thumbnails at once.
    // Honored by both WebView2 (Chromium) and WebKitGTK.
    "<th><img loading='lazy' src='" +
    imgSrc +
    "' onerror=\"this.style.backgroundColor='#555'\"></th>" +
    "<td>" +
    (nameHtml || escapeHtmlText(songName)) +
    "</td>" +
    "</table>"
  );
}
