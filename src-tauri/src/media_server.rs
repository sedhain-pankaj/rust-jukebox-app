// =============================================================================
// media_server.rs — Local HTTP Media Server
// =============================================================================
//
// WHY THIS EXISTS:
// On Linux, the webview's <video> element is backed by GStreamer, which
// cannot fetch Tauri's `asset://` custom-protocol URLs — playback fails with
// "can't handle the path". (On Windows, WebView2 routes everything to the
// custom handler, so asset URLs work there.)
//
// Fix: serve the music directory over plain HTTP on 127.0.0.1:1420.
// The frontend builds URLs as:
//     http://127.0.0.1:1420 + encodeURI(absolute_file_path)
// This server percent-decodes the path and serves the file, supporting
// HTTP Range requests (what <video> seeking needs).
//
// Only files under the allowed music root are served — the same junction +
// canonical double check used for the asset protocol scope in main.rs.
// =============================================================================

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

// Terminal logging with blank-line separators (see term_log in main.rs).
use crate::term_log;

// Guards start() against being invoked twice in one process.
static START_INVOKED: AtomicBool = AtomicBool::new(false);

/// Candidate ports the server tries. A random offset decides the starting
/// candidate so different machines don't all pile onto 1420. EVERY entry
/// must be listed in the CSP media-src in tauri.conf.json (the CSP spec
/// has no wildcard ports, so the full candidate set must be enumerated).
pub const MEDIA_PORTS: [u16; 8] = [1420, 1421, 1422, 1423, 1424, 1425, 1426, 1427];

/// Start the media server in a background thread on the first free
/// candidate port. `music_dir` is the (possibly junction) music directory;
/// its canonical form is also added as an allowed root. Returns the
/// bound port (the frontend fetches it via the get_media_server_port
/// IPC command — see mediaBaseReady() in ui/JS/config.js).
///
/// Per-candidate port-in-use handling:
///   1. Probe the port: if a Jukebox media server from a previous
///      instance is still up, reuse it (it serves the same music
///      directory, so playback still works).
///   2. Retry the bind once after 500ms — when the app restarts right
///      after exiting (e.g. `cargo tauri dev`), the OS may still be
///      releasing the previous instance's socket.
///   3. If the port is still busy (some other program), try the next
///      candidate. If ALL candidates fail, return Err — main.rs logs it
///      and the app keeps running; playback errors surface in the
///      terminal via the mejs log bridge.
pub fn start(music_dir: &Path, ports: &[u16]) -> std::io::Result<u16> {
    // Re-entrancy guard: start() must run once per process. If it is ever
    // invoked twice, the normal flow below will detect the first instance
    // via the health probe and reuse it — a double bind is impossible.
    if START_INVOKED
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        term_log(&format!(
            "[pid {}] media server start() invoked again in the same process — reusing the running instance",
            std::process::id()
        ));
    }

    // Random starting offset (time-based; DefaultHasher would be constant).
    let offset = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as usize)
        % ports.len();
    let order: Vec<u16> = (0..ports.len())
        .map(|i| ports[(i + offset) % ports.len()])
        .collect();

    let mut last_err: Option<std::io::Error> = None;
    for &port in &order {
        if is_media_server_running(port) {
            term_log(&format!(
                "[pid {}] Media server already running on 127.0.0.1:{} — reusing it",
                std::process::id(),
                port
            ));
            return Ok(port);
        }
        for _ in 0..2 {
            match TcpListener::bind(("127.0.0.1", port)) {
                Ok(listener) => {
                    // Allowed roots: the music dir itself (junction path)
                    // and its canonical form (the real location the
                    // junction points to). canonicalize() both so
                    // starts_with() compares like-for-like.
                    let mut roots = vec![music_dir.to_path_buf()];
                    if let Ok(canon) = std::fs::canonicalize(music_dir) {
                        roots.push(canon);
                    }
                    let roots: Vec<PathBuf> = roots
                        .iter()
                        .map(|r| std::fs::canonicalize(r).unwrap_or_else(|_| r.clone()))
                        .collect();

                    // Return the ACTUALLY bound port (matters when a
                    // candidate is 0 = "let the OS pick"; for real
                    // candidates it always equals the candidate).
                    // The pid in the log line distinguishes this process
                    // from any other instance writing to the same terminal.
                    let bound_port = listener.local_addr().unwrap().port();
                    term_log(&format!(
                        "[pid {}] Media server listening on http://127.0.0.1:{}",
                        std::process::id(),
                        bound_port
                    ));
                    let server_roots = roots.clone();
                    thread::spawn(move || serve_forever(listener, server_roots));
                    return Ok(bound_port);
                }
                Err(e) => {
                    last_err = Some(e);
                    thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }
    term_log(&format!(
        "Media server: all candidate ports ({:?}) are busy — video playback \
will not work until one is freed",
        order
    ));
    Err(last_err.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrInUse, "no media server port available")
    }))
}

