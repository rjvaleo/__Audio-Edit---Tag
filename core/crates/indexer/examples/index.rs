//! Index a library and write AUDIO-INDEX.tsv.
use std::path::Path;

fn main() -> std::io::Result<()> {
    let lib = std::env::args().nth(1).expect("usage: index <library> [out.tsv]");
    let out = std::env::args().nth(2).unwrap_or_else(|| "AUDIO-INDEX.tsv".into());
    let lib = Path::new(&lib);

    let roots = indexer::library_roots(lib)?;
    println!("roots: {roots:?}");

    let t0 = std::time::Instant::now();
    let mut all = Vec::new();
    for r in &roots {
        all.extend(indexer::scan_folder(lib, r)?);
    }
    let elapsed = t0.elapsed();

    let f = std::fs::File::create(&out)?;
    let mut w = indexer::tsv::Writer::new(std::io::BufWriter::new(f), indexer::FILE_COLUMNS)?;
    for r in &all { w.row(&r.to_row())?; }
    w.flush()?;

    println!("{} files in {:.2}s -> {out}", all.len(), elapsed.as_secs_f64());
    let mut cats: std::collections::BTreeMap<&str, usize> = Default::default();
    for r in &all { *cats.entry(r.category.as_str()).or_default() += 1; }
    println!("\ncategories:");
    for (k, v) in cats { println!("  {k:<16} {v}"); }
    Ok(())
}
