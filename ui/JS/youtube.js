// =============================================================================
// youtube.js - YouTube Search and Playback (Tauri Version)
// =============================================================================

var youtubeIframeApiRequested = false;

function search_youtube() {
  $("#div_img_video_loader").html(
    "<input type='text' id='search_query' placeholder='Search YouTube' autocomplete='off'>" +
      "<button id='search_button'> &#9658; </button>" +
      "<h3>Interaction is restricted for YouTube contents.<br><br>" +
      "API Keys provided by Google LLC. <br>" +
      "Copyright&copy; belongs to YouTube. <br><br>" +
      "<button class='button-left' id='speedtest' onclick='internet_speed()'> Perform SpeedTest </button>" +
      "<p id='speed_result' style='font-size:clamp(1vw, 1.2vw, 2vw);'></p></h3>",
  );

  $("#search_query").on("keydown", function (e) {
    if (e.key === "Enter" && $(this).val() !== "") {
      e.preventDefault();
      load_youtube();
      Keyboard.close();
    }
  });
}

// YouTube search now runs in Rust (the youtube_search IPC command):
// reqwest percent-encodes the query (the old JS concatenation corrupted
// queries containing & / # / +), the title arrives pre-escaped
// (title_html — the same Rust-escapes-once policy as Song.name_escaped),
// and the API key stays in Rust instead of entering the webview.
const load_youtube = () => {
  const search_query = $("#search_query").val();
  if (!search_query) {
    return;
  }

  window.__TAURI__.core
    .invoke("youtube_search", { query: search_query })
    .then(function (result) {
      var resultsHtml = "";
      result.items.forEach(function (item, i) {
        // class instead of id="index" (that was a duplicate DOM id, one
        // per row); the video id and pre-escaped title ride data-attrs
        resultsHtml +=
          "<table class='search_result_table' data-video-id='" +
          escapeHtmlAttr(item.video_id) +
          "' data-title-escaped='" +
          escapeHtmlAttr(item.title_html) +
          "' data-thumb='" +
          escapeHtmlAttr(item.thumbnail) +
          "'>" +
          "<th class='yt_index'>" +
          i +
          1 +
          ".</th>" +
          "<th class='search_result_img'>" +
          "<img src='" +
          escapeHtmlAttr(item.thumbnail) +
          "'></th>" +
          "<td class='yt_video_title'>" +
          item.title_html +
          "</td>" +
          "</table>";
      });

      $("#div_img_video_loader").html(
        "<h3>Top 10 YouTube Results for : ' " +
          escapeHtmlText(search_query) +
          " '</h3><br>" +
          "<div id='search_results'>" +
          resultsHtml +
          "</div>",
      );

      loadYoutubeIframeAPI();
    })
    .catch(function (error) {
      console.log(error);
      $("#div_img_video_loader").html(
        "<h3>Error: " +
          escapeHtmlText(String(error)) +
          "<br><br>YouTube requires internet connection.</h3>",
      );
    });
};

const loadYoutubeIframeAPI = () => {
  if (youtubeIframeApiRequested || (window.YT && window.YT.Player)) {
    return;
  }

  if (
    document.querySelector("script[src='https://www.youtube.com/iframe_api']")
  ) {
    youtubeIframeApiRequested = true;
    return;
  }

  youtubeIframeApiRequested = true;
  var tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  var firstScriptTag = document.getElementsByTagName("script")[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
};

const handleSearchResultClick = function () {
  var video_id = $(this).attr("data-video-id");
  var yt_dir = "https://www.youtube.com/embed/" + video_id;

  // The Set check subsumes the array (queue_lookup mirrors queue_array).
  if (typeof queue_lookup !== "undefined" && queue_lookup.has(yt_dir)) {
    var position = queue_array.indexOf(yt_dir) + 1;
    jquery_modal({
      message:
        "This song is already queued at number " +
        position +
        ". Once it is played from the queue, it can be added again.",
      title: "Song Already Queued",
    });
    return;
  }

  var video = document.getElementById("video");
  if (video.src.includes(video_id)) {
    jquery_modal({
      message:
        "This song is being played currently. Once it ends completely, it can be re-added to queue.",
      title: "Song Being Played Currently",
    });
    return;
  }

  // The title is Rust-pre-escaped (title_html): the attribute stores the
  // escaped string, attr() returns it decoded once (the escaping stays
  // intact), and the queue injects it as-is.
  var yt_title = $(this).attr("data-title-escaped");
  var yt_img = $(this).attr("data-thumb");
  queue_array_create(yt_title, yt_img, yt_dir);
};

$(document).on("click", ".search_result_table", handleSearchResultClick);

function internet_speed() {
  $("#speed_result").html(
    "Wait <br> <i class='material-icons' style='font-size:clamp(1vw, 4vw, 5vw);'>network_check</i>",
  );

  var icon =
    "<i class='material-icons' style='font-size:clamp(1vw, 4vw, 5vw);'>";

  window.__TAURI__.core
    .invoke("speed_test")
    .then(function (result) {
      // icon + quality come from Rust — one set of thresholds (backlog #9).
      var quality = icon + result.icon + "</i><br>" + result.quality;
      $("#speed_result").html(quality + "<br>" + result.speed_mbps + " Mbps");
    })
    .catch(function (err) {
      console.log(err);
      $("#speed_result").html("Error: Could not perform speed test.");
    });
}
