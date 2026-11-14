//! Browse's types: the counts per index category, and the files of a type a
//! page at a time (`/api/types`, `/api/type-files`).

use super::*;
use super::invariants_export_map::scan;
use server::json::Value;

fn cats(v: &Value) -> Vec<(String, f64)> {
    let Some(Value::Arr(a)) = v.get("categories") else { panic!("no categories: {}", v.to_string()) };
    a.iter()
        .map(|c| (c.get("category").and_then(|x| x.as_str()).unwrap().to_string(), num(c, &["files"])))
        .collect()
}

fn files(v: &Value) -> Vec<String> {
    let Some(Value::Arr(a)) = v.get("files") else { panic!("no files: {}", v.to_string()) };
    a.iter().map(|f| f.get("path").and_then(|x| x.as_str()).unwrap().to_string()).collect()
}

#[test]
fn every_listed_file_is_counted_once_and_can_be_listed_by_its_type() {
    let s = Scratch::new("types");
    for i in 0..5 {
        s.sound(&format!("kit/tone{i}.wav"), 4_000 + i * 3_000);
    }
    // No audio header: listed only with Play all files.
    fs::write(s.library.join("kit/notes.txt"), "not a sound").unwrap();
    let app = s.app();
    scan(&app);

    let t = json(&server::routes::route(&app, &get("/api/types", &[])));
    let c = cats(&t);
    let sum: f64 = c.iter().map(|x| x.1).sum();
    assert_eq!(sum, 5.0, "{}", t.to_string());
    assert_eq!(num(&t, &["total"]), 5.0);
    let every = json(&server::routes::route(&app, &get("/api/types", &[("all", "1")])));
    assert_eq!(num(&every, &["total"]), 6.0, "{}", every.to_string());

    // Every category's files, asked for by that category, add up to them all.
    let mut seen = Vec::new();
    for (cat, n) in &c {
        let r = json(&server::routes::route(&app, &get("/api/type-files", &[("cats", cat)])));
        assert_eq!(num(&r, &["total"]), *n);
        seen.extend(files(&r));
    }
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 5);

    // Several categories at once, in pages, sorted by length.
    let all_cats = c.iter().map(|x| x.0.clone()).collect::<Vec<_>>().join(",");
    let p1 = json(&server::routes::route(&app, &get("/api/type-files",
        &[("cats", &all_cats), ("sort", "length"), ("limit", "3")])));
    let p2 = json(&server::routes::route(&app, &get("/api/type-files",
        &[("cats", &all_cats), ("sort", "length"), ("limit", "3"), ("offset", "3")])));
    assert_eq!(num(&p1, &["total"]), 5.0);
    let (a, b) = (files(&p1), files(&p2));
    assert_eq!((a.len(), b.len()), (3, 2));
    assert_eq!(a, vec!["kit/tone0.wav", "kit/tone1.wav", "kit/tone2.wav"], "shortest first");

    // Find narrows by name.
    let q = json(&server::routes::route(&app, &get("/api/type-files", &[("cats", &all_cats), ("q", "TONE3")])));
    assert_eq!(files(&q), vec!["kit/tone3.wav"]);
    // And an instrument nobody has gives nothing rather than everything.
    let none = json(&server::routes::route(&app, &get("/api/type-files", &[("cats", &all_cats), ("instrument", "Kazoo")])));
    assert_eq!(num(&none, &["total"]), 0.0);
}

#[test]
fn type_files_without_categories_is_a_client_error() {
    let s = Scratch::new("types-none");
    let app = s.app();
    assert_eq!(status(&server::routes::route(&app, &get("/api/type-files", &[]))), 400);
    let t = json(&server::routes::route(&app, &get("/api/types", &[])));
    assert_eq!(num(&t, &["total"]), 0.0);
}
