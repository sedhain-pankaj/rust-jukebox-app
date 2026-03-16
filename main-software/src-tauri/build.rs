// =============================================================================
// build.rs — The Build Script
// =============================================================================
// This file runs BEFORE your main code compiles. Rust calls it automatically
// whenever it sees a build.rs in the project root (next to Cargo.toml).
//
// For Tauri, this build script is required. It does things like:
//   - Generate the Windows .exe icon
//   - Set up the manifest for WebView2
//   - Prepare resources that get embedded into the final binary
//
// You typically don't need to modify this file.
// Think of it like a "pre-build hook" in other build systems.
// =============================================================================

fn main() {
    // tauri_build::build() does all the heavy lifting.
    // If something goes wrong during the build, this is usually where
    // the error originates. The most common issue is missing WebView2
    // on the target Windows machine (Windows 10 1803+ has it built-in).
    tauri_build::build();
}
