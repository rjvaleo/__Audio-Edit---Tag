use super::*;

#[test]
fn the_four_factory_boards_load_and_their_mod_rows_find_their_controls() {
    let boards = factory();
    let names: Vec<&str> = boards.iter().filter_map(|b| b.get("name").and_then(Value::as_str)).collect();
    assert_eq!(names, ["Glass Split", "Dub Room", "Grit Bus", "Bubble Garden"]);
    for f in &boards {
        let name = f.get("name").and_then(Value::as_str).unwrap();
        let board = board_from_json(f).unwrap_or_else(|e| panic!("{name}: {e}"));
        wave::BoardPlan::compile(&board, 48_000.0).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mods = parse_mods(f.get("mods").unwrap()).unwrap_or_else(|e| panic!("{name}: {e}"));
        let p = Patch { board: Some(board), mods, ..Patch::default() };
        assert_eq!(PatchState::new(&p).board_mods().len(), p.mods.len(), "{name}: a row names a control the board lacks");
    }
}

#[test]
fn a_board_round_trips_through_json() {
    let b = Board::migrate(&Patch::default().values).complete().unwrap();
    let back = board_from_json(&json::parse(&board_json(&b).to_string()).unwrap()).unwrap();
    assert_eq!(back, b);
}

#[test]
fn the_fx_list_is_the_82_with_their_controls() {
    let fx = fx_list();
    assert_eq!(fx.len(), 82);
    let find = |k: &str| fx.iter().find(|e| e.get("kind").and_then(Value::as_str) == Some(k)).unwrap();
    let hall = find("fx:lxp-hall");
    assert_eq!(hall.get("suite").and_then(Value::as_str), Some("Lexicon"));
    assert_eq!(hall.get("category").and_then(Value::as_str), Some("reverb"));
    // The notch's gain is inert: kept for old documents, not offered.
    let notch = find("fx:dattorro-notch");
    assert!(notch.get("params").unwrap().arr().unwrap().iter().all(|p| p.get("key").and_then(Value::as_str) != Some("gainDb")));
}
