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

// ---------------------------------------------------------------------------
// sendLogToTerminal() — Forward a log line to the Rust terminal
// ---------------------------------------------------------------------------
// Emits the "mejs-terminal-log" event; main.rs listens for it and prints the
// payload into the terminal running `cargo tauri dev`. This lets us watch mejs
// errors without opening the webview devtools console.
function formatConsoleArgs(args) {
  var parts = [];
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (typeof a === "string") {
      parts.push(a);
    } else {
      try {
        parts.push(JSON.stringify(a));
      } catch (_) {
        parts.push(String(a));
      }
    }
  }
  return parts.join(" ");
}

function sendLogToTerminal(level, message) {
  try {
    var tauri = window.__TAURI__;
    if (tauri && tauri.event && typeof tauri.event.emit === "function") {
      tauri.event.emit("mejs-terminal-log", "[" + level + "] " + message);
    }
  } catch (_) {
    // Never let the logging bridge break playback.
  }
}

// Pipe console.error / console.warn into the Rust terminal as well. mejs and
// the webview engine report media failures here (e.g. "can't handle the path
// assets://"), and without this hook those messages are only visible in
// devtools.
(function () {
  var origError = console.error;
  var origWarn = console.warn;
  console.error = function () {
    origError.apply(console, arguments);
    sendLogToTerminal("console.error", formatConsoleArgs(arguments));
  };
  console.warn = function () {
    origWarn.apply(console, arguments);
    var msg = formatConsoleArgs(arguments);
    // Known-benign Tauri/Linux one-time noise (IPC falls back to
    // postMessage) — still visible in the devtools console, but not
    // worth a terminal line.
    if (msg.indexOf("IPC custom protocol failed") !== -1) {
      return;
    }
    sendLogToTerminal("console.warn", msg);
  };
})();

// The callback that runs when the current song ends.
// Updated by mejs_media_Player() on each song change.
var mejsCurrentRestarter = null;

// Global UI activity handlers are bound once to avoid duplicate listeners
// after player reset/re-init cycles.
var fullscreenActivityTimeout = null;
var fullscreenActivityBound = false;

function forceFakeFullscreen(player) {
  if (!player) {
    return;
  }
  player.options.useFakeFullscreen = true;
  player.fullscreenMode = "";
  player.isNativeFullScreen = false;
  player.detectFullscreenMode = function () {
    this.fullscreenMode = "";
    return "";
  };
}

