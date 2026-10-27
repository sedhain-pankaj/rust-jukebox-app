// =============================================================================
// tauri.conf.json — REFERENCE GUIDE
// =============================================================================
// JSON doesn't support comments, so this file explains each setting in
// tauri.conf.json. Keep this file next to it for reference.
//
// SETTING                  | WHAT IT DOES
// -------------------------|------------------------------------------------
// productName              | The name shown in the title bar and taskbar.
//                          | Also becomes the .exe name when bundled.
//
// version                  | Must match the version in Cargo.toml.
//                          | Used for Windows installer versioning.
//
// identifier               | A unique reverse-domain ID for your app.
//                          | Required by Windows/macOS to distinguish apps.
//
// build.frontendDist       | Where your HTML/CSS/JS files live.
//                          | Tauri embeds all files from this folder into
//                          | the binary at compile time. Path is relative
//                          | to src-tauri/ folder.
//
// app.windows[0].label     | Internal ID for the window. "main" = primary.
//
// app.windows[0].fullscreen| true = covers entire screen, like kiosk mode.
//                          | No title bar, no taskbar visible.
//
// app.windows[0].resizable | false = user can't resize by dragging edges.
//
// app.windows[0].width/    | Initial dimensions (pixels). Only matter when
// height                   | fullscreen is false. Fallback values.
//
// app.windows[0].decorations| false = remove the title bar with min/max/close
//                          | buttons. You'll need your own close mechanism.
//
// app.windows[0].alwaysOnTop| true = window stays above all others.
//                          | Good for kiosk, bad for development.
//
// app.windows[0].url       | Which HTML file to load from frontendDist.
//                          | Like setting DocumentRoot in Apache.
//
// app.security.csp         | Content Security Policy. null = disabled.
//                          | In production, restrict what can load.
//
// bundle.active            | Whether to create distributable packages.
//
// bundle.targets           | "all" = create all package types (exe, msi, etc.)
//
// bundle.icon              | Paths to icon files for the app.
// =============================================================================
