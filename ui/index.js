// =============================================================================
// index.js — Main Application Entry Point (Tauri Version)
// =============================================================================
//
// This is the master controller. It initializes everything on DOM ready
// and contains the MediaElement.js player management.
//
// APPROACH: Create mejs ONCE, use setSrc() to change songs.
// ============================================================
// The player is created on the first song. For subsequent songs, we call
// mejs's built-in setSrc() which handles renderer switching (html5 ↔ YouTube)
// automatically — no destroy, no fullscreen loss, no DOM recreation.
//
// We only destroy + recreate (resetPlayer) in these cases:
//   1. Queue becomes empty (reset to idle state)
//   2. Shuffle array is exhausted (reset to idle state)
//   3. User overwrites a running shuffle
//   4. Playback error (corrupted player state)
// =============================================================================

// ---------------------------------------------------------------------------
// GLOBAL MEJS PLAYER STATE
// ---------------------------------------------------------------------------
var mejsPlayerInstance = null;

// The callback that runs when the current song ends.
// Updated by mejs_media_Player() on each song change.
var mejsCurrentRestarter = null;

// ---------------------------------------------------------------------------
// resetPlayer() — Tear down mejs and recreate a blank <video>
// ---------------------------------------------------------------------------
// Called ONLY when resetting to idle state (queue empty, shuffle done,
// overwrite shuffle, error). NOT called between normal song transitions.
function resetPlayer() {
  if (mejsPlayerInstance) {
    try {
      // Guard YouTube renderer's destroy (youTubeApi can be null)
      if (mejsPlayerInstance.node && mejsPlayerInstance.node.destroy) {
        var origDestroy = mejsPlayerInstance.node.destroy;
        mejsPlayerInstance.node.destroy = function () {
          try {
            origDestroy.call(mejsPlayerInstance.node);
          } catch (_) {}
        };
      }
      mejsPlayerInstance.remove();
    } catch (e) {
      console.warn("mejs cleanup warning:", e);
    }
    mejsPlayerInstance = null;
  }

  mejsCurrentRestarter = null;

  // Recreate a blank video element
  $("#video_container").empty();
  $("#video_container").html(
    "<video id='video' src='' autoplay preload='auto'></video>",
  );
  video_scaler();
}

// ---------------------------------------------------------------------------
// mejs_media_Player() — Play a song via mejs
// ---------------------------------------------------------------------------
// If the player doesn't exist yet, creates it (first song).
// If it already exists, uses setSrc() to change the source seamlessly —
// no destroy, no fullscreen loss, no DOM recreation.
function mejs_media_Player(func_restarter, sourceUrl) {
  mejsCurrentRestarter = func_restarter;

  if (mejsPlayerInstance) {
    // Player exists — just change the source.
    // mejs's setSrc handles renderer switching (html5 ↔ YouTube) internally.
    mejsPlayerInstance.setSrc(sourceUrl);
    mejsPlayerInstance.load();
    mejsPlayerInstance.play();
    return;
  }

  // First time — set src on the raw <video> element and create mejs.
  document.getElementById("video").src = sourceUrl;

  $("video").mediaelementplayer({
    iconSprite: "/jquery-framework/images/mejs-controls.svg",

    success: function (mediaElement, DOMObject, player) {
      mejsPlayerInstance = player;

      // "ended" — call the current restarter
      mediaElement.addEventListener("ended", function () {
        $("video").css("pointer-events", "auto");
        if (mejsCurrentRestarter) {
          mejsCurrentRestarter();
        }
      });

      // Volume sync
      mediaElement.addEventListener("play", function () {
        document.getElementById("video").volume = $("#vol").html() / 100;
      });
      mediaElement.addEventListener("rendererready", function () {
        document.getElementById("video").volume = $("#vol").html() / 100;
      });
      mediaElement.addEventListener("loadedmetadata", function () {
        document.getElementById("video").volume = $("#vol").html() / 100;
      });

      // Fullscreen auto-toggle on 7s inactivity (set up ONCE here)
      var fsTimeout = false;
      function checkActivity() {
        clearTimeout(fsTimeout);
        fsTimeout = setTimeout(function () {
          if (
            mejsPlayerInstance &&
            $("video").attr("src") != "" &&
            !mejsPlayerInstance.isFullScreen &&
            !mejsPlayerInstance.paused &&
            !mejsPlayerInstance.error &&
            mejsPlayerInstance.readyState == 4 &&
            (!displayKeyboard || $(".keyboard--hidden").length)
          ) {
            mejsPlayerInstance.enterFullScreen();
            $("video").attr("width", $("video").width());
            $("video").attr("height", $("video").height());
          }
        }, 7000);
      }
      ["mousedown", "mousemove", "click"].forEach(function (evt) {
        document.addEventListener(evt, checkActivity);
      });
      checkActivity();

      // Click to exit fullscreen / resume playback
      document
        .getElementsByClassName("mejs__mediaelement")[0]
        .addEventListener("click", function () {
          if (mejsPlayerInstance.isFullScreen) {
            mejsPlayerInstance.exitFullScreen();
            $("video").attr("width", $("video").width());
            $("video").attr("height", $("video").height());
          } else if (mejsPlayerInstance.paused) {
            mejsPlayerInstance.play();
          }
        });
    },

    error: function (e) {
      console.log("media element error:", e);
      resetPlayer();
      if (mejsCurrentRestarter) {
        var restarter = mejsCurrentRestarter;
        mejsCurrentRestarter = null;
        restarter();
      }
      jquery_modal({
        message:
          "Error usually comes via YouTube's content restrictions. Skipping to next song.",
        title: "An Error was Detected",
      });
    },

    clickToPlayPause: false,
    features: [
      "playpause",
      "progress",
      "current",
      "duration",
      "volume",
      "fullscreen",
    ],
    enableKeyboard: false,
    useFakeFullscreen: true,
    enableAutosize: true,

    youtube: {
      nocookie: false,
      origin: window.location.origin,
    },
  });
}

