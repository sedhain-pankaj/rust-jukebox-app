// =============================================================================
// search.js — Search Songs (Tauri Version)
// =============================================================================
//
// ORIGINAL (PHP version):
//   Searched the raw HTML cache (response strings) using regex to extract
//   <table> elements and match against <td> text content.
//
// NEW (Tauri version):
//   Same approach — searches the HTML cache built by songs.js.
//   The cache now stores both JSON data AND pre-built HTML.
//   We search the HTML the same way the original did.
//
// NO AJAX NEEDED — all data is already in the cache from the
// initial Rust IPC call. Search is instant and offline.
// =============================================================================

// ---------------------------------------------------------------------------
// SEARCH DEBOUNCE DELAY (same as original)
// ---------------------------------------------------------------------------
const searchDelay = 700; // ms delay to let user finish typing

$(function () {
  var searchAllTimer = null;
  var searchKaraokeTimer = null;

  // Debounced search for "All Songs" (same as original)
  $("#search_all").on("click input", function () {
    clearTimeout(searchAllTimer);
    searchAllTimer = setTimeout(function () {
      performSearch("search_all", "Karaoke", "All Songs (except Karaoke)");
    }, searchDelay);
  });

  // Debounced search for "Karaoke" only (same as original)
  $("#search_karaoke").on("click input", function () {
    clearTimeout(searchKaraokeTimer);
    searchKaraokeTimer = setTimeout(function () {
      performSearch("search_karaoke", null, "Only Karaoke", "Karaoke");
    }, searchDelay);
  });
});

// ---------------------------------------------------------------------------
// performSearch() — Search the cache and display results
// ---------------------------------------------------------------------------
// Same function as original. The cache format changed (now has .html property)
// but the search algorithm is identical: regex extract <table> elements,
// match text in last <td>, highlight matches.
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
  var filteredResults = [];

  // Ensure HTML is built for all cached categories before searching
  for (var key in cache) {
    if (cache[key].html === null && cache[key].songs) {
      cache[key].html = buildSongTableHtml(cache[key].songs);
    }
  }

  // Search the HTML cache — same regex approach as original
  for (var key in cache) {
    // Filter by search scope (all vs karaoke)
    if (searchKey && key !== searchKey) continue;
    if (!searchKey && key === excludeKey) continue;

    // Extract each <table>...</table> as a string (same as original)
    var htmlContent = cache[key].html || "";
    var tables = htmlContent.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
    if (!tables) continue;

    for (var t = 0; t < tables.length; t++) {
      var tableHtml = tables[t];

      // Extract the last <td> content (song name)
      var tdMatches = tableHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (!tdMatches || tdMatches.length === 0) continue;

      var lastTd = tdMatches[tdMatches.length - 1];
      // Strip HTML tags to get plain text
      var textContent = lastTd.replace(/<[^>]+>/g, "");

      // Check if the song name matches the search
      if (textContent.toLowerCase().includes(searchLower)) {
        // Highlight matching text (same regex as original)
        var regex = new RegExp(
          "(" + searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")",
          "gi"
        );
        var highlightedText = textContent.replace(
          regex,
          '<span style="background-color: #ffff99;">$1</span>'
        );

        // Replace the last td content with highlighted version
        var lastTdIndex = tableHtml.lastIndexOf(lastTd);
        var updatedTable =
          tableHtml.substring(0, lastTdIndex) +
          "<td>" +
          highlightedText +
          "</td>" +
          tableHtml.substring(lastTdIndex + lastTd.length);
        filteredResults.push(updatedTable);
      }
    }
  }

  // Guard clause for no results
  if (filteredResults.length === 0) {
    $("#div_img_video_loader").html(
      "<h3>No results found for your search <br>" +
        "'" +
        searchValue +
        "'. <br><br>" +
        "Try YouTube Search.</h3>"
    );
    return;
  }

  // Build all results as a single string, then insert once
  var resultsHtml = filteredResults.join("");

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

  // Re-number the search results (same as original)
  $("#div_img_video_loader table").each(function (index) {
    $(this)
      .find("th#index")
      .text(index + 1);
  });
}
