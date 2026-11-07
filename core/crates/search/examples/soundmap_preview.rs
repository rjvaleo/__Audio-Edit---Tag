//! Run the sound map on a dump of fingerprints and print it as JSON, to look at
//! a library's map without a server.
//!
//!   cargo run --release -p search --example soundmap_preview -- input.tsv > map.json
//!
//! Each input line: path, family, heard labels joined by `|`, the fingerprint
//! as comma-separated numbers (empty when not listened to), then the words
//! joined by `|`.

fn main() {
    let path = std::env::args().nth(1).expect("input.tsv");
    let text = std::fs::read_to_string(path).unwrap();
    let mut names = Vec::new();
    let inputs: Vec<search::soundmap::Input> = text
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            let c: Vec<&str> = l.split('\t').collect();
            names.push(c[0].to_string());
            let e: Vec<f32> = c.get(3).map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect()).unwrap_or_default();
            search::soundmap::Input {
                embedding: if e.is_empty() { None } else { Some(search::soundmap::Embedding::from_values(&e)) },
                heard: c[2].split('|').filter(|s| !s.is_empty()).map(String::from).collect(),
                family: c[1].to_string(),
                words: c.get(4).map(|s| s.split('|').filter(|w| !w.is_empty()).map(String::from).collect()).unwrap_or_default(),
            }
        })
        .collect();
    let t = std::time::Instant::now();
    let m = search::soundmap::build(&inputs);
    eprintln!("{} sounds, {} clusters, {:?}", inputs.len(), m.clusters.len(), t.elapsed());
    let pts: Vec<String> = m
        .points
        .iter()
        .zip(&names)
        .map(|(p, n)| {
            let at = p.at.map(|a| format!("[{:.5},{:.5}]", a[0], a[1])).unwrap_or("null".into());
            let c = p.cluster.map(|c| c.to_string()).unwrap_or("null".into());
            let near: Vec<String> = p.near.iter().map(|x| x.to_string()).collect();
            format!("{{\"p\":{:?},\"at\":{at},\"c\":{c},\"near\":[{}]}}", n, near.join(","))
        })
        .collect();
    let cls: Vec<String> = m
        .clusters
        .iter()
        .map(|c| format!("{{\"name\":{:?},\"family\":{:?},\"n\":{},\"centre\":[{:.5},{:.5}]}}", c.name, c.family, c.members.len(), c.centre[0], c.centre[1]))
        .collect();
    println!("{{\"points\":[{}],\"clusters\":[{}]}}", pts.join(","), cls.join(","));
}
