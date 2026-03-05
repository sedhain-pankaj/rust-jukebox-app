// =============================================================================
// shuffle.js — Randomizer / Shuffle Playback (Tauri Version)
// =============================================================================
//
// ORIGINAL (PHP version):
//   Each shuffle button triggered an AJAX call to logic.php with a key like
//   "shuffle_80". PHP returned file paths separated by <br> tags.
//   The JS split on <br>, shuffled the array, then played sequentially.
//
// NEW (Tauri version):
//   Each shuffle button calls Rust's get_shuffle_paths IPC command.
//   Rust returns a clean JSON array of absolute file paths.
//   We convert them to Tauri asset URLs, shuffle, and play sequentially.
//
// MEJS LIFECYCLE:
//   The player is created ONCE. Subsequent songs use setSrc() to change
//   the source without destroying the player. resetPlayer() is only called
//   on idle reset or shuffle overwrite. See index.js.
// =============================================================================

// ---------------------------------------------------------------------------
// TAURI IPC HELPER (same as songs.js)
// ---------------------------------------------------------------------------
var _invoke = window.__TAURI__.core.invoke;
var _convertFileSrc = window.__TAURI__.core.convertFileSrc;

// ---------------------------------------------------------------------------
// SHUFFLE ARRAYS — Hold the shuffled song paths per category
// ---------------------------------------------------------------------------
// Same structure as original. Keys match the shuffle button IDs.
// When relooper_shuffle hands off to play_Queue, we save the relooper so
// play_Queue can hand back to the shuffle when the queue empties.
var pendingShuffleRestarter = null;

var shuffleArrays = {
  shuffle_5060: [],
  shuffle_70: [],
  shuffle_80: [],
  shuffle_90: [],
  shuffle_2000: [],
  shuffle_LatestHits: [],
  shuffle_Country: [],
  shuffle_SpecialOccasion: [],
  shuffle_ChristmasSong: [],
};

// ---------------------------------------------------------------------------
// SHUFFLE CATEGORY MESSAGES
// ---------------------------------------------------------------------------
// Same as original — shown in the video title during shuffle playback.
const dir_msg_collection = [
  "(50's & 60's Shuffle): ",
  "(70's Shuffle): ",
  "(80's Shuffle): ",
  "(90's Shuffle): ",
  "(2000's Shuffle): ",
  "(Latest Hits Shuffle): ",
  "(Country Shuffle): ",
  "(Special Occasion Shuffle): ",
  "(Christmas Song Shuffle): ",
];

// ---------------------------------------------------------------------------
// Mapping from shuffle keys to Rust category keys
// ---------------------------------------------------------------------------
// The Rust backend uses category keys like "5060", "70", "80", etc.
// The shuffle buttons use "shuffle_5060", "shuffle_70", etc.
// This map strips the "shuffle_" prefix to get the Rust key.
var shuffleToRustKey = {
  shuffle_5060: "5060",
  shuffle_70: "70",
  shuffle_80: "80",
  shuffle_90: "90",
  shuffle_2000: "2000",
  shuffle_LatestHits: "LatestHits",
  shuffle_Country: "Country",
  shuffle_SpecialOccasion: "SpecialOccasion",
  shuffle_ChristmasSong: "ChristmasSong",
};

// ---------------------------------------------------------------------------
// Shuffle category names for building the sidenav links
// ---------------------------------------------------------------------------
var shuffleCategoryNames = {
  shuffle_5060: "50's + 60's",
  shuffle_70: "70's",
  shuffle_80: "80's",
  shuffle_90: "90's",
  shuffle_2000: "2000's",
  shuffle_LatestHits: "Latest Hits",
  shuffle_Country: "Country",
  shuffle_SpecialOccasion: "Special Occasion",
  shuffle_ChristmasSong: "Christmas Song",
};

// ---------------------------------------------------------------------------
// BUILD SHUFFLE SIDENAV LINKS ON STARTUP
// ---------------------------------------------------------------------------
// In the original PHP, these were built with <?php foreach ?>
// Now we build them in JS from the shuffleCategoryNames map.
$(function () {
  var linksContainer = document.getElementById("shuffle-links");
  if (linksContainer) {
    Object.keys(shuffleCategoryNames).forEach(function (key) {
      var link = document.createElement("a");
      link.id = key;
      link.textContent = shuffleCategoryNames[key];
      link.style.cursor = "pointer";
      linksContainer.appendChild(link);
      linksContainer.appendChild(document.createElement("br"));
    });
  }
});

// ---------------------------------------------------------------------------
// shuffleIpcCall() — Fetch paths from Rust and shuffle them
// ---------------------------------------------------------------------------
// REPLACES the original shuffleAjaxCall().
// Guard flag — prevents concurrent IPC shuffle calls.
// Without this, autoShuffle()'s 1ms debounce can fire multiple times before
// the first response sets video.src, causing the "overwrite" modal on refresh.
var shuffleIpcLoading = false;

