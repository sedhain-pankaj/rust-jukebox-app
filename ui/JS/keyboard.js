const displayKeyboard = true; // Set to false to disable the on-screen keyboard
const timeBeforeClose = 60;

const Keyboard = {
  elements: {
    main: null,
    keysContainer: null,
    keys: [],
    activeInput: null,
  },

  eventHandlers: {
    oninput: null,
    onclose: null,
  },

  properties: {
    value: "",
    capsLock: false,
    timeRemaining: timeBeforeClose,
    pause: false,
    pauseTimeout: null,
  },

  // Handler to sync properties.value when physical keyboard is used
  _physicalInputHandler: null,

  init() {
    // Create main elements
    this.elements.main = document.createElement("div");
    this.elements.keysContainer = document.createElement("div");

    // Setup main elements
    this.elements.main.classList.add("keyboard", "keyboard--hidden");
    this.elements.keysContainer.classList.add("keyboard__keys");
    this.elements.keysContainer.appendChild(this._createKeys());

    this.elements.keys =
      this.elements.keysContainer.querySelectorAll(".keyboard__key");

    // Cache the space key element for the timer updates
    this.elements.spaceKey = this.elements.keysContainer.querySelector(
      ".keyboard__key--extra-wide",
    );

    // Add to DOM
    this.elements.main.appendChild(this.elements.keysContainer);
    document.body.appendChild(this.elements.main);

    // Bind the physical input handler once
    this._physicalInputHandler = () => {
      if (this.elements.activeInput) {
        this.properties.value = this.elements.activeInput.value;
        this._triggerEvent("oninput");
      }
    };

    // Add event listeners for inputs added later
    document.addEventListener("click", (event) => {
      if (event.target.tagName === "INPUT") {
        this.open(
          event.target.value,
          (currentValue) => {
            event.target.value = currentValue;
            event.target.dispatchEvent(new Event("click"));
          },
          null,
          event.target,
        );
      }
    });
  },

  _createKeys() {
    const fragment = document.createDocumentFragment();
    const keyLayout = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "backspace",
      "q",
      "w",
      "e",
      "r",
      "t",
      "y",
      "u",
      "i",
      "o",
      "p",
      "a",
      "s",
      "d",
      "f",
      "g",
      "h",
      "j",
      "k",
      "l",
      "Enter",
      "caps",
      "z",
      "x",
      "c",
      "v",
      "b",
      "n",
      "m",
      "done",
      "space",
    ];

    // Creates HTML for an icon
    const createIconHTML = (icon_name) => {
      return `<i class="material-icons">${icon_name}</i>`;
    };

    keyLayout.forEach((key) => {
      const keyElement = document.createElement("button");
      const insertLineBreak =
        ["backspace", "p", "Enter", "done"].indexOf(key) !== -1;

      // Add attributes/classes
      keyElement.setAttribute("type", "button");
      keyElement.classList.add("keyboard__key");

      switch (key) {
        case "backspace":
          keyElement.classList.add("keyboard__key--wide");
          keyElement.innerHTML =
            "Delete" + "&nbsp" + createIconHTML("backspace");

          keyElement.addEventListener("click", () => {
            this.properties.value = this.properties.value.substring(
              0,
              this.properties.value.length - 1,
            );
            this._triggerEvent("oninput");
          });

          break;

        case "caps":
          keyElement.classList.add(
            "keyboard__key--wide",
            "keyboard__key--activatable",
          );
          keyElement.innerHTML = createIconHTML("keyboard_capslock");

          keyElement.addEventListener("click", () => {
            this._toggleCapsLock();
            keyElement.classList.toggle(
              "keyboard__key--active",
              this.properties.capsLock,
            );
          });

          break;

        case "Enter":
          keyElement.classList.add(
            "keyboard__key--wide",
            "keyboard__key--dark",
          );
          keyElement.innerHTML =
            "Enter " + "&nbsp" + createIconHTML("keyboard_return");

          //load youtube if search_query is visible and not empty
          keyElement.addEventListener("click", () => {
            this.properties.value += "\n";
            this._triggerEvent("oninput");
            if (
              $("#search_query").is(":visible") &&
              $("#search_query").val() != ""
            ) {
              load_youtube();
            }
            this.close();
          });

          break;

        case "space":
          keyElement.classList.add("keyboard__key--extra-wide");
          keyElement.innerHTML =
            "Space" +
            "&nbsp" +
            createIconHTML("space_bar") +
            ` (${this.properties.timeRemaining}s)`;

          keyElement.addEventListener("click", () => {
            this.properties.value += " ";
            this._triggerEvent("oninput");
          });

          break;

        case "done":
          keyElement.classList.add("keyboard__key--wide");
          keyElement.innerHTML =
            "Close " + "&nbsp" + createIconHTML("arrow_downward");

          keyElement.addEventListener("click", () => {
            this.close();
            this._triggerEvent("onclose");
          });

          break;

        default:
          keyElement.textContent = key.toLowerCase();

          keyElement.addEventListener("click", () => {
            this.properties.value += this.properties.capsLock
              ? key.toUpperCase()
              : key.toLowerCase();
            this._triggerEvent("oninput");

            //pause the timer for 5 seconds when a key is pressed
            this.pause = true;
            //Keeps extending the timer if a key is pressed by clearing old one
            clearTimeout(this.pauseTimeout);
            this.pauseTimeout = setTimeout(() => {
              this.pause = false;
            }, 5000);
          });

          break;
      }

      fragment.appendChild(keyElement);

      if (insertLineBreak) {
        fragment.appendChild(document.createElement("br"));
      }
    });

    return fragment;
  },

  _triggerEvent(handlerName) {
    if (typeof this.eventHandlers[handlerName] == "function") {
      this.eventHandlers[handlerName](this.properties.value);
    }
  },

  _toggleCapsLock() {
    this.properties.capsLock = !this.properties.capsLock;

    for (const key of this.elements.keys) {
      if (key.childElementCount === 0) {
        key.textContent = this.properties.capsLock
          ? key.textContent.toUpperCase()
          : key.textContent.toLowerCase();
      }
    }
  },

  open(initialValue, oninput, onclose, inputElement) {
    this.properties.value = initialValue || "";
    this.eventHandlers.oninput = oninput;
    this.eventHandlers.onclose = onclose;
    this.elements.main.classList.remove("keyboard--hidden");

    // Track active input and listen for physical keyboard input
    if (this.elements.activeInput) {
      this.elements.activeInput.removeEventListener(
        "input",
        this._physicalInputHandler,
      );
    }
    this.elements.activeInput = inputElement || null;
    if (this.elements.activeInput) {
      this.elements.activeInput.addEventListener(
        "input",
        this._physicalInputHandler,
      );
    }

    //sets the timer to close and shows it on space-key
    clearInterval(this.interval);
    this.pause = false;

    this.interval = setInterval(() => {
      if (!this.pause) {
        this.properties.timeRemaining--;
        this.elements.spaceKey.innerHTML =
          "Space" +
          "&nbsp" +
          "<i class='material-icons'>space_bar</i>" +
          ` (${this.properties.timeRemaining}s)`;
        if (this.properties.timeRemaining === 0) {
          this.close();
        }
      }
    }, 1000);
  },

  close() {
    this.properties.value = "";
    this.eventHandlers.oninput = oninput;
    this.eventHandlers.onclose = onclose;
    this.elements.main.classList.add("keyboard--hidden");

    // Remove physical keyboard listener from active input
    if (this.elements.activeInput) {
      this.elements.activeInput.removeEventListener(
        "input",
        this._physicalInputHandler,
      );
      this.elements.activeInput = null;
    }

    //reset the timer and sets it to its original value
    clearInterval(this.interval);
    this.properties.timeRemaining = timeBeforeClose;

    //change the space key back to original timer
    this.elements.spaceKey.innerHTML =
      "Space" +
      "&nbsp" +
      "<i class='material-icons'>space_bar</i>" +
      ` (${this.properties.timeRemaining}s)`;
  },
};

//keyboard.init when the page loads
$(document).ready(function () {
  if (!displayKeyboard) return;

  Keyboard.init();

  //close keyboard when clicked outside of it (except the input)
  var keyboard = document.querySelector(".keyboard");
  var search_all = document.querySelector("#search_all");
  var search_karaoke = document.querySelector("#search_karaoke");
  var search_query = document.querySelector("#search_query");
  var clear_queue_input_div = document.querySelector("#dialog-confirm");

  document.addEventListener("click", function (e) {
    //if the clicked element is not the keyboard or the search bar, close the keyboard
    if (
      !keyboard.classList.contains("keyboard--hidden") &&
      !keyboard.contains(e.target) &&
      !search_all.contains(e.target) &&
      !search_karaoke.contains(e.target) &&
      !search_query.contains(e.target) &&
      !clear_queue_input_div.contains(e.target)
    ) {
      Keyboard.close();
    }
  });
});
