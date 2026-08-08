//! The listener.

use crate::http::{parse_request, Response};
use crate::routes::route;
use crate::state::App;
use std::io::Write;
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

/// Bind to the first free port at or after `preferred`, on loopback only.
///
/// Loopback rather than all interfaces: this server reads any file in the
/// chosen library and has no authentication, so it must not be reachable from
/// the network.
pub fn bind(preferred: u16) -> std::io::Result<TcpListener> {
    let mut last_err = None;
    for port in preferred..preferred.saturating_add(50) {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(l) => return Ok(l),
            Err(e) => last_err = Some(e),
        }
    }
    // Fall back to whatever the OS will give us rather than refusing to start.
    TcpListener::bind("127.0.0.1:0").map_err(|e| last_err.unwrap_or(e))
}

pub fn run(listener: TcpListener, app: Arc<App>) -> std::io::Result<()> {
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let app = Arc::clone(&app);
        // A thread per connection. The client is one browser; the concurrency
        // that matters is a long audio stream not blocking the rest of the UI.
        std::thread::spawn(move || {
            if let Err(e) = handle(stream, app) {
                // A browser cancelling a media request mid-stream is normal and
                // shows up as a broken pipe; it is not worth reporting.
                if e.kind() != std::io::ErrorKind::BrokenPipe {
                    eprintln!("request failed: {e}");
                }
            }
        });
    }
    Ok(())
}

fn handle(mut stream: TcpStream, app: Arc<App>) -> std::io::Result<()> {
    let peer = stream.try_clone()?;
    let req = match parse_request(peer) {
        Ok(r) => r,
        Err(_) => {
            let r = Response::error(400, "malformed request");
            stream.write_all(&r.to_bytes(true))?;
            return Ok(());
        }
    };

    let is_head = req.method == "HEAD";
    let response = route(&app, &req);
    stream.write_all(&response.to_bytes(!is_head))?;
    stream.flush()
}