// Instead of AJAX to logic.php, calls Rust's get_shuffle_paths IPC command.
function shuffleIpcCall(key, index) {
  if (shuffleIpcLoading) return;

  var rustKey = shuffleToRustKey[key];
  if (!rustKey) {
    console.error("Unknown shuffle key:", key);
    return;
  }

  shuffleIpcLoading = true;

  _invoke("get_shuffle_paths", { key: rustKey })
    .then(function (paths) {
      // paths = array of absolute file paths from Rust
      // Convert each to a Tauri asset URL
      shuffleArrays[key] = paths.map(function (p) {
        return _convertFileSrc(p);
      });

      // Fisher-Yates shuffle — randomize the array
      // (same algorithm as the original)
      for (var i = shuffleArrays[key].length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = shuffleArrays[key][i];
        shuffleArrays[key][i] = shuffleArrays[key][j];
        shuffleArrays[key][j] = temp;
      }

      shuffleIpcLoading = false;
      show_shuffle_msg(shuffleArrays[key], dir_msg_collection[index]);
    })
    .catch(function (error) {
      shuffleIpcLoading = false;
      console.error("Failed to get shuffle paths for " + key + ":", error);
    });
}

// Alias for backward compatibility with autoShuffle() in index.js
// The original used shuffleAjaxCall — now it's IPC but same signature.
var shuffleAjaxCall = shuffleIpcCall;

// ---------------------------------------------------------------------------
// BIND CLICK HANDLERS TO SHUFFLE BUTTONS
// ---------------------------------------------------------------------------
// Same as original — each shuffle button ID triggers the IPC call.
$(function () {
  Object.keys(shuffleArrays).forEach(function (key, index) {
    // Use event delegation since links are built dynamically
    $(document).on("click", "#" + key, function () {
      shuffleIpcCall(key, index);
    });
  });
});

// ---------------------------------------------------------------------------
// shuffler() — Play songs sequentially from the shuffled array
// ---------------------------------------------------------------------------
// Same logic as original. KEY CHANGE: proper mejs destroy before re-init.
function shuffler(array, dir_msg) {
  if (array.length == 0) {
    // Shuffle finished — reset player
    $("#video_title").text("Video Title");
    pendingShuffleRestarter = null;

    // Reset player to idle state
    resetPlayer();

    // 80's auto-shuffle triggers when any shuffle ends
    jquery_modal({
      message:
        "80's Shuffle triggers automatically when queued song or previous randomizer ends.",
      title: "80's Shuffle Started",
      closeTime: 5000,
    });

    // Trigger auto-shuffle detection (same trick as original)
    $("#queue_header").click();
    return;
  }

  // If switching from queue to shuffle, destroy player and notify
  closeNav();
  if (
    !dir_msg_collection.some(function (item) {
      return $("#video_title").text().includes(item);
    }) &&
    !$("#video_title").text().includes("Video Title")
  ) {
    // Reset player before starting shuffle from queue context
    resetPlayer();

    // Clear previous interval and show resume message
    clearInterval(countdownInterval);
    $("#dialog-confirm").dialog("close");
    setTimeout(function () {
      jquery_modal({
        message:
          "Queued songs have finished. The last played randomizer will resume.",
        title: "Resuming Previous Randomizer",
        closeTime: 5000,
      });
    }, 500);
  }

  // If queue has songs, play from queue first (queue gets priority)
  function relooper_shuffle() {
    if (queue_array.length > 0) {
      // Save ourselves so play_Queue can hand back when queue empties
      pendingShuffleRestarter = relooper_shuffle;
      play_Queue();
    } else {
      pendingShuffleRestarter = null;
      shuffler(array, dir_msg);
    }
  }

  // MEJS FIX: Pass source URL directly to mejs_media_Player.
  // Do NOT set video.src first — mejs's setSrc interceptor would consume it.
  mejs_media_Player(relooper_shuffle, array[0]);

  // Set video title (extract filename from the asset URL path)
  var video_title = document.getElementById("video_title");
  // Asset URLs look like: https://asset.localhost/C:/Users/.../Song.mp4
  // We need to extract just "Song" (without extension)
  var fullPath = decodeURIComponent(array[0]);
  var fileName = fullPath.split("/").pop();
  if (fileName.includes(".")) {
    fileName = fileName.substring(0, fileName.lastIndexOf("."));
  }
  video_title.innerHTML = dir_msg + fileName;

  // Remove the played song from the array
  array.shift();
}

// ---------------------------------------------------------------------------
// show_shuffle_msg() — Guard clauses before starting shuffle
// ---------------------------------------------------------------------------
// Same logic as original. Checks for existing shuffle/queue conflicts.
function show_shuffle_msg(array, dir_msg) {
  // If a previous shuffle is playing, ask to overwrite
  if (
    $("video").attr("src") != "" &&
    dir_msg_collection.some(function (item) {
      return $("#video_title").text().includes(item);
    })
  ) {
    jquery_modal({
      message:
        "A previous randomizer was detected. Do you wish to overwrite it?",
      title: "Overwrite Previous Randomizer !!!",
      dialogClass: "show-closer",
      buttonText: "Overwrite",
      buttonAction: function () {
        // Reset player before overwriting shuffle
        pendingShuffleRestarter = null;
        resetPlayer();
        shuffler(array, dir_msg);
      },
      closeTime: 30000,
    });
    return;
  }

  // If a queued song is playing, wait for it to finish
  if (
    $("video").attr("src") != "" &&
    !dir_msg_collection.some(function (item) {
      return $("#video_title").text().includes(item);
    })
  ) {
    jquery_modal({
      message:
        "Queue gets priority over Randomizer. Wait for queued song to finish completely.",
      title: "Finish Queued Song First",
      buttonText: "Ok. I'll wait",
      closeTime: 15000,
    });
    return;
  }

  // No conflicts — start the shuffle
  shuffler(array, dir_msg);
}
