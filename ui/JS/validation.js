window.__jukeboxStartup = {
  validationPromise: null,
  validationResult: null,
  blocked: false,
};

function escapeStartupHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStartupValidationError(result) {
  var errors = Array.isArray(result && result.errors) ? result.errors : [];
  var warnings = Array.isArray(result && result.warnings)
    ? result.warnings
    : [];
  var expected = Array.isArray(result && result.expected_folders)
    ? result.expected_folders
    : [];

  var errorsHtml = errors.length
    ? "<ul style='margin-top:8px;'>" +
      errors
        .map(function (msg) {
          return (
            "<li style='margin: 6px 0; line-height: 1.4;'>" +
            escapeStartupHtml(msg) +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    : "<p>No detailed error messages were returned.</p>";

  var warningsHtml = warnings.length
    ? "<h3 style='margin-top: 24px;'>Warnings</h3><ul>" +
      warnings
        .map(function (msg) {
          return (
            "<li style='margin: 6px 0; line-height: 1.4;'>" +
            escapeStartupHtml(msg) +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    : "";

  var expectedHtml = expected.length
    ? "<p style='margin-top: 14px;'><b>Expected folders:</b> " +
      expected.map(escapeStartupHtml).join(", ") +
      "</p>"
    : "";

  var basePath =
    result && result.base_path
      ? escapeStartupHtml(result.base_path)
      : "(unknown)";
  var musicPath =
    result && result.music_path
      ? escapeStartupHtml(result.music_path)
      : "(unknown)";

  document.title = "Jukebox Setup Error";
  document.body.innerHTML =
    "<div style='min-height:100vh;background:#121212;color:#f3f3f3;padding:30px;font-family:Segoe UI, Arial, sans-serif;'>" +
    "<div style='max-width:1100px;margin:0 auto;background:#1e1e1e;border:1px solid #b03b3b;border-radius:10px;padding:24px;'>" +
    "<h1 style='margin:0 0 12px;color:#ff6b6b;'>Music Folder Validation Failed</h1>" +
    "<p style='margin:0 0 8px;'>The app did not start because the required folder structure is invalid.</p>" +
    "<p style='margin:0 0 4px;'><b>Base path:</b> " +
    basePath +
    "</p>" +
    "<p style='margin:0 0 12px;'><b>Music path checked:</b> " +
    musicPath +
    "</p>" +
    "<h3 style='margin:14px 0 8px;'>Issues Found</h3>" +
    errorsHtml +
    expectedHtml +
    warningsHtml +
    "<p style='margin-top: 20px;'>Fix the folder issues above, then restart the app.</p>" +
    "</div></div>";
}

window.ensureMusicStructure = function () {
  if (window.__jukeboxStartup.validationPromise) {
    return window.__jukeboxStartup.validationPromise;
  }

  var tauriCore = window.__TAURI__ && window.__TAURI__.core;
  if (!tauriCore || typeof tauriCore.invoke !== "function") {
    var unavailableResult = {
      valid: false,
      errors: ["Tauri invoke API is not available."],
      warnings: [],
      expected_folders: [],
      base_path: "",
      music_path: "",
    };
    window.__jukeboxStartup.validationResult = unavailableResult;
    window.__jukeboxStartup.blocked = true;
    renderStartupValidationError(unavailableResult);
    return Promise.resolve(unavailableResult);
  }

  window.__jukeboxStartup.validationPromise = tauriCore
    .invoke("validate_music_structure")
    .then(function (result) {
      window.__jukeboxStartup.validationResult = result;
      if (!result.valid) {
        window.__jukeboxStartup.blocked = true;
        renderStartupValidationError(result);
      }
      return result;
    })
    .catch(function (error) {
      var failedResult = {
        valid: false,
        errors: ["Validation call failed: " + error],
        warnings: [],
        expected_folders: [],
        base_path: "",
        music_path: "",
      };
      window.__jukeboxStartup.validationResult = failedResult;
      window.__jukeboxStartup.blocked = true;
      renderStartupValidationError(failedResult);
      return failedResult;
    });

  return window.__jukeboxStartup.validationPromise;
};
