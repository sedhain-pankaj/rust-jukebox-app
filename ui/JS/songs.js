// =============================================================================
// songs.js - Load and Display Song Categories (Tauri Version)
// =============================================================================

// Cache structure:
// cache[key] = { songs: [...], msg: label, html: "..." }
var cache = {};

var invoke = window.__TAURI__.core.invoke;
var convertFileSrc = window.__TAURI__.core.convertFileSrc;
var categoriesLoaded = false;

function loadCategoriesOnce() {
  if (categoriesLoaded) {
    return;
  }
  categoriesLoaded = true;

  invoke("get_all_categories")
    .then(function (categories) {
      var buttonsParent = document.querySelector(".buttons_leftblock");
      var youtubeHeading = document.getElementById("youtube-heading");

      categories.forEach(function (category) {
        cache[category.key] = {
          songs: category.songs,
          msg: category.label,
          html: null,
        };

        var button = document.createElement("button");
        button.className = "button-left";
        button.id = category.key;
        button.textContent = category.label;
        buttonsParent.insertBefore(button, youtubeHeading);
      });
    })
    .catch(function (error) {
      console.error("Failed to load categories from Rust:", error);
      categoriesLoaded = false;
    });
}

window.loadCategoriesOnce = loadCategoriesOnce;

$(document).ready(function () {
  var adminReady = window.__adminModeReady
    ? window.__adminModeReady()
    : Promise.resolve({ active: false });

  adminReady.then(function () {
    if (window.__adminMode && window.__adminMode.active) {
      return;
    }

    // mediaBaseReady() resolves the media server's port (config.js) — the
    // table builds video URLs synchronously, so the port must be known first.
    //
    // Guard: the first (asset://) page can be cut off by the navigation to
    // the localhost URL before its deferred scripts all finished, so
    // validation.js may not have run there. Skip the gate in that case —
    // it will run on the real (localhost) page, where scripts load fully.
    var validationPromise;
    if (typeof window.ensureMusicStructure === "function") {
      validationPromise = window.ensureMusicStructure();
    } else {
      console.warn("ensureMusicStructure unavailable — skipping startup validation");
      validationPromise = Promise.resolve({ valid: true });
    }

    Promise.all([mediaBaseReady(), validationPromise]).then(function (results) {
      var validation = results[1];
      if (!validation.valid) {
        return;
      }

    loadCategoriesOnce();
  });
});
});

$(document).on("click", ".button-left", function () {
  var id = $(this).attr("id");
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
    "<th id='index'>" +
    index +
    ".</th>" +
    "<th><img src='" +
    imgSrc +
    "' onerror=\"this.style.backgroundColor='#555'\"></th>" +
    "<td>" +
    (nameHtml || escapeHtmlText(songName)) +
    "</td>" +
    "</table>"
  );
}