function scheduleFullscreenCheck() {
  clearTimeout(fullscreenActivityTimeout);
  fullscreenActivityTimeout = setTimeout(function () {
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

function bindFullscreenActivityListenersOnce() {
  if (fullscreenActivityBound) {
    return;
  }
  ["mousedown", "click", "touchstart", "keydown"].forEach(function (evt) {
    document.addEventListener(evt, scheduleFullscreenCheck);
  });
  fullscreenActivityBound = true;
}
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

  // Recreate a blank video element. preload='metadata' (matches the initial
  // markup in index.html) — lighter on a slow disk than 'auto'.
  $("#video_container").empty();
  $("#video_container").html(
    "<video id='video' src='' autoplay preload='metadata'></video>",
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
    applyCurrentVolumeToMedia();
    mejsPlayerInstance.play();
    return;
  }

  // First time — set src on the raw <video> element and create mejs.
  document.getElementById("video").src = sourceUrl;

  $("video").mediaelementplayer({
    iconSprite: "/jquery-framework/images/mejs-controls.svg",

    success: function (mediaElement, DOMObject, player) {
      mejsPlayerInstance = player;
      forceFakeFullscreen(player);

      // "ended" - call the current restarter
      mediaElement.addEventListener("ended", function () {
        $("video").css("pointer-events", "auto");
        if (mejsCurrentRestarter) {
          mejsCurrentRestarter();
        }
      });

      // Volume sync
      mediaElement.addEventListener("play", function () {
        applyCurrentVolumeToMedia();
      });
      mediaElement.addEventListener("rendererready", function () {
        applyCurrentVolumeToMedia();
      });
      mediaElement.addEventListener("loadedmetadata", function () {
        applyCurrentVolumeToMedia();
      });

      // Fullscreen auto-toggle on inactivity (bound once globally)
      bindFullscreenActivityListenersOnce();
      scheduleFullscreenCheck();

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
      var details = "";
      try {
        details =
          "code=" + (e && e.code) +
          ", message=" + (e && e.message) +
          ", src=" + (mejsPlayerInstance ? mejsPlayerInstance.media.src : "");
      } catch (_) {
        details = JSON.stringify(e);
      }
      sendLogToTerminal("mejs error", details);
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
// Normal-mode initialization. Runs behind the startup gate at page load
// (every load, including the "Start Jukebox" reload from admin mode).
window.initJukeboxUI = function (validation) {
  if (!validation) {
    return; // admin mode owns the UI, or validation failed
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
};

$(document).ready(function () {
  // Shared startup gate (validation.js): admin check + media server port +
  // music structure validation, memoized. The shuffle path builds video
  // URLs, so the port must be known before this resolves.
  window.startupGate().then(function (validation) {
    window.initJukeboxUI(validation);
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
    applyCurrentVolumeToMedia();
  }
}

// ---------------------------------------------------------------------------
// selectTextDisabled() — Prevent text selection and image dragging (kiosk)
// ---------------------------------------------------------------------------
function selectTextDisabled(scope) {
  var $scope = scope ? $(scope) : $(document);
  $scope.on("selectstart", function (e) {
    e.preventDefault();
  });
  $scope.on("dragstart", function (e) {
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
// autoShuffle() — Auto-start 80's shuffle when idle
// ---------------------------------------------------------------------------
// The restart is SCHEDULED (not run inline) whenever the player goes idle:
// mejs's teardown after resetPlayer() settles over a short window, and an
// immediate guard check can still see the previous song's state on <video>,
// which made the 80's shuffle fail to restart until user activity (the old
// fake-click / mouse-movement workaround). A few delayed attempts let the
// teardown settle; once a song is playing the guard fails harmlessly and
// shuffleIpcLoading (shuffle.js) prevents a double IPC.
//
// NOTE: the old mousedown/click/touchstart/keydown activity listener that
// re-triggered the shuffle on user input was the remnant of that fake-click
// workaround — it is removed. The restart is now fully autonomous: startup
// and every shuffle/queue end (shuffler and play_Queue in shuffle.js /
// queue.js) call scheduleAutoShuffleRestart().
var autoShuffleRestartTimer = null;

function triggerAutoShuffleIfIdle() {
  if ($("video").attr("src") == "" && queue_array.length == 0) {
    // shuffleAjaxCall is aliased to shuffleIpcCall in shuffle.js
    shuffleAjaxCall("shuffle_80", 2);
    return true;
  }
  return false;
}

function scheduleAutoShuffleRestart() {
  if (autoShuffleRestartTimer) {
    clearTimeout(autoShuffleRestartTimer);
  }
  var attempt = 0;
  (function tryRestart() {
    if (triggerAutoShuffleIfIdle()) {
      autoShuffleRestartTimer = null;
      return;
    }
    attempt += 1;
    if (attempt < 5) {
      autoShuffleRestartTimer = setTimeout(tryRestart, 1000);
    } else {
      autoShuffleRestartTimer = null;
    }
  })();
}

function autoShuffle() {
  // Startup: try immediately (the app starts idle), and arm the delayed
  // retries (up to ~5 s) in case the immediate check races startup.
  triggerAutoShuffleIfIdle();
  scheduleAutoShuffleRestart();
}

// ---------------------------------------------------------------------------
// queue_scroll_top() — Auto-scroll queue to top after inactivity
// ---------------------------------------------------------------------------
function queue_scroll_top() {
  var timeout3 = false;
  function onActivity() {
    clearTimeout(timeout3);
    timeout3 = setTimeout(function () {
      $("#right-block-down").stop(true, true).animate({ scrollTop: 0 }, 500);
    }, 10000);
  }

  ["mousedown", "click", "touchstart", "keydown"].forEach(function (evt) {
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

function _getActiveMedia() {
  if (mejsPlayerInstance && mejsPlayerInstance.media) {
    return mejsPlayerInstance.media;
  }
  return document.getElementById("video");
}

function _setMediaVolume(vol) {
  var safeVol = Math.max(0, Math.min(100, parseInt(vol, 10) || 0));
  var volume = safeVol / 100;
  var isMuted = safeVol === 0;
  var activeMedia = _getActiveMedia();
  var rawVideo = document.getElementById("video");

  if (
    mejsPlayerInstance &&
    typeof mejsPlayerInstance.setVolume === "function"
  ) {
    mejsPlayerInstance.setVolume(volume);
    if (typeof mejsPlayerInstance.setMuted === "function") {
      mejsPlayerInstance.setMuted(isMuted);
    }
  } else if (activeMedia) {
    activeMedia.volume = volume;
    activeMedia.muted = isMuted;
  }

  if (rawVideo) {
    rawVideo.volume = volume;
    rawVideo.muted = isMuted;
  }
}

function applyCurrentVolumeToMedia() {
  var vol = parseInt($("#vol").html(), 10);
  if (isNaN(vol)) {
    vol = 50;
  }
  _setMediaVolume(vol);
}

function _applyVolumeStyle(vol) {
  _cacheVolumeElements();
  if (vol == 0) {
    $muteEl.html("volume_off").css("color", "#7e0000");
    $sliderEl.css("background-color", "#7e0000");
    $volEl.css("color", "#7e0000");
  } else {
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
      _setMediaVolume(ui.value);
      _applyVolumeStyle(ui.value);
    },
  });
}

function volume_changer() {
  // Volume down button
  $("#vol_down").click(function () {
    var vol = parseInt($volEl.html(), 10);
    if (vol > 0) {
      vol--;
      $sliderEl.slider("value", vol);
      $volEl.html(vol);
      _setMediaVolume(vol);
      _applyVolumeStyle(vol);
    }
  });

  // Volume up button
  $("#vol_up").click(function () {
    var vol = parseInt($volEl.html(), 10);
    if (vol < 100) {
      vol++;
      $sliderEl.slider("value", vol);
      $volEl.html(vol);
    }
    _setMediaVolume(vol);
    _applyVolumeStyle(vol);
  });

  // Mute toggle
  var preMuteVolume = 0;
  var mutedByButton = false;

  $muteEl.click(function () {
    var vol = parseInt($volEl.html(), 10);
    if (vol > 0) {
      preMuteVolume = vol;
      mutedByButton = true;
      $sliderEl.slider("value", 0);
      $volEl.html(0);
      _setMediaVolume(0);
      _applyVolumeStyle(0);
    } else if (mutedByButton) {
      mutedByButton = false;
      $sliderEl.slider("value", preMuteVolume);
      $volEl.html(preMuteVolume);
      _setMediaVolume(preMuteVolume);
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