/// Probe a port to see if a Jukebox media server is already listening there
/// (e.g. a previous app instance that hasn't fully shut down).
fn is_media_server_running(port: u16) -> bool {
    let mut stream = match TcpStream::connect(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.write_all(
        b"GET /__jukebox_health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
    );
    let mut buf = [0u8; 256];
    match stream.read(&mut buf) {
        Ok(n) => String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.1 200"),
        Err(_) => false,
    }
}

/// Accept loop — one thread per connection (a kiosk plays one song at a
/// time, so concurrency is never an issue).
fn serve_forever(listener: TcpListener, roots: Vec<PathBuf>) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                let conn_roots = roots.clone();
                thread::spawn(move || {
                    let _ = handle_request(stream, &conn_roots);
                });
            }
            Err(e) => term_log(&format!("media server accept error: {}", e)),
        }
    }
}

/// Handle one HTTP connection: parse the request head, resolve the file,
/// and respond with 200 / 206 (range) / 403 / 404 / 416.
fn handle_request(mut stream: TcpStream, roots: &[PathBuf]) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));

    // Read the request head (everything up to the blank line).
    let mut head = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => return Ok(()),
            Ok(n) => {
                head.extend_from_slice(&chunk[..n]);
                if head.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if head.len() > 65536 {
                    return Ok(());
                }
            }
            Err(_) => return Ok(()),
        }
    }

    let head_str = String::from_utf8_lossy(&head);
    let lines: Vec<&str> = head_str.split("\r\n").collect();
    let request_line = lines.first().unwrap_or(&"");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let url_path = parts.next().unwrap_or("/");

    let range_header = lines.iter().find_map(|l| {
        let lower = l.to_ascii_lowercase();
        lower.strip_prefix("range:").map(|rest| rest.trim().to_string())
    });

    if method != "GET" && method != "HEAD" {
        return respond_simple(&mut stream, "405 Method Not Allowed", "text/plain", b"");
    }

    let decoded = percent_decode(url_path);

    // Health probe — lets a second app instance detect an already-running
    // server (see start()). Checked before path resolution because it is
    // not under the music root.
    if decoded == "/__jukebox_health" {
        return respond_simple(&mut stream, "200 OK", "text/plain", b"jukebox-media-server");
    }

    let file = match std::fs::canonicalize(Path::new(&decoded)) {
        Ok(f) => f,
        Err(_) => {
            return respond_simple(&mut stream, "404 Not Found", "text/plain", b"file not found");
        }
    };

    // Security: the resolved file must live under one of the allowed roots.
    if !is_within(&file, roots) {
        return respond_simple(&mut stream, "403 Forbidden", "text/plain", b"forbidden");
    }

    let len = match std::fs::metadata(&file) {
        Ok(m) => m.len(),
        Err(_) => {
            return respond_simple(&mut stream, "404 Not Found", "text/plain", b"file not found");
        }
    };
    let mime = content_type_for(&file);
    let head_only = method == "HEAD";

    match range_header {
        Some(spec) => handle_range_request(&mut stream, &file, len, mime, &spec, head_only),
        None => {
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                mime, len
            );
            stream.write_all(resp.as_bytes())?;
            if !head_only {
                write_file_range(&mut stream, &file, 0, len)?;
            }
            Ok(())
        }
    }
}