// =============================================================================
// INITIALIZATION — Runs once when the DOM is ready
// =============================================================================
$(document).ready(function () {
  window.ensureMusicStructure().then(function (validation) {
    if (!validation.valid) {
      return;
    }

    // Scale the video element to fit the container (same as original)
    video_scaler();

    // Disable text selection in the whole document (kiosk mode)
    selectTextDisabled();

    // Set up search input toggling (All Songs vs Karaoke)
    searchCondition();

    // Set up 80's auto-shuffle when idle
    autoShuffle();

    // Set up skip button handler
    skipVideo();

    // Auto-scroll queue to top after 10s of inactivity
    queue_scroll_top();

    // Initialize jQuery UI volume slider
    volume_slider();

    // Set up volume +/- buttons and mute toggle
    volume_changer();
  });
});

// ---------------------------------------------------------------------------
// Close randomizer sidenav when clicking outside (same as original)
// ---------------------------------------------------------------------------
$(document).click(function (e) {
  if (
    !$(e.target).closest(".sidenav").length &&
    !$(e.target).closest("#randomizer").length
  ) {
    closeNav();
  }
});

// ---------------------------------------------------------------------------
// video_scaler() — Scale video to fit container (same as original)
// ---------------------------------------------------------------------------
function video_scaler() {
  var $video = $("video");
  var $container = $("#video_container");
  var w = $container.width();
  var h = $container.height();
  $video
    .css({ width: w, height: h, "pointer-events": "auto" })
    .attr({ width: w, height: h });

  // Set initial volume on the video element
  var videoEl = document.getElementById("video");
  if (videoEl) {
    videoEl.volume = $("#vol").html() / 100;
  }
}

