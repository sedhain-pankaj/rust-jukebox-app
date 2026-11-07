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

// Parallel to shuffleArrays: the display name, pre-escaped by Rust
// (get_shuffle_paths now returns { path_abs, name_escaped }). Shuffled
// in lockstep with the URL arrays so index i always pairs a URL with
// its own name.
var shuffleNames = {
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
// (The sidenav links themselves are hardcoded in index.html — the order
// there must match the key order of shuffleArrays, which drives the
// dir_msg_collection index in the click binding below.)

// ---------------------------------------------------------------------------
// shuffleIpcCall() — Fetch paths from Rust and shuffle them
// ---------------------------------------------------------------------------
// REPLACES the original shuffleAjaxCall().
// Guard flag — prevents concurrent IPC shuffle calls.
// Without this, autoShuffle()'s triggers (startup, activity debounce, and the
// scheduled idle-restart retries in index.js) can fire multiple times before
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
    .then(function (songs) {
      // songs = array of { path_abs, name_escaped } from Rust
      // Convert each path to a media-server URL (the <video> element on
      // Linux can't play asset:// URLs — see mediaUrl() in config.js)
      shuffleArrays[key] = songs.map(function (s) {
        return mediaUrl(s.path_abs);
      });
      // names follow the same order (pre-escaped in Rust — backlog:
      // no more decodeURIComponent + extension-strip in the JS)
      shuffleNames[key] = songs.map(function (s) {
        return s.name_escaped;
      });

      // Fisher-Yates shuffle — randomize the array
      // (same algorithm as the original). Names are shuffled in
      // lockstep so every URL keeps its own display name.
      for (var i = shuffleArrays[key].length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));

        var tempUrl = shuffleArrays[key][i];
        shuffleArrays[key][i] = shuffleArrays[key][j];
        shuffleArrays[key][j] = tempUrl;

        var tempName = shuffleNames[key][i];
        shuffleNames[key][i] = shuffleNames[key][j];
        shuffleNames[key][j] = tempName;
      }

      shuffleIpcLoading = false;
      show_shuffle_msg(
        shuffleArrays[key],
        shuffleNames[key],
        dir_msg_collection[index],
      );
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
// `names` is the parallel array of Rust-pre-escaped display names.
function shuffler(array, names, dir_msg) {
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

    // Schedule the auto-shuffle restart (NOT an inline triggerAutoShuffleIfIdle):
    // mejs's teardown after resetPlayer() settles over a short window and an
    // immediate check could still see the previous song's state, which is what
    // made the second cycle wait for a mouse move / fake click. The scheduled
    // retries in index.js need no user input.
    if (typeof scheduleAutoShuffleRestart === "function") {
      scheduleAutoShuffleRestart();
    }
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

    // Swap the modal's content in place (no close -> gap -> open jitter);
    // jquery_modal restarts the countdown, and if no modal is open this is
    // just a normal open.
    jquery_modal({
      message:
        "Queued songs have finished. The last played randomizer will resume.",
      title: "Resuming Previous Randomizer",
      closeTime: 5000,
    });
  }

  // If queue has songs, play from queue first (queue gets priority)
  function relooper_shuffle() {
    if (queue_array.length > 0) {
      // Save ourselves so play_Queue can hand back when queue empties
      pendingShuffleRestarter = relooper_shuffle;
      play_Queue();
    } else {
      pendingShuffleRestarter = null;
      shuffler(array, names, dir_msg);
    }
  }

  // MEJS FIX: Pass source URL directly to mejs_media_Player.
  // Do NOT set video.src first — mejs's setSrc interceptor would consume it.
  mejs_media_Player(relooper_shuffle, array[0]);

  // Set video title from the Rust-pre-escaped name (the JS used to
  // re-derive it from the URL: decodeURIComponent + split + strip
  // extension — that work now happens once in Rust's scan_directory).
  var video_title = document.getElementById("video_title");
  video_title.textContent = dir_msg + (names[0] || "");

  // Remove the played song from the array (name follows its URL)
  array.shift();
  names.shift();
}

// ---------------------------------------------------------------------------
// show_shuffle_msg() — Guard clauses before starting shuffle
// ---------------------------------------------------------------------------
// Same logic as original. Checks for existing shuffle/queue conflicts.
function show_shuffle_msg(array, names, dir_msg) {
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
        shuffler(array, names, dir_msg);
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
  shuffler(array, names, dir_msg);
}
