// =============================================================================
// scrollbar.js — Scroll Controls & Sidenav (Tauri Version)
// =============================================================================
//
// IDENTICAL to original. No changes needed — these are pure DOM functions.
// =============================================================================

// ---------------------------------------------------------------------------
// Scroll up and down for song thumbnails (same as original)
// ---------------------------------------------------------------------------
function scroll_up() {
  $("#div_img_video_loader").stop(true, true).animate(
    {
      scrollTop: $("#div_img_video_loader").scrollTop() - 400,
    },
    400
  );
}

function scroll_down() {
  $("#div_img_video_loader").stop(true, true).animate(
    {
      scrollTop: $("#div_img_video_loader").scrollTop() + 400,
    },
    400
  );
}

// ---------------------------------------------------------------------------
// Scroll up and down for queue (same as original)
// ---------------------------------------------------------------------------
function scroll_up_queue() {
  $("#right-block-down").stop(true, true).animate(
    {
      scrollTop: $("#right-block-down").scrollTop() - 500,
    },
    500
  );
}

function scroll_down_queue() {
  $("#right-block-down").stop(true, true).animate(
    {
      scrollTop: $("#right-block-down").scrollTop() + 500,
    },
    500
  );
}

// ---------------------------------------------------------------------------
// Randomizer sidenav open/close (same as original)
// ---------------------------------------------------------------------------
function modifyNav(width, margin) {
  document.getElementById("mySidenav").style.width = width;
  document.getElementById("mySidenav").style.marginLeft = margin;
}
function openNav() {
  modifyNav("19vw", "0.5%");
}
function closeNav() {
  modifyNav("0", "0");
}
