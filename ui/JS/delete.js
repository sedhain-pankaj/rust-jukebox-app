// =============================================================================
// delete.js — Remove Songs from Queue (Tauri Version)
// =============================================================================
//
// IDENTICAL to original. No changes needed — it only interacts with
// DOM elements, queue_array, and the jQuery UI modal.
// =============================================================================

// Remove songs from queue and from queue_array (same as original)
function queue_array_remove(element, dir) {
  jquery_modal({
    message: "This removes selected song from queue. Do you want to proceed?",
    title: "Delete Song from Queue",
    dialogClass: "show-closer",
    closeTime: 30000,
    buttonId: "delete_song_button",
    buttonIcon: "ui-icon-closethick",
    buttonText: "Remove Song",
    buttonColor: "#fd5c63",
    buttonAction: function () {
      var queue_array_index = queue_array.indexOf(dir);
      if (queue_array_index >= 0) {
        queue_array.splice(queue_array_index, 1);
      }
      if (typeof queue_lookup !== "undefined") {
        queue_lookup.delete(dir);
      }
      $(element).closest(".queue_div").remove();
      renumber_Queue();
    },
  });
}

function clear_Queue() {
  // Guard clause: checks if queue_array is empty
  if (queue_array.length == 0) {
    jquery_modal({
      message:
        "The queue is already empty. Songs can also be removed individually from the queue.",
      title: "Queue Already Empty",
    });
    return;
  }

  // Queue has items — prompt for password
  jquery_modal({
    message:
      "<input placeholder='Enter Password To Continue' id='clear_queue_input' autocomplete='off'>",
    title: "Clear the Queue. CAUTION !!!",
    dialogClass: "show-closer",
    closeTime: 45000,
    buttonId: "clear_queue_button",
    buttonIcon: "ui-icon-trash",
    buttonText: "Clear Queue",
    buttonColor: "#fd5c63",
    buttonAction: clearQueueAction,
    closeOnClick: false,
  });
}

function clearQueueAction() {
  var password = $("#clear_queue_input").val();

  // Guard clause: if password is incorrect
  if (password !== queue_clear_password) {
    $("#clear_queue_input").css("background-color", "red");
    $("#clear_queue_input").effect("shake", {
      direction: "left",
      distance: 20,
      times: 3,
    });
    setTimeout(function () {
      $("#clear_queue_input").css("background-color", "white");
    }, 1000);
    $("#clear_queue_input").val("");
    $("#clear_queue_input").attr(
      "placeholder",
      "Wrong Password Entered. Click to try again."
    );
    return;
  }

  // Password correct — clear queue
  clearInterval(countdownInterval);
  $("#dialog-confirm").dialog("close");
  document.activeElement.blur();

  $("#right-block-down").html("");
  queue_array.splice(0, queue_array.length);
  if (typeof queue_lookup !== "undefined") {
    queue_lookup.clear();
  }

  setTimeout(function () {
    jquery_modal({
      message:
        "The queue was cleared succcessfully. Click on thumbnails to repopulate it.",
      title: "Queue Cleared Successfully",
    });
  }, 500);
}

// Enter key triggers clear queue action (same as original)
$(document).on("keydown", "#clear_queue_input", function (e) {
  if (
    e.key === "Enter" &&
    document.activeElement === this &&
    $(this).val() !== ""
  ) {
    e.preventDefault();
    if (displayKeyboard) Keyboard.close();
    clearQueueAction();
  }
});
