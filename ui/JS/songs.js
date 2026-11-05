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

// Delegated click handler avoids inline onclick attributes on every table row.
$(document).on("click", ".song_table", function () {
  queue_array_create(
    $(this).attr("data-filename"),
    $(this).attr("data-img"),
    $(this).attr("data-dir"),
  );
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
