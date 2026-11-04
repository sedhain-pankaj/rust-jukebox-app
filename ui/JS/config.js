// ---------------------------------------------------------------------------
// SECRETS — loaded from the app's .env file via IPC
// ---------------------------------------------------------------------------
// .env lives next to the music/ directory (see get_app_env in main.rs) and
// is gitignored. These globals are filled in shortly after page load; the
// consumers (load_youtube in youtube.js, delete.js) read them at call time,
// well after the IPC round-trip completes.
var YT_API_Key = "";
var queue_clear_password = "";
var _appEnv = null;

function getAppEnv() {
  if (!_appEnv) {
    _appEnv = window.__TAURI__.core
      .invoke("get_app_env")
      .then(function (env) {
        YT_API_Key = env.YT_API_KEY || "";
        queue_clear_password = env.QUEUE_CLEAR_PASSWORD || "";
        return env;
      })
      .catch(function (e) {
        console.error("could not load .env:", e);
        return {};
      });
  }
  return _appEnv;
}

// Kick off the load immediately (config.js is the first script).
getAppEnv();

// ---------------------------------------------------------------------------
// MEDIA SERVER URL HELPER
// ---------------------------------------------------------------------------
// On Linux, the webview's <video> element (GStreamer) can't load Tauri's
// asset:// URLs, so media is served by Rust's media_server.rs over plain
// HTTP. Rust picks a free candidate port (media_server::MEDIA_PORTS, random
// starting offset — the CSP has to enumerate every candidate since the CSP
// spec has no wildcard ports). mediaUrl() maps an absolute file path to
// that server's URL. (Thumbnails still use convertFileSrc — <img> works
// with asset URLs.)
//
// The chosen port arrives over IPC. Callers MUST await mediaBaseReady()
// before building URLs (see the Promise.all gates in songs.js / index.js).
var MEDIA_SERVER_BASE = null;
var _mediaBaseReady = null;

function mediaBaseReady() {
  if (!_mediaBaseReady) {
    _mediaBaseReady = window.__TAURI__.core
      .invoke("get_media_server_port")
      .then(function (port) {
        if (port) {
          MEDIA_SERVER_BASE = "http://127.0.0.1:" + port;
        } else {
          // 0 = the server failed to start (all candidate ports busy).
          console.error(
            "media server not running (all candidate ports busy) — video playback will fail",
          );
        }
      });
  }
  return _mediaBaseReady;
}

function mediaUrl(absolutePath) {
  return MEDIA_SERVER_BASE + encodeURI(absolutePath);
}
