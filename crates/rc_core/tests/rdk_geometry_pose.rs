// Checks geometry transforms when loading station fixtures.









use serde_json::Value;

 
#[path = "../src/testlib.rs"]
mod testlib;

fn load(name: &str) -> Option<Value> {
    let research = format!("{}/../../research/evidence/slf/rdk/{name}", env!("CARGO_MANIFEST_DIR"));
    let bytes = testlib::read_library_file("stations", name).or_else(|| std::fs::read(research).ok())?;
    let buf = rc_core::rdkfile::parse(&bytes).expect("parse");
    let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    Some(serde_json::from_slice(&buf[4..4 + n]).unwrap())
}

fn pose(v: &Value) -> Vec<f64> {
    v.as_array().unwrap().iter().map(|x| x.as_f64().unwrap() + 0.0).collect()
}





#[test]
fn europallet_geometry_pose() {
    let Some(v) = load("Conveying-with-UR10.rdk") else { return };
    let items = v["items"].as_array().unwrap();
    let pallets: Vec<&Value> = items.iter().filter(|i| i["name"] == "Europallet").collect();
    assert_eq!(pallets.len(), 2);
    let want = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, -145.0, 0.0, 0.0, 0.0, 1.0];
    for p in pallets {
        let g = pose(&p["geometry_pose"]);
        assert!(g.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-9), "{g:?}");
    }
    for it in items.iter().filter(|i| i["kind"] == "object" && i["name"].as_str().unwrap().starts_with("Part ")) {
        assert!(it.get("geometry_pose").is_none(), "{}", it["name"]);
    }
     
    let gripper = items.iter().find(|i| i["name"] == "GripperA").unwrap();
    assert_eq!(gripper["kind"], "tool");
    let g = pose(&gripper["geometry_pose"]);
    let c2 = [[1.0, 0.0, 0.0, 92.0], [0.0, 0.0, -1.0, 35.0], [0.0, 1.0, 0.0, 29.5]];
     
    for r in 0..3 {
        for c in 0..4 {
            let v: f64 = (0..3).map(|k| g[r * 4 + k] * c2[k][c]).sum::<f64>() + if c == 3 { g[r * 4 + 3] } else { 0.0 };
            let want = if r == c { 1.0 } else { 0.0 };
            assert!((v - want).abs() < 1e-9, "row {r} col {c}: {v}");
        }
    }
}






#[test]
fn mirror_geometry_poses() {
    let Some(dir) = testlib::library_kind_dir("stations") else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let (mut with_pose, mut stations) = (0, 0);
    for e in entries.flatten() {
        let path = e.path();
        if !path.extension().is_some_and(|x| x == "rdk" || x == "rdka") {
            continue;
        }
        let buf = rc_core::rdkfile::parse(&std::fs::read(&path).unwrap()).unwrap();
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        let v: Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
        let mut here = 0;
        for it in v["items"].as_array().unwrap().iter().chain(v["skipped"].as_array().unwrap()) {
            let Some(g) = it.get("geometry_pose") else { continue };
            let g = pose(g);
            for i in 0..3 {
                for j in 0..3 {
                    let dot: f64 = (0..3).map(|k| g[i * 4 + k] * g[j * 4 + k]).sum();
                    assert!((dot - if i == j { 1.0 } else { 0.0 }).abs() < 1e-6, "{path:?} {}: not rigid", it["name"]);
                }
            }
            here += 1;
        }
        with_pose += here;
        stations += (here > 0) as usize;
    }
    assert_eq!((with_pose, stations), (264, 85));
}