/// Handle a `Range: bytes=...` request — respond 206 with the slice, or
/// 416 if the range is unsatisfiable.
fn handle_range_request(
    stream: &mut TcpStream,
    file: &Path,
    len: u64,
    mime: &str,
    spec: &str,
    head_only: bool,
) -> std::io::Result<()> {
    match parse_range(spec, len) {
        None => {
            let resp = format!(
                "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nConnection: close\r\n\r\n",
                len
            );
            stream.write_all(resp.as_bytes())?;
            Ok(())
        }
        Some((start, end)) => {
            let count = end - start + 1;
            let resp = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nConnection: close\r\n\r\n",
                mime, start, end, len, count
            );
            stream.write_all(resp.as_bytes())?;
            if !head_only {
                write_file_range(stream, file, start, count)?;
            }
            Ok(())
        }
    }
}

/// Parse a range spec ("bytes=0-499", "bytes=500-", "bytes=-500") into an
/// inclusive (start, end) byte pair, or None if unsatisfiable.
fn parse_range(spec: &str, len: u64) -> Option<(u64, u64)> {
    let part = spec.strip_prefix("bytes=").map(|s| s.trim())?;
    // Only the first range is honored (clients send one).
    let part = part.split(',').next()?.trim();
    if part.is_empty() {
        return None;
    }
    let (a, b) = part.split_once('-')?;
    let a = a.trim();
    let b = b.trim();

    if a.is_empty() && b.is_empty() {
        None
    } else if a.is_empty() {
        // Suffix range: last N bytes.
        let n: u64 = b.parse().ok()?;
        if n == 0 || len == 0 {
            return None;
        }
        let n = n.min(len);
        Some((len - n, len - 1))
    } else if b.is_empty() {
        let s: u64 = a.parse().ok()?;
        if s >= len {
            return None;
        }
        Some((s, len - 1))
    } else {
        let s: u64 = a.parse().ok()?;
        let e: u64 = b.parse().ok()?;
        if s > e || s >= len {
            return None;
        }
        Some((s, e.min(len - 1)))
    }
}

/// Stream a slice of a file to the socket in 64KB chunks.
fn write_file_range(
    stream: &mut TcpStream,
    file: &Path,
    start: u64,
    count: u64,
) -> std::io::Result<()> {
    use std::io::{Seek, SeekFrom};
    let mut f = std::fs::File::open(file)?;
    f.seek(SeekFrom::Start(start))?;
    let mut remaining = count;
    let mut buf = vec![0u8; 65536];
    while remaining > 0 {
        let want = (remaining as usize).min(buf.len());
        let n = f.read(&mut buf[..want])?;
        if n == 0 {
            break;
        }
        stream.write_all(&buf[..n])?;
        remaining -= n as u64;
    }
    Ok(())
}

/// True if `file` (canonicalized) is inside one of `roots` (canonicalized).
fn is_within(file: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| file == *root || file.starts_with(root))
}

