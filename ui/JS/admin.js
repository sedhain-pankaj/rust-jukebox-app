(function () {
  var tauriCore = window.__TAURI__ && window.__TAURI__.core;
  var invoke = tauriCore && tauriCore.invoke;

  window.__adminMode = window.__adminMode || {
    active: false,
    readyPromise: null,
    drive: null,
    scan: null,
  };

  window.__adminModeReady = function () {
    return window.__adminMode.readyPromise || Promise.resolve({ active: false });
  };

  function setAdminActive(active) {
    window.__adminMode.active = active;
    if (active) {
      document.getElementById("admin-root").classList.remove("hidden");
      document.getElementById("app-root").classList.add("hidden");
    }
  }

  function getMusicPath(driveInfo) {
    return (driveInfo && (driveInfo.musicPath || driveInfo.music_path)) || "";
  }

  function renderSummary(scan) {
    var list = document.getElementById("admin-summary-list");
    list.innerHTML = "";

    scan.per_folder_counts.forEach(function (item) {
      var line = document.createElement("div");
      line.className = "admin-summary-line";
      line.textContent = item.folder + ": " + item.new_with_thumbs + " new songs";
      list.appendChild(line);

      if (item.new_missing_thumbs > 0) {
        var warn = document.createElement("div");
        warn.className = "admin-summary-line missing";
        warn.textContent =
          item.folder +
          ": " +
          item.new_missing_thumbs +
          " new songs ignored (No thumbnails)";
        list.appendChild(warn);
      }
    });
  }

  function renderErrors(errors) {
    var list = document.getElementById("admin-summary-list");
    list.innerHTML = "";
    errors.forEach(function (msg) {
      var line = document.createElement("div");
      line.className = "admin-summary-line missing";
      line.textContent = msg;
      list.appendChild(line);
    });
  }

  function buildManualList(scan) {
    var container = document.getElementById("admin-manual-list");
    container.innerHTML = "";

    scan.songs_by_folder.forEach(function (folder) {
      var section = document.createElement("div");
      section.className = "admin-folder-section";

      var title = document.createElement("div");
      title.className = "admin-folder-title";
      title.textContent = folder.folder;
      section.appendChild(title);

      folder.songs.forEach(function (song) {
        var row = document.createElement("label");
        row.className = "admin-song-row";

        if (!song.is_selectable) {
          row.classList.add("disabled");
        }

        if (!song.has_thumbnail) {
          var warning = document.createElement("span");
          warning.className = "admin-warning";
          warning.textContent = "!";
          row.appendChild(warning);
        }

        if (song.is_selectable) {
          var checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "admin-select";
          checkbox.setAttribute("data-folder", song.folder);
          checkbox.setAttribute("data-filename", song.filename);
          checkbox.setAttribute("data-thumb", song.thumbnail_rel);
          row.appendChild(checkbox);
        }

        var text = document.createElement("span");
        text.textContent = song.name;
        row.appendChild(text);

        section.appendChild(row);
      });

      container.appendChild(section);
    });
  }

  function collectSelectableSongs(scan) {
    var selections = [];
    scan.songs_by_folder.forEach(function (folder) {
      folder.songs.forEach(function (song) {
        if (song.is_selectable) {
          selections.push({
            folder: song.folder,
            filename: song.filename,
            thumbnail_filename: song.thumbnail_rel.split("/").pop(),
          });
        }
      });
    });
    return selections;
  }

  function collectManualSelections() {
    var selections = [];
    document.querySelectorAll(".admin-select:checked").forEach(function (box) {
      selections.push({
        folder: box.getAttribute("data-folder"),
        filename: box.getAttribute("data-filename"),
        thumbnail_filename: box.getAttribute("data-thumb").split("/").pop(),
      });
    });
    return selections;
  }

  function showResultModal(result) {
    var message =
      "Copied " +
      result.copied +
      " songs. Skipped " +
      result.skipped +
      ".";

    if (result.errors && result.errors.length) {
      message += "<br><br><b>Errors:</b><br>" + result.errors.join("<br>");
    }

    jquery_modal({
      message: message,
      title: "Transfer Complete",
      closeTime: 20000,
      buttonText: "Continue",
    });
  }

  function executeCopy(selections) {
    if (!selections.length) {
      jquery_modal({
        message: "No songs selected for transfer.",
        title: "Nothing to Copy",
      });
      return;
    }

    $("#admin-confirm").prop("disabled", true);
    $("#admin-manual-confirm").prop("disabled", true);

    var musicPath = getMusicPath(window.__adminMode.drive);
    invoke("copy_admin_songs", {
      musicPath: musicPath,
      music_path: musicPath,
      selections: selections,
    })
      .then(function (result) {
        showResultModal(result);
      })
      .catch(function (err) {
        jquery_modal({
          message: "Copy failed: " + err,
          title: "Copy Error",
        });
      })
      .finally(function () {
        $("#admin-confirm").prop("disabled", false);
        $("#admin-manual-confirm").prop("disabled", false);
      });
  }

  function confirmCopy(selections, title) {
    jquery_modal({
      message: title,
      title: "CONFIRM transfer?",
      dialogClass: "show-closer",
      closeTime: 30000,
      buttonText: "CONFIRM transfer",
      buttonAction: function () {
        executeCopy(selections);
      },
    });
  }

  var autoCountdown = 10;
  var autoTimer = null;

  function updateCountdown() {
    document.getElementById("admin-auto-countdown").textContent = autoCountdown;
  }

  function clearAutoTimer() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function startAutoTimer() {
    clearAutoTimer();
    autoCountdown = 10;
    updateCountdown();
    autoTimer = setInterval(function () {
      autoCountdown -= 1;
      updateCountdown();
      if (autoCountdown <= 0) {
        clearAutoTimer();
        runAutoCopy(true);
      }
    }, 1000);
  }

  function resetAutoTimerIfNeeded() {
    var chooserVisible = !document
      .getElementById("admin-page-chooser")
      .classList.contains("hidden");
    var autoSelected =
      document.querySelector("input[name='admin-mode']:checked").value ===
      "auto";
    if (chooserVisible && autoSelected) {
      startAutoTimer();
    }
  }

  function runAutoCopy(skipConfirm) {
    var selections = collectSelectableSongs(window.__adminMode.scan);
    if (skipConfirm) {
      executeCopy(selections);
    } else {
      confirmCopy(
        selections,
        selections.length + " songs will be transferred in AUTO mode.",
      );
    }
  }

  function showManualPage() {
    document.getElementById("admin-page-chooser").classList.add("hidden");
    document.getElementById("admin-page-manual").classList.remove("hidden");
  }

  function bindAdminHandlers() {
    $(document).on(
      "click",
      "input[name='admin-mode']",
      function () {
        if (this.value === "auto") {
          startAutoTimer();
        } else {
          clearAutoTimer();
        }
      },
    );

    $(document).on("click", "#admin-confirm", function () {
      var selectedMode = document.querySelector(
        "input[name='admin-mode']:checked",
      ).value;
      if (selectedMode === "auto") {
        runAutoCopy(false);
      } else {
        clearAutoTimer();
        showManualPage();
      }
    });

    $(document).on("click", "#admin-manual-confirm", function () {
      var selections = collectManualSelections();
      confirmCopy(
        selections,
        selections.length + " songs selected. CONFIRM transfer?",
      );
    });

    $(document).on("click", "#admin-scroll-up", function () {
      var list = $("#admin-manual-list");
      list.stop(true, true).animate(
        { scrollTop: list.scrollTop() - 400 },
        400,
      );
    });

    $(document).on("click", "#admin-scroll-down", function () {
      var list = $("#admin-manual-list");
      list.stop(true, true).animate(
        { scrollTop: list.scrollTop() + 400 },
        400,
      );
    });

    ["mousedown", "click", "touchstart", "keydown"].forEach(function (evt) {
      document.addEventListener(evt, function () {
        resetAutoTimerIfNeeded();
      });
    });
  }

  function initAdmin(driveInfo) {
    if (!invoke) {
      return Promise.resolve({ active: false });
    }

    var musicPath = getMusicPath(driveInfo);
    return invoke("scan_admin_usb", { musicPath: musicPath, music_path: musicPath })
      .then(function (scan) {
        window.__adminMode.scan = scan;
        if (!scan.valid_structure) {
          renderErrors(scan.errors || ["USB music structure is invalid."]);
          $("#admin-confirm").prop("disabled", true);
          $("#admin-manual-confirm").prop("disabled", true);
          return { active: true };
        }

        renderSummary(scan);
        buildManualList(scan);
        bindAdminHandlers();
        startAutoTimer();
        return { active: true };
      })
      .catch(function (err) {
        renderErrors(["USB scan failed: " + err]);
        return { active: true };
      });
  }

  function startDetection() {
    if (!invoke) {
      return Promise.resolve({ active: false });
    }

    return invoke("detect_admin_drive")
      .then(function (result) {
        if (result && result.found) {
          window.__adminMode.drive = result;
          setAdminActive(true);
          return initAdmin(result);
        }
        return { active: false };
      })
      .catch(function () {
        return { active: false };
      });
  }

  window.__adminMode.readyPromise = startDetection();
})();
