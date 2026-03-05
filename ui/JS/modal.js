// Default values for options
const defaults = {
  message: "",
  title: "",
  dialogClass: "no-closer",
  closeTime: 10000,
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

function jquery_modal(options) {
  // Merge default values with options and set countdown timer
  const settings = $.extend({}, defaults, options);
  countdown = settings.closeTime / 1000;

  //find the bigger of window (w,h)
  var windowWidth = $(window).width();
  var windowHeight = $(window).height();
  var maxDimension = Math.max(windowWidth, windowHeight);

  //main modal
  $("#dialog-confirm").html(settings.message);
  $("#dialog-confirm").dialog({
    title: settings.title,
    dialogClass: settings.dialogClass,
    resizable: false,
    draggable: false,
    show: { effect: "blind", duration: 500 },
    hide: { effect: "blind", duration: 400 },
    height: maxDimension * 0.12,
    width: maxDimension * 0.25,
    modal: true,
    open: function () {
      //clear any previous timers and start new one
      clearInterval(countdownInterval);
      countdownInterval = setInterval(function () {
        countdown--;
        $(".ui-dialog-title").html(settings.title + " (" + countdown + "s)");
        if (countdown <= 0) {
          $("#dialog-confirm").dialog("close");
        }
      }, 1000);
    },
    close: function () {
      clearInterval(countdownInterval);
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
}
