//! The library's routes over HTTP, for the face-capture tools: they serve
//! MGL's page from the checkout and send its library routes here, so the page
//! is drawn from the same answers the app's modules get.
//!
//!   cargo run --release -p engine-library --example serve -- <port> <home> [mgl-data] [models]
//!
//! Only on 127.0.0.1, and never 8737 (the live app's).

use engine_library::{route, Library};
use server_core::http::{parse_request, Response};
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let port: u16 = args.first().and_then(|p| p.parse().ok()).unwrap_or(8798);
    assert_ne!(port, 8737, "8737 is the live app's");
    let home = PathBuf::from(args.get(1).expect("usage: serve <port> <home> [mgl-data] [models]"));
    let mgl = args.get(2).map(PathBuf::from);
    let models = args.get(3).map(PathBuf::from);
    let lib = Arc::new(Library::open(&home, mgl.as_deref(), models.as_deref()));
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind");
    eprintln!("library on 127.0.0.1:{port} (home {})", home.display());
    for stream in listener.incoming().flatten() {
        let lib = Arc::clone(&lib);
        std::thread::spawn(move || {
            let mut s = stream;
            let r = match parse_request(&s) {
                Ok(req) => {
                    let head = req.method == "HEAD";
                    (route(lib.app(), &req), !head)
                }
                Err(e) => (Response::error(400, &e.to_string()), true),
            };
            let _ = s.write_all(&r.0.to_bytes(r.1));
        });
    }
}
