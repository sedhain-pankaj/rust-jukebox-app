// =============================================================================
// youtube.js — YouTube Search and Playback (Tauri Version)
// =============================================================================
//
// MOSTLY IDENTICAL to original. The only change is that we check for
// internet connectivity before making YouTube API calls, since the
// jukebox might run completely offline.
//
// NOTE: YouTube functionality requires internet access. If the jukebox
// is offline (which it usually is), this will show an error message.
// In the future, we might remove YouTube entirely and just use local files.
// =============================================================================

function search_youtube() {
  // Create YouTube search UI in the song display area (same as original)
  $("#div_img_video_loader").html(
    "<input type='text' id='search_query' placeholder='Search YouTube' autocomplete='off'>" +
      "<button id='search_button'> &#9658; </button>" +
      "<h3>Interaction is restricted for YouTube contents.<br><br>" +
      "API Keys provided by Google LLC. <br>" +
      "Copyright&copy; belongs to YouTube. <br><br>" +
      "<button class='button-left' id='speedtest' onclick='internet_speed()'> Perform SpeedTest </button>" +
      "<p id='speed_result' style='font-size:clamp(1vw, 1.2vw, 2vw);'></p></h3>"
  );

  // Physical Enter key triggers YouTube search
  $("#search_query").on("keydown", function (e) {
    if (e.key === "Enter" && $(this).val() !== "") {
      e.preventDefault();
      load_youtube();
      Keyboard.close();
    }
  });
}

// Load YouTube search results (same as original)
const load_youtube = () => {
  const search_query = $("#search_query").val();
  const search_query_url =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&q=" +
    search_query +
    "&type=video&videoEmbeddable=true&maxResults=10&key=" +
    YT_API_Key;

  $.ajax({
    url: search_query_url,
    method: "GET",
    dataType: "json",
    success: function (data) {
      var resultsHtml = "";
      data.items.forEach(function (item, i) {
        resultsHtml +=
          "<table class='search_result_table'>" +
          "<th id='index'>" +
          (i + 1) +
          ".</th>" +
          "<th class='search_result_img'>" +
          "<img src='" +
          item.snippet.thumbnails.default.url +
          "'>" +
          "</th>" +
          "<td class='yt_video_title'>" +
          item.snippet.title +
          "</td>" +
          "<td class='yt_video_id' style='display:none;'>" +
          item.id.videoId +
          "</td>" +
          "</table>";
      });

      $("#div_img_video_loader").html(
        "<h3>Top 10 YouTube Results for : ' " +
          search_query +
          " '</h3><br>" +
          "<div id='search_results'>" +
          resultsHtml +
          "</div>"
      );

      loadYoutubeIframeAPI();
      $(".search_result_table").click(handleSearchResultClick);
    },
    error: function (error) {
      console.log(error);
      $("#div_img_video_loader").html(
        "<h3>Error: " +
          error.statusText +
          "<br><br>YouTube requires internet connection.</h3>"
      );
    },
  });
};

const loadYoutubeIframeAPI = () => {
  var tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  var firstScriptTag = document.getElementsByTagName("script")[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
};

const handleSearchResultClick = function () {
  var yt_dir =
    "https://www.youtube.com/embed/" +
    $(this).find(".yt_video_id").text();

  if (queue_array.includes(yt_dir)) {
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
  if (video.src.includes($(this).find(".yt_video_id").text())) {
    jquery_modal({
      message:
        "This song is being played currently. Once it ends completely, it can be re-added to queue.",
      title: "Song Being Played Currently",
    });
    return;
  }

  // Add YouTube video to queue
  var yt_title = $(this).find(".yt_video_title").text();
  var yt_img = $(this).find("img").attr("src");
  queue_array_create(yt_title, yt_img, yt_dir);
};

function internet_speed() {
  $("#speed_result").html(
    "Wait <br> <i class='material-icons' style='font-size:clamp(1vw, 4vw, 5vw);'>network_check</i>",
  );

  var icon = "<i class='material-icons' style='font-size:clamp(1vw, 4vw, 5vw);'>";

  window.__TAURI__.core.invoke("speed_test")
    .then(function (result) {
      var quality;
      var speed = parseFloat(result.speed_mbps);
      if (speed >= 5) {
        quality = icon + "verified</i><br>" + result.quality;
      } else if (speed >= 2) {
        quality = icon + "verified</i><br>" + result.quality;
      } else if (speed >= 0.5) {
        quality = icon + "warning</i><br>" + result.quality;
      } else {
        quality = icon + "error</i><br>" + result.quality;
      }
      $("#speed_result").html(quality + "<br>" + result.speed_mbps + " Mbps");
    })
    .catch(function (err) {
      console.log(err);
      $("#speed_result").html("Error: Could not perform speed test.");
    });
}
