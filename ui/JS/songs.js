// =============================================================================
// songs.js — Load and Display Song Categories (Tauri Version)
// =============================================================================
//
// ORIGINAL (PHP version):
//   Made 10 separate AJAX calls to logic.php on page load, each returning
//   raw HTML tables. Cached the HTML strings and injected them on click.
//
// NEW (Tauri version):
//   One IPC call to Rust → get_all_categories() returns JSON data for all
//   categories at once. We build the HTML client-side from the JSON.
//   The cache now stores structured data (arrays of song objects) instead
//   of raw HTML strings.
//
// WHY THE CHANGE:
//   - No PHP server to generate HTML anymore
//   - JSON data is more flexible than HTML strings
//   - One call vs 10 = faster startup
//   - Same visual output — the <table> elements look identical
// =============================================================================

// ---------------------------------------------------------------------------
// GLOBAL CACHE
// ---------------------------------------------------------------------------
// In the original, this was: var cache = {};
// where cache["5060"] = { response: "<table>...</table>...", msg: "50's & 60's" }
//
// Now cache stores structured data:
//   cache["5060"] = {
//     songs: [ {name, filename, thumbnail, path, thumbnail_abs, path_abs}, ... ],
//     msg: "50's + 60's",
//     html: "<table>...</table>..."  ← we build this once and cache it
//   }
var cache = {};

// ---------------------------------------------------------------------------
// TAURI IPC HELPER
// ---------------------------------------------------------------------------
// Shortcut to the Tauri invoke function.
// invoke(commandName, args) calls a Rust #[tauri::command] function and returns
// a Promise with the result. This replaces $.ajax({ url: "logic.php", ... }).
var invoke = window.__TAURI__.core.invoke;

// convertFileSrc() converts an absolute filesystem path to a Tauri asset URL.
// Example: "C:/Users/.../img/Song.jpg" → "https://asset.localhost/C:/Users/.../img/Song.jpg"
// This is needed because the WebView can't load file:// URLs directly for security.
var convertFileSrc = window.__TAURI__.core.convertFileSrc;

// ---------------------------------------------------------------------------
// LOAD ALL CATEGORIES ON STARTUP
// ---------------------------------------------------------------------------
// Replaces the original $(document).ready() that made 10 AJAX calls.
// Now it's ONE call to Rust that returns everything at once.
$(document).ready(function () {
  window.ensureMusicStructure().then(function (validation) {
    if (!validation.valid) {
      return;
    }

    invoke("get_all_categories")
      .then(function (categories) {
        // Build category buttons as DIRECT children of .buttons_leftblock.
        // In the original PHP, the foreach output buttons directly inside the
        // flex container - no wrapper div. We must do the same so that the
        // CSS flex layout (height: 100% on each button) works correctly.
        //
        // We insert each button BEFORE the YouTube heading span, which keeps
        // them in the same DOM position as the original PHP output.
        var buttonsParent = document.querySelector(".buttons_leftblock");
        var youtubeHeading = document.getElementById("youtube-heading");

        categories.forEach(function (category) {
          // Store in cache - same key structure as original but with JSON data
          // instead of raw HTML. We'll generate HTML on first click (lazy).
          cache[category.key] = {
            songs: category.songs,
            msg: category.label,
            html: null, // built on first access (lazy rendering)
          };

          // Create the category button (same class/id as original PHP output)
          // and insert it directly into .buttons_leftblock before YouTube heading.
          var button = document.createElement("button");
          button.className = "button-left";
          button.id = category.key;
          button.textContent = category.label;
          buttonsParent.insertBefore(button, youtubeHeading);
        });

        // Count total songs for debugging
        var totalSongs = categories.reduce(function (sum, cat) {
          return sum + cat.songs.length;
        }, 0);
      })
      .catch(function (error) {
        console.error("Failed to load categories from Rust:", error);
      });
  });
});

// ---------------------------------------------------------------------------
// SHOW SONGS WHEN CATEGORY BUTTON IS CLICKED
// ---------------------------------------------------------------------------
// Same event binding as original: $(document).on("click", ".button-left", ...)
// But instead of injecting pre-built PHP HTML, we build HTML from JSON data.
$(document).on("click", ".button-left", function () {
  var id = $(this).attr("id");
  if (cache[id]) {
    // Build the HTML if it hasn't been built yet (lazy rendering)
    if (cache[id].html === null) {
      cache[id].html = buildSongTableHtml(cache[id].songs);
    }
    showSongs(cache[id].html, cache[id].msg + ": ");
  }
  // Scroll to top of the song display area (same as original)
  $("#div_img_video_loader").scrollTop(0);
});

// ---------------------------------------------------------------------------
// showSongs() — Inject HTML into the song display area
// ---------------------------------------------------------------------------
// Same function signature as original. The HTML format is identical
// (<table> elements) so that all existing CSS styles apply unchanged.
function showSongs(response, msg) {
  $("#div_img_video_loader").html(
    "<h3>" + msg + "</h3><br>" + "<div id='showSongs'></div>",
  );
  $("#showSongs").append(response);
}

// ---------------------------------------------------------------------------
// buildSongTableHtml() — Convert JSON song data to <table> HTML
// ---------------------------------------------------------------------------
// This replaces PHP's img_video_loader() function from logic.php.
// It generates the EXACT same HTML structure:
//   <table onclick="queue_array_create(...)">
//     <th id="index">1.</th>
//     <th><img src="music/Eighty/img/SongName.jpg"></th>
//     <td>Song Name</td>
//   </table>
//
// The only difference is that images use convertFileSrc() to create
// Tauri asset URLs instead of relative paths (because we're not on Apache).
function buildSongTableHtml(songs) {
  var html = "";

  songs.forEach(function (song, index) {
    // Convert absolute filesystem paths to Tauri asset URLs.
    // These are the paths the WebView can actually load.
    var imgSrc = convertFileSrc(song.thumbnail_abs);
    var videoSrc = convertFileSrc(song.path_abs);

    // Build the same <table> structure as PHP's img_video_loader().
    //
    // onclick calls queue_array_create() with:
    //   - filename: display name (used in queue item)
    //   - img: thumbnail URL (shown in queue)
    //   - dir: video file URL (what gets played)
    //
    // We use song.path_abs as the video source (converted to asset URL).
    // This replaces the old relative path like "music/Eighty/Song.mp4".
    html +=
      "<table onclick=\"queue_array_create('" +
      escapeForOnclick(song.name) +
      "', '" +
      escapeForOnclick(imgSrc) +
      "', '" +
      escapeForOnclick(videoSrc) +
      "')\">" +
      "<th id='index'>" +
      (index + 1) +
      ".</th>" +
      "<th><img src='" +
      imgSrc +
      "' onerror=\"this.style.backgroundColor='#555'\"></th>" +
      "<td>" +
      song.name +
      "</td>" +
      "</table>";
  });

  return html;
}

// ---------------------------------------------------------------------------
// escapeForOnclick() — Escape strings for use inside onclick="..." attributes
// ---------------------------------------------------------------------------
// Song names and paths can contain quotes, ampersands, etc.
// This ensures they don't break the HTML onclick attribute.
function escapeForOnclick(str) {
  return str
    .replace(/\\/g, "\\\\") // backslashes
    .replace(/'/g, "\\'") // single quotes
    .replace(/"/g, "&quot;"); // double quotes
}
