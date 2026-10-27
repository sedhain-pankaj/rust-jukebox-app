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

  var handlersBound = false;

  function setAdminActive(active) {
    window.__adminMode.active = active;
    if (active) {
      document.getElementById("admin-root").classList.remove("hidden");
      document.getElementById("app-root").classList.add("hidden");
      if (typeof window.selectTextDisabled === "function") {
        window.selectTextDisabled("#admin-root");
      }
    }
  }

  function getMusicPath(driveInfo) {
    return (driveInfo && (driveInfo.musicPath || driveInfo.music_path)) || "";
  }

  function setTimerCancelledVisual(cancelled) {
    var el = document.getElementById("admin-auto-countdown");
    if (!el) {
      return;
    }
    if (cancelled) {
      el.classList.add("admin-timer-cancelled");
    } else {
      el.classList.remove("admin-timer-cancelled");
    }
  }

  function normalizeSongFlags(song) {
    var isNew = song.is_new !== undefined ? song.is_new : song.isNew;
    var hasThumbnail =
      song.has_thumbnail !== undefined ? song.has_thumbnail : song.hasThumbnail;
    var isSelectable =
      song.is_selectable !== undefined
        ? song.is_selectable
        : song.isSelectable;

    if (isSelectable === undefined || isSelectable === null) {
      isSelectable = !!(isNew && hasThumbnail);
    } else if (!isSelectable && isNew && hasThumbnail) {
      isSelectable = true;
    }

    return {
      isNew: !!isNew,
      hasThumbnail: !!hasThumbnail,
      isSelectable: !!isSelectable,
    };
  }

  function renderSummary(scan) {
    var list = document.getElementById("admin-summary-list");
    list.innerHTML = "";

    var counts = scan.per_folder_counts || scan.perFolderCounts || [];
    counts.forEach(function (item) {
      var folderName = item.folder || item.folderName || "";
      var newWithThumbs = item.new_with_thumbs || item.newWithThumbs || 0;
      var newMissingThumbs =
        item.new_missing_thumbs || item.newMissingThumbs || 0;
      var line = document.createElement("div");
      line.className = "admin-summary-line";
      line.textContent = folderName + ": " + newWithThumbs + " new songs";
      list.appendChild(line);

      if (newMissingThumbs > 0) {
        var warn = document.createElement("div");
        warn.className = "admin-summary-line missing";
        warn.textContent =
          folderName +
          ": " +
          newMissingThumbs +
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

    var folders = scan.songs_by_folder || scan.songsByFolder || [];
    folders.forEach(function (folder) {
      var folderName = folder.folder || folder.folderName || "";
      var section = document.createElement("div");
      section.className = "admin-folder-section";

      var title = document.createElement("div");
      title.className = "admin-folder-title";
      title.textContent = folderName;
      section.appendChild(title);

      var songs = folder.songs || [];
      songs.forEach(function (song) {
        var flags = normalizeSongFlags(song);
        var row = document.createElement("label");
        row.className = "admin-song-row";

        var isSelectable = flags.isSelectable;
        var hasThumbnail = flags.hasThumbnail;
        var thumbnailRel =
          song.thumbnail_rel !== undefined
            ? song.thumbnail_rel
            : song.thumbnailRel;
        var songName = song.name || song.title || "";
        var isNew = flags.isNew;

        if (!isSelectable) {
          row.classList.add("disabled");
        }

        if (!hasThumbnail) {
          var warning = document.createElement("span");
          warning.className = "admin-warning-triangle";
          var warningMark = document.createElement("span");
          warningMark.className = "admin-warning-mark";
          warningMark.textContent = "!";
          warning.appendChild(warningMark);
          row.appendChild(warning);
        }

        if (isSelectable) {
          var checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "admin-select";
          checkbox.setAttribute("data-folder", folderName);
          checkbox.setAttribute("data-filename", song.filename || "");
          checkbox.setAttribute("data-thumb", thumbnailRel || "");
          row.appendChild(checkbox);
        } else if (!isNew) {
          var disabledBox = document.createElement("span");
          disabledBox.className = "admin-checkbox-disabled";
          disabledBox.textContent = "X";
          row.appendChild(disabledBox);
        }

        if (!isSelectable && !isNew) {
          row.setAttribute("title", "Already exists in local jukebox.");
        } else if (!hasThumbnail) {
          row.setAttribute("title", "New song but no thumbnail - IGNORED!");
        } else if (isSelectable) {
          row.setAttribute("title", "New song - Mark the checkbox to transfer.");
        }

        var text = document.createElement("span");
        text.textContent = songName;
        row.appendChild(text);

        section.appendChild(row);
      });

      container.appendChild(section);
    });
  }

  function collectSelectableSongs(scan) {
    var selections = [];
    var folders = scan.songs_by_folder || scan.songsByFolder || [];
    folders.forEach(function (folder) {
      var folderName = folder.folder || folder.folderName || "";
      var songs = folder.songs || [];
      songs.forEach(function (song) {
        var isSelectable = normalizeSongFlags(song).isSelectable;
        var thumbnailRel =
          song.thumbnail_rel !== undefined
            ? song.thumbnail_rel
            : song.thumbnailRel;
        if (isSelectable) {
          selections.push({
            folder: folderName,
            filename: song.filename || "",
            thumbnail_filename: (thumbnailRel || "").split("/").pop(),
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
    var selections = window.__adminMode.lastCopySelections || [];
    var summaryHtml = formatSelectionsSummaryHtml(selections);
    var usbPath = getMusicPath(window.__adminMode.drive) || "";

    var message =
      "<b>USB:</b> " +
      usbPath +
      "<br><b>Selected:</b> " +
      selections.length +
      "<br>" +
      summaryHtml +
      "<br><br>" +
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
      closeTime: 600000,
      buttonText: "Done (Restart Jukebox)",
      buttonAction: function () {
        restartApp();
      },
    });
  }

  function formatSelectionsSummaryHtml(selections) {
    if (!selections || !selections.length) {
      return "";
    }
    var counts = {};
    selections.forEach(function (sel) {
      var folder = sel.folder || "";
      counts[folder] = (counts[folder] || 0) + 1;
    });
    var folders = Object.keys(counts).sort(function (a, b) {
      return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    return folders
      .map(function (folder) {
        return "<b>" + folder + ":</b> " + counts[folder];
      })
      .join("<br>");
  }

  function showProgressModal(selections) {
    var musicPath = getMusicPath(window.__adminMode.drive) || "";
    var summaryHtml = formatSelectionsSummaryHtml(selections);
    var message =
      "Copying " +
      selections.length +
      " songs...<br><br><b>USB:</b> " +
      musicPath +
      "<br><br>" +
      summaryHtml +
      "<br><b>Destination:</b> Local jukebox music folder";

    jquery_modal({
      message: message,
      title: "Transferring",
      dialogClass: "no-closer",
      closeTime: 3600000,
      buttonText: "Working...",
      closeOnClick: false,
      buttonColor: "#666666",
    });
  }

  function closeAnyModal() {
    try {
      if ($("#dialog-confirm").hasClass("ui-dialog-content")) {
        $("#dialog-confirm").dialog("close");
      }
    } catch (_) {}
  }

  function restartApp() {
    // Hard reset back to startup state (closest equivalent to Ctrl+Shift+R).
    stopAutoTimerNow("system");
    copyRunId += 1; // invalidate any late copy callbacks
    window.__adminMode.active = false;
    closeAnyModal();
    try {
      window.location.reload();
    } catch (_) {
      // Fallback for odd WebView cases.
      window.location.href = window.location.href;
    }
  }

  var copyInProgress = false;
  var copyRunId = 0;

  function executeCopy(selections) {
    if (!selections.length) {
      jquery_modal({
        message: "No songs selected for transfer.",
        title: "Nothing to Copy",
      });
      return;
    }

    stopAutoTimerNow("system");
    $("#admin-confirm").prop("disabled", true);
    $("#admin-manual-confirm").prop("disabled", true);
    $("#admin-exit").prop("disabled", true);
    $("#admin-manual-cancel").prop("disabled", true);

    copyInProgress = true;
    copyRunId += 1;
    var thisRun = copyRunId;
    window.__adminMode.lastCopySelections = selections.slice();

    showProgressModal(selections);

    var musicPath = getMusicPath(window.__adminMode.drive);
    invoke("copy_admin_songs", {
      musicPath: musicPath,
      music_path: musicPath,
      selections: selections,
    })
      .then(function (result) {
        if (!window.__adminMode.active || thisRun !== copyRunId) {
          return;
        }
        closeAnyModal();
        showResultModal(result);
      })
      .catch(function (err) {
        if (!window.__adminMode.active || thisRun !== copyRunId) {
          return;
        }
        closeAnyModal();
        jquery_modal({
          message: "Copy failed: " + err,
          title: "Copy Error",
        });
      })
      .finally(function () {
        if (thisRun !== copyRunId) {
          return;
        }
        copyInProgress = false;
        $("#admin-confirm").prop("disabled", false);
        $("#admin-manual-confirm").prop("disabled", false);
        $("#admin-exit").prop("disabled", false);
        $("#admin-manual-cancel").prop("disabled", false);
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
  var autoStoppedByInput = false;

  function isChooserVisible() {
    return !document
      .getElementById("admin-page-chooser")
      .classList.contains("hidden");
  }

  function updateCountdown() {
    document.getElementById("admin-auto-countdown").textContent = autoCountdown;
  }

  function clearAutoTimer() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function stopAutoTimerNow(reason) {
    if (reason === "input") {
      setTimerCancelledVisual(true);
    }
    autoStoppedByInput = true;
    clearAutoTimer();
  }

  function startAutoTimer() {
    clearAutoTimer();
    autoCountdown = 10;
    updateCountdown();
    setTimerCancelledVisual(false);
    autoStoppedByInput = false;
    autoTimer = setInterval(function () {
      autoCountdown -= 1;
      updateCountdown();
      if (autoCountdown <= 0) {
        clearAutoTimer();
        runAutoCopy(true);
      }
    }, 1000);
  }

  function runAutoCopy(skipConfirm) {
    var selections = collectSelectableSongs(window.__adminMode.scan);
    if (skipConfirm) {
      executeCopy(selections);
    } else {
      var summaryHtml = formatSelectionsSummaryHtml(selections);
      confirmCopy(
        selections,
        "<b>AUTO mode</b><br>" +
          selections.length +
          " songs will be transferred.<br><br>" +
          summaryHtml,
      );
    }
  }

  function showManualPage() {
    document.getElementById("admin-page-chooser").classList.add("hidden");
    document.getElementById("admin-page-manual").classList.remove("hidden");
  }

  function bindAdminHandlers() {
    if (handlersBound) {
      return;
    }
    handlersBound = true;

    $(document).on(
      "click",
      "input[name='admin-mode']",
      function () {
        // Any interaction on the chooser page cancels the auto timer.
        if (window.__adminMode.active && isChooserVisible() && autoTimer) {
          stopAutoTimerNow("input");
        }
      },
    );

    $(document).on("click", "#admin-confirm", function () {
      stopAutoTimerNow("input");
      var checked = document.querySelector("input[name='admin-mode']:checked");
      if (!checked) {
        jquery_modal({
          message: "Please select AUTO or MANUAL mode.",
          title: "Select Mode",
        });
        return;
      }
      var selectedMode = checked.value;
      if (selectedMode === "auto") {
        runAutoCopy(false);
      } else {
        showManualPage();
      }
    });

    $(document).on("click", "#admin-exit", function () {
      stopAutoTimerNow("input");
      if (copyInProgress) {
        jquery_modal({
          message: "Transfer is running. Please wait until it finishes.",
          title: "Please Wait",
        });
        return;
      }
      // Invalidate any late callbacks and go back to jukebox.
      copyRunId += 1;
      restartApp();
    });

    $(document).on("click", "#admin-manual-confirm", function () {
      var selections = collectManualSelections();
      var summaryHtml = formatSelectionsSummaryHtml(selections);
      confirmCopy(
        selections,
        "<b>MANUAL mode</b><br>" +
          selections.length +
          " songs selected.<br><br>" +
          summaryHtml,
      );
    });

    $(document).on("click", "#admin-manual-cancel", function () {
      document.getElementById("admin-page-manual").classList.add("hidden");
      document.getElementById("admin-page-chooser").classList.remove("hidden");
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
        // Any input while on the chooser page cancels AUTO permanently.
        if (
          window.__adminMode.active &&
          isChooserVisible() &&
          autoTimer &&
          !autoStoppedByInput
        ) {
          stopAutoTimerNow("input");
        }
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

    // Bind handlers early so Confirm always responds, even during scan or with 0 new songs.
    bindAdminHandlers();

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
