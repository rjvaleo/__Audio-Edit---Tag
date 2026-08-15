//! Entry point: start the local server and open a browser at it.

use server::{serve, state::App};
use std::path::PathBuf;
use std::sync::Arc;

const DEFAULT_PORT: u16 = 8737;

fn main() -> std::io::Result<()> {
    // Data lives beside the executable so the app is self-contained and the
    // audio library stays untouched.
    let exe = std::env::current_exe().ok();
    let data_dir = std::env::var_os("AUDIOLAB_DATA")
        .map(PathBuf::from)
        .or_else(|| exe.as_ref().and_then(|p| p.parent()).map(|p| p.join("data")))
        .unwrap_or_else(|| PathBuf::from("data"));
    std::fs::create_dir_all(&data_dir)?;

    let app = Arc::new(App::new(data_dir.clone()));

    // A library given on the command line wins over the stored one.
    if let Some(arg) = std::env::args().nth(1) {
        let p = PathBuf::from(&arg);
        if p.is_dir() {
            app.set_library(p)?;
        } else {
            eprintln!("not a folder: {arg}");
        }
    }

    // A port can be asked for, which is what lets a scratch instance run beside
    // a working one on a port of its own. Without it `bind` walks up from 8737
    // and a second instance lands wherever it happens to fit — which is how a
    // throwaway server once ended up playing over a real session, on a port
    // nobody had noticed it take.
    let preferred = std::env::var("AUDIOLAB_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let listener = serve::bind(preferred)?;
    let port = listener.local_addr()?.port();
    let url = format!("http://127.0.0.1:{port}/");

    println!("Audio Library");
    println!("  data    : {}", data_dir.display());
    match app.library_path() {
        Some(p) => println!("  library : {}", p.display()),
        None => println!("  library : not chosen yet — pick one in the browser"),
    }
    println!("  open    : {url}");
    println!("  (Ctrl-C to stop)");

    open_browser(&url);
    serve::run(listener, app)
}

/// Best-effort: if this fails the URL is printed above and still works.
fn open_browser(url: &str) {
    let (cmd, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else if cfg!(windows) {
        ("cmd", vec!["/C", "start", "", url])
    } else {
        ("xdg-open", vec![url])
    };
    let _ = std::process::Command::new(cmd).args(args).spawn();
}