// ---------------------------------------------------------------------------
// selectTextDisabled() — Prevent text selection and image dragging (kiosk)
// ---------------------------------------------------------------------------
function selectTextDisabled() {
  $(document).on("selectstart", function (e) {
    e.preventDefault();
  });
  $(document).on("dragstart", function (e) {
    e.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// searchCondition() — Toggle search inputs based on select dropdown
// ---------------------------------------------------------------------------
function searchCondition() {
  $("#search_karaoke").hide();
  $("#select").selectmenu({
    change: function (event, data) {
      var isKaraoke = data.item.value == "karaoke";
      $("#search_karaoke").toggle(isKaraoke).focus();
      $("#search_all").toggle(!isKaraoke).focus();
    },
  });
}

// ---------------------------------------------------------------------------
// autoShuffle() — Auto-start 80's shuffle when idle (same as original)
// ---------------------------------------------------------------------------
function autoShuffle() {
  var timeout = false;
  function onActivity() {
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      if ($("video").attr("src") == "" && queue_array.length == 0) {
        // shuffleAjaxCall is aliased to shuffleIpcCall in shuffle.js
        shuffleAjaxCall("shuffle_80", 2);
      }
    }, 1);
  }

  ["mousedown", "mousemove", "click"].forEach(function (evt) {
    document.addEventListener(evt, onActivity);
  });
  onActivity();
}

// ---------------------------------------------------------------------------
// queue_scroll_top() — Auto-scroll queue to top after inactivity
// ---------------------------------------------------------------------------
function queue_scroll_top() {
  var timeout3 = false;
  function onActivity() {
    clearTimeout(timeout3);
    timeout3 = setTimeout(function () {
      $("#right-block-down").animate({ scrollTop: 0 }, 500);
    }, 10000);
  }

  ["mousedown", "mousemove", "click"].forEach(function (evt) {
    document.addEventListener(evt, onActivity);
  });
  onActivity();
}

// ---------------------------------------------------------------------------
// VOLUME CONTROLS (same as original)
// ---------------------------------------------------------------------------
var $volEl, $sliderEl, $muteEl, videoEl;

function _cacheVolumeElements() {
  $volEl = $("#vol");
  $sliderEl = $("#slider");
  $muteEl = $("#mute");
  videoEl = document.getElementById("video");
}

function _applyVolumeStyle(vol) {
  if (vol == 0) {
    videoEl.muted = true;
    $muteEl.html("volume_off").css("color", "#7e0000");
    $sliderEl.css("background-color", "#7e0000");
    $volEl.css("color", "#7e0000");
  } else {
    videoEl.muted = false;
    $muteEl.html("volume_up").css("color", "#155d62");
    $sliderEl.css("background-color", "white");
    $volEl.css("color", "#033e30");
  }
}

function volume_slider() {
  _cacheVolumeElements();
  $sliderEl.slider({
    animate: "fast",
    value: 50,
    min: 0,
    max: 100,
    step: 1,
    slide: function (event, ui) {
      $volEl.html(ui.value);
      videoEl.volume = ui.value / 100;
      _applyVolumeStyle(ui.value);
    },
  });
}

function volume_changer() {
  // Volume down button
  $("#vol_down").click(function () {
    var vol = parseInt($volEl.html());
    if (vol > 0) {
      vol--;
      $sliderEl.slider("value", vol);
      videoEl.volume = vol / 100;
      $volEl.html(vol);
      _applyVolumeStyle(vol);
    }
  });

  // Volume up button
  $("#vol_up").click(function () {
    var vol = parseInt($volEl.html());
    if (vol < 100) {
      vol++;
      $sliderEl.slider("value", vol);
      videoEl.volume = vol / 100;
      $volEl.html(vol);
    }
    _applyVolumeStyle(vol);
  });

  // Mute toggle
  var preMuteVolume = 0;
  var mutedByButton = false;

  $muteEl.click(function () {
    var vol = parseInt($volEl.html());
    if (vol > 0) {
      preMuteVolume = vol;
      mutedByButton = true;
      $sliderEl.slider("value", 0);
      videoEl.volume = 0;
      $volEl.html(0);
      _applyVolumeStyle(0);
    } else if (mutedByButton) {
      mutedByButton = false;
      $sliderEl.slider("value", preMuteVolume);
      videoEl.volume = preMuteVolume / 100;
      $volEl.html(preMuteVolume);
      _applyVolumeStyle(preMuteVolume);
    } else {
      jquery_modal({
        message:
          "Volume was already muted via slider. Use the <b style='font-size:1.2rem'>+</b> or <b style='font-size:1.8rem'>-</b>  button to set the volume.",
        title: "Volume Already Muted",
      });
    }
  });
}
