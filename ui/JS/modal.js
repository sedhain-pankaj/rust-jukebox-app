// Default values for options
const defaults = {
  message: "",
  title: "",
  dialogClass: "no-closer",
  closeTime: 10000,
  height: null,
  width: null,
  buttonId: "continue_button",
  buttonIcon: "ui-icon-check",
  buttonText: "Continue",
  buttonAction: null,
  closeOnClick: true,
  buttonColor: "#23b28e",
};

// countdown timer starts on open and stops on close
let countdown;
let countdownInterval;

// Starts (or restarts) the auto-close countdown for the current modal.
// closeTime 0 = stay open indefinitely.
function startCountdown(settings) {
  clearInterval(countdownInterval);
  countdownInterval = null;
  if (settings.closeTime > 0) {
    countdown = settings.closeTime / 1000;
    countdownInterval = setInterval(function () {
      countdown--;
      $(".ui-dialog-title").html(settings.title + " (" + countdown + "s)");
      if (countdown <= 0) {
        $("#dialog-confirm").dialog("close");
      }
    }, 1000);
  }
}

function jquery_modal(options) {
  // Merge default values with options
  const settings = $.extend({}, defaults, options);

  // Every modal reuses this single #dialog-confirm widget ("modal slot").
  // When a modal is requested while the slot is still occupied — open, or
  // with a blind-close animation queued/running — we swap its content in
  // place instead of close-then-reopen, so the dialog never leaves the
  // screen (no close-animation -> gap -> open-animation jitter, e.g. the
  // clear-queue password box -> success box, admin confirm -> progress).
  var $dlg = $("#dialog-confirm");
  var inst = $dlg.dialog("instance");
  var $widget = inst ? $dlg.dialog("widget") : $();
  var swapping = !!(inst && $dlg.dialog("isOpen"));
  if (inst && !swapping && ($widget.is(":animated") || $widget.queue("fx").length > 0)) {
    // A blind hide is queued or running (e.g. a closeOnClick button fired
    // one tick earlier, or closeAnyModal() ran before this call). Cancel it
    // without letting it complete — the completed "close" event would clear
    // the countdown of the modal starting here — then reuse the slot.
    $widget.stop(true, false);
    $widget.css({ overflow: "", height: "", width: "" });
    if (!$widget.is(":visible")) $widget.show();
    swapping = true;
  }

  //find the bigger of window (w,h)
  var windowWidth = $(window).width();
  var windowHeight = $(window).height();
  var maxDimension = Math.max(windowWidth, windowHeight);

  // Admin mode dialogs should be taller and a bit wider for readability.
  var isAdminActive = !!(window.__adminMode && window.__adminMode.active);
  var defaultHeight = isAdminActive ? maxDimension * 0.35 : maxDimension * 0.13;
  var defaultWidth = isAdminActive ? maxDimension * 0.3 : maxDimension * 0.25;
  var dialogHeight = settings.height || defaultHeight;
  var dialogWidth = settings.width || defaultWidth;

  //main modal
  $("#dialog-confirm").html(settings.message);
  $("#dialog-confirm").dialog({
    title: settings.title,
    dialogClass: settings.dialogClass,
    resizable: false,
    draggable: false,
    // In-place swap: the dialog never leaves the screen, so no open
    // animation. Cold open: keep the blind reveal.
    show: swapping ? false : { effect: "blind", duration: 500 },
    hide: { effect: "blind", duration: 400 },
    height: dialogHeight,
    width: dialogWidth,
    modal: true,
    open: function () {
      startCountdown(settings);
    },
    close: function () {
      clearInterval(countdownInterval);
      countdownInterval = null;
    },
    buttons: [
      {
        id: settings.buttonId,
        icon: settings.buttonIcon,
        text: settings.buttonText,
        click: function () {
          if (settings.closeOnClick) $(this).dialog("close");
          if (settings.buttonAction) settings.buttonAction();
        },
      },
    ],
  });
  $("#" + settings.buttonId).css("background-color", settings.buttonColor);

  // The "open" event only refires when the slot was closed (mid-close swap).
  // For an already-open swap it does not — start the countdown ourselves.
  if (swapping) {
    startCountdown(settings);
  }
}