/// Decode %XX sequences (what the frontend's encodeURI() produces).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            match std::str::from_utf8(&bytes[i + 1..i + 3])
                .ok()
                .and_then(|h| u8::from_str_radix(h, 16).ok())
            {
                Some(b) => {
                    out.push(b);
                    i += 3;
                }
                None => {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// MIME type by file extension.
fn content_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") | Some("m4a") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("webm") => "video/webm",
        Some("ogv") => "video/ogg",
        Some("avi") => "video/x-msvideo",
        Some("wmv") => "video/x-ms-wmv",
        Some("flv") => "video/x-flv",
        Some("mpg") | Some("mpeg") => "video/mpeg",
        Some("mp3") => "audio/mpeg",
        Some("ogg") | Some("oga") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// Write a simple (no body-streaming) HTTP response.
fn respond_simple(
    stream: &mut TcpStream,
    status: &str,
    mime: &str,
    body: &[u8],
) -> std::io::Result<()> {
    let resp = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        status,
        mime,
        body.len()
    );
    stream.write_all(resp.as_bytes())?;
    stream.write_all(body)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Raw-socket HTTP GET (no external deps) — returns the full response.
    fn http_get(port: u16, request: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .write_all(request.as_bytes())
            .expect("write request");
        let mut buf = Vec::new();
        let mut chunk = [0u8; 65536];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&buf).into_owned()
    }

    #[test]
    fn serves_files_full_and_range() {
        // Build a temp "music" root with one known file.
        let root = std::env::temp_dir().join(format!("jukebox-media-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let file_path = root.join("Song With Space.mp4");
        let content: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
        std::fs::write(&file_path, &content).unwrap();

        // Port 0 = OS assigns a free port.
        let port = start(&root, &[0]).expect("start media server");
        // file_path starts with '/', so no extra slash needed.
        let url_path = percent_encode_path(&file_path.to_string_lossy());

        // 200 — full file
        let full = http_get(port, &format!("GET {} HTTP/1.1\r\nHost: x\r\n\r\n", url_path));
        assert!(full.starts_with("HTTP/1.1 200"), "expected 200, got: {}", &full[..20]);
        assert!(full.contains("Content-Length: 1000"));
        assert!(full.contains("video/mp4"));

        // 206 — range 10-19 (10 bytes)
        let ranged = http_get(
            port,
            &format!(
                "GET {} HTTP/1.1\r\nHost: x\r\nRange: bytes=10-19\r\n\r\n",
                url_path
            ),
        );
        assert!(ranged.starts_with("HTTP/1.1 206"), "expected 206, got: {}", &ranged[..20]);
        assert!(ranged.contains("Content-Range: bytes 10-19/1000"));
        assert!(ranged.contains("Content-Length: 10"));

        // 416 — unsatisfiable
        let bad = http_get(
            port,
            &format!(
                "GET {} HTTP/1.1\r\nHost: x\r\nRange: bytes=5000-6000\r\n\r\n",
                url_path
            ),
        );
        assert!(bad.starts_with("HTTP/1.1 416"), "expected 416, got: {}", &bad[..20]);

        // 404 — missing file INSIDE the allowed root
        let missing = http_get(
            port,
            &format!(
                "GET /{}nope.mp4 HTTP/1.1\r\nHost: x\r\n\r\n",
                percent_encode_path(&root.to_string_lossy())
            ),
        );
        assert!(missing.starts_with("HTTP/1.1 404"), "expected 404, got: {}", &missing[..20]);

        // Health endpoint — used to detect a running server instance.
        let health = http_get(port, "GET /__jukebox_health HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(health.starts_with("HTTP/1.1 200"), "expected 200, got: {}", &health[..20]);
        assert!(health.contains("jukebox-media-server"));

        // Port-in-use: a second "instance" must detect the running server
        // via the health probe and reuse it instead of failing.
        let reused = start(&root, &[port]).expect("second instance reuses running server");
        assert_eq!(reused, port);

        // 403 — file outside the allowed root
        let outside = std::env::temp_dir().join(format!(
            "jukebox-media-outside-{}.bin",
            std::process::id()
        ));
        std::fs::write(&outside, b"secret").unwrap();
        let forbidden = http_get(
            port,
            &format!(
                "GET {} HTTP/1.1\r\nHost: x\r\n\r\n",
                percent_encode_path(&outside.to_string_lossy())
            ),
        );
        assert!(forbidden.starts_with("HTTP/1.1 403"), "expected 403, got: {}", &forbidden[..20]);

        // Cleanup
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&outside);
    }

    /// Minimal URL path encoder for tests (mirrors the frontend's encodeURI
    /// behavior for path segments).
    fn percent_encode_path(p: &str) -> String {
        let mut out = String::new();
        for b in p.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                    out.push(b as char)
                }
                _ => out.push_str(&format!("%{:02X}", b)),
            }
        }
        out
    }
}
