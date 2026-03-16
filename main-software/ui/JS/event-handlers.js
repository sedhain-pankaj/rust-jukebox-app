/**
 * event-handlers.js
 * -----------------
 * Attaches click handlers that were previously inline onclick="..." attributes.
 * CSP blocks inline event handlers when SHA hashes are present in script-src,
 * so we wire them up here via addEventListener instead.
 */
document.addEventListener("DOMContentLoaded", function () {
  // Sidenav close button
  var closebtn = document.getElementById("closebtn");
  if (closebtn) closebtn.addEventListener("click", closeNav);

  // Randomizer button → opens sidenav
  var randomizer = document.getElementById("randomizer");
  if (randomizer) randomizer.addEventListener("click", openNav);

  // YouTube search button
  var ytBtn = document.getElementById("youtube-btn");
  if (ytBtn) ytBtn.addEventListener("click", search_youtube);

  // Clear queue button
  var clearBtn = document.getElementById("clear");
  if (clearBtn) clearBtn.addEventListener("click", clear_Queue);

  // Queue scroll buttons (use class selector since IDs are duplicated
  // across queue and content sections — matching original PHP structure)
  var scrollUpQueue = document.querySelector(".scroll_up_queue");
  if (scrollUpQueue) scrollUpQueue.addEventListener("click", scroll_up_queue);

  var scrollDownQueue = document.querySelector(".scroll_down_queue");
  if (scrollDownQueue) scrollDownQueue.addEventListener("click", scroll_down_queue);

  // Content scroll buttons
  var scrollUpContent = document.querySelector(".scroll_up_content");
  if (scrollUpContent) scrollUpContent.addEventListener("click", scroll_up);

  var scrollDownContent = document.querySelector(".scroll_down_content");
  if (scrollDownContent) scrollDownContent.addEventListener("click", scroll_down);
});
