// =============================================================================
// skip.js — Skip Song Function (Tauri Version)
// =============================================================================
//
// IDENTICAL to original. No changes needed — it only interacts with
// DOM elements and calls functions from queue.js and shuffle.js.
//
// The skipRandomizer() function works by dispatching a synthetic "ended"
// event on the video element, which triggers the mejs "ended" handler
// that calls the restarter callback (play_Queue or shuffler).
// =============================================================================

// Skip song function (same as original)
function skipVideo() {
  document.getElementById("skip_button").addEventListener("click", function () {
    if (
      $("video").attr("src") != "" &&
      dir_msg_collection.some(function (item) {
        return $("#video_title").text().includes(item);
      })
    ) {
      jquery_modal({
        message:
          "This skips the playing song. Next song will be from the " +
          (queue_array.length == 0 ? "current randomizer." : "queue."),
        title: "Skip the Randomizer",
        dialogClass: "show-closer",
        buttonText: "Skip",
        buttonAction: skipRandomizer,
      });
    } else {
      if ($("video").attr("src") == "") {
        jquery_modal({
          message:
            "Nothing is playing right now. Unable to skip. Restart the player.",
          title: "No Video Playing (ERROR)",
        });
      } else {
        if (queue_array.length == 0) {
          jquery_modal({
            message:
              "No songs present in queued section. Last randomizer will resume if you skip.",
            title: "Queue is Empty",
            dialogClass: "show-closer",
            buttonText: "Force Skip",
            buttonAction: skipRandomizer,
          });
        } else {
          jquery_modal({
            message:
              "This skips the current song and plays the next song in the queue.",
            title: "Skip the Queue",
            buttonText: "Skip",
            dialogClass: "show-closer",
            buttonAction: function () {
              play_Queue();
            },
          });
        }
      }
    }
  });
}

// Skip randomizer by triggering the "ended" flow.
//
// ORIGINAL: Dispatched a native "ended" Event on the raw <video> DOM element.
// That worked because the original code added its "ended" listener directly
// on the DOM video element.
//
// TAURI FIX: Our "ended" listener is on the mejs mediaElement wrapper
// (mejsPlayerInstance.media), which has its OWN dispatchEvent system
// (not the native DOM one). So we must dispatch through mejs.
// If mejs isn't available (edge case), fall back to calling the restarter
// directly.
function skipRandomizer() {
  var video = document.getElementById("video");
  video.pause();

  if (mejsPlayerInstance && mejsPlayerInstance.media) {
    // Dispatch through mejs's custom event system
    var event = { type: "ended" };
    mejsPlayerInstance.media.dispatchEvent(event);
  } else if (mejsCurrentRestarter) {
    // Fallback: call the restarter directly
    mejsCurrentRestarter();
  }
}
