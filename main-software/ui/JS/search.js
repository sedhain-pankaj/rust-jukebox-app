// =============================================================================
// search.js - Search Songs (Tauri Version)
// =============================================================================
//
// Searches cached song JSON directly (cache[key].songs) and renders results.
// This avoids reparsing large HTML strings on each keystroke.
// =============================================================================

// ---------------------------------------------------------------------------
// SEARCH DEBOUNCE DELAY
// ---------------------------------------------------------------------------
const searchDelay = 700; // ms delay to let user finish typing

$(function () {
  var searchAllTimer = null;
  var searchKaraokeTimer = null;

  // Debounced search for "All Songs" 
  $("#search_all").on("click input", function () {
    clearTimeout(searchAllTimer);
    searchAllTimer = setTimeout(function () {
      performSearch("search_all", "Karaoke", "All Songs (except Karaoke)");
    }, searchDelay);
  });

  // Debounced search for "Karaoke" only
  $("#search_karaoke").on("click input", function () {
    clearTimeout(searchKaraokeTimer);
    searchKaraokeTimer = setTimeout(function () {
      performSearch("search_karaoke", null, "Only Karaoke", "Karaoke");
    }, searchDelay);
  });
});

// ---------------------------------------------------------------------------
// performSearch() - Search the cache and display results
// ---------------------------------------------------------------------------
function performSearch(searchId, excludeKey, searchMsg, searchKey) {
  searchKey = searchKey || null;
  var searchValue = $("#" + searchId).val();

  // Guard clause for empty input
  if (searchValue == "") {
    $("#div_img_video_loader").html(
      "<h3>Search activated for " +
        searchMsg +
        ".<br>" +
        "Fullscreen halts if Keyboard is active.</h3>"
    );
    return;
  }

  var searchLower = searchValue.toLowerCase();
  var escapedSearch = searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var highlightRegex = new RegExp("(" + escapedSearch + ")", "gi");
  var convertFileSrcLocal = window.__TAURI__.core.convertFileSrc;

  var resultIndex = 1;
  var resultsHtml = "";

  for (var key in cache) {
    if (!Object.prototype.hasOwnProperty.call(cache, key)) continue;

    // Filter by search scope (all vs karaoke)
    if (searchKey && key !== searchKey) continue;
    if (!searchKey && key === excludeKey) continue;

    var category = cache[key];
    var songs = (category && category.songs) || [];

    for (var i = 0; i < songs.length; i++) {
      var song = songs[i];
      var songName = song.name || "";

      if (!songName.toLowerCase().includes(searchLower)) {
        continue;
      }

      var highlightedName = songName.replace(
        highlightRegex,
        '<span style="background-color: #ffff99;">$1</span>'
      );

      var imgSrc = convertFileSrcLocal(song.thumbnail_abs);
      var videoSrc = convertFileSrcLocal(song.path_abs);
      resultsHtml += buildSongTableRowHtml(
        resultIndex,
        songName,
        imgSrc,
        videoSrc,
        highlightedName,
      );

      resultIndex++;
    }
  }

  // Guard clause for no results
  if (resultIndex === 1) {
    $("#div_img_video_loader").html(
      "<h3>No results found for your search <br>" +
        "'" +
        searchValue +
        "'. <br><br>" +
        "Try YouTube Search.</h3>"
    );
    return;
  }

  $("#div_img_video_loader").html(
    "<h3> " +
      searchMsg +
      " Results for : ' " +
      searchValue +
      " '</h3><br>" +
      "<div id='" +
      searchId +
      "_results'>" +
      resultsHtml +
      "</div>"
  );
}
