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
      if (typeof window.selectTextDisabled === "function") {
        window.selectTextDisabled("#admin-root");
      }
    }
  }

  function getMusicPath(driveInfo) {
    return (driveInfo && (driveInfo.musicPath || driveInfo.music_path)) || "";
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

    $(document).on("click", "#admin-exit", function () {
      window.__adminMode.active = false;
      document.getElementById("admin-root").classList.add("hidden");
      document.getElementById("app-root").classList.remove("hidden");
      if (typeof window.selectTextDisabled === "function") {
        window.selectTextDisabled();
      }
      if (typeof window.ensureMusicStructure === "function") {
        window.ensureMusicStructure().then(function (validation) {
          if (!validation.valid) {
            return;
          }
          if (typeof window.loadCategoriesOnce === "function") {
            window.loadCategoriesOnce();
          }
          if (typeof window.video_scaler === "function") {
            window.video_scaler();
          }
          if (typeof window.searchCondition === "function") {
            window.searchCondition();
          }
          if (typeof window.autoShuffle === "function") {
            window.autoShuffle();
          }
          if (typeof window.skipVideo === "function") {
            window.skipVideo();
          }
          if (typeof window.queue_scroll_top === "function") {
            window.queue_scroll_top();
          }
          if (typeof window.volume_slider === "function") {
            window.volume_slider();
          }
          if (typeof window.volume_changer === "function") {
            window.volume_changer();
          }
        });
      }
    });

    $(document).on("click", "#admin-manual-confirm", function () {
      var selections = collectManualSelections();
      confirmCopy(
        selections,
        selections.length + " songs selected. CONFIRM transfer?",
      );
    });

    $(document).on("click", "#admin-manual-cancel", function () {
      document.getElementById("admin-page-manual").classList.add("hidden");
      document.getElementById("admin-page-chooser").classList.remove("hidden");
      resetAutoTimerIfNeeded();
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
