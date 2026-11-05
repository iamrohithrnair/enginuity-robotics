// Checks imported mesh geometry, units, and colors against CAD fixtures.



use rc_cad::{import, Kind};
use std::f64::consts::PI;

struct Mesh {
    tris: usize,
    area: f64,
    volume: f64,
    min: [f64; 3],
    max: [f64; 3],
    colors: Vec<Option<[f64; 4]>>,
    json: String,
}

fn load(name: &str) -> Mesh {
    let path = format!("{}/tests/data/{name}", env!("CARGO_MANIFEST_DIR"));
    let bytes = std::fs::read(&path).unwrap();
    let kind = if name.ends_with(".igs") { Kind::Iges } else { Kind::Step };
    let (json, f) = import(&bytes, kind, rc_cad::Accuracy::standard(1.0)).unwrap();
    let mut m = Mesh { tris: f.len() / 9, area: 0.0, volume: 0.0, min: [f64::INFINITY; 3], max: [f64::NEG_INFINITY; 3], colors: vec![], json: json.clone() };
    for t in f.chunks(9) {
        let p: Vec<[f64; 3]> = (0..3).map(|k| [t[3 * k] as f64, t[3 * k + 1] as f64, t[3 * k + 2] as f64]).collect();
        let u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
        let v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        let c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        m.area += 0.5 * (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
        let q = [p[1][1] * p[2][2] - p[1][2] * p[2][1], p[1][2] * p[2][0] - p[1][0] * p[2][2], p[1][0] * p[2][1] - p[1][1] * p[2][0]];
        m.volume += (p[0][0] * q[0] + p[0][1] * q[1] + p[0][2] * q[2]) / 6.0;
        for q in &p {
            for k in 0..3 {
                m.min[k] = m.min[k].min(q[k]);
                m.max[k] = m.max[k].max(q[k]);
            }
        }
    }
     
    for part in json.split("\"color\":").skip(1) {
        if part.starts_with("null") {
            m.colors.push(None);
        } else {
            let end = part.find(']').unwrap();
            let v: Vec<f64> = part[1..end].split(',').map(|s| s.parse().unwrap()).collect();
            m.colors.push(Some([v[0], v[1], v[2], v[3]]));
        }
    }
    m
}

fn close(a: f64, b: f64, rel: f64) -> bool {
    (a - b).abs() <= rel * b.abs().max(1e-9)
}

fn near3(a: [f64; 3], b: [f64; 3]) -> bool {
    (0..3).all(|k| (a[k] - b[k]).abs() < 1e-4)
}

#[test]
fn box_with_colour() {
    let m = load("box.stp");
    assert_eq!(m.tris, 12, "{}", m.json);
    assert!(close(m.area, 2200.0, 1e-9), "{}", m.area);
    assert!(close(m.volume, 6000.0, 1e-9), "outward normals: {}", m.volume);
    assert!(near3(m.min, [0.0; 3]) && near3(m.max, [10.0, 20.0, 30.0]));
    assert_eq!(m.colors, vec![Some([1.0, 0.0, 0.0, 1.0])]);
}

#[test]
fn inch_units() {
    let m = load("box-inch.stp");
    assert!(near3(m.max, [25.4, 50.8, 76.2]), "{:?}", m.max);
    assert!(close(m.volume, 6.0 * 25.4f64.powi(3), 1e-6));
    assert_eq!(m.colors, vec![None]);
}

#[test]
fn bspline_face() {
    let m = load("box-bspline-top.stp");
    assert!(close(m.volume, 6000.0, 1e-9), "{}", m.volume);
    assert!(close(m.area, 2200.0, 1e-9));
}


fn ngon(n: f64, r: f64) -> (f64, f64) {
    (0.5 * n * r * r * (2.0 * PI / n).sin(), 2.0 * n * r * (PI / n).sin())
}

#[test]
fn cylinder_like_reference() {
     
    let m = load("cylinder.stp");
    assert_eq!(m.tris, 48, "{}", m.json);
    let (a, p) = ngon(13.0, 10.0);
    assert!(close(m.volume, a * 20.0, 1e-6), "{} vs {}", m.volume, a * 20.0);
    assert!(close(m.area, 2.0 * a + p * 20.0, 1e-6), "{}", m.area);
    assert!(close(m.max[2], 20.0, 1e-9) && close(m.min[2], 0.0, 1e-9));
     
    assert!((m.colors[0].unwrap()[0] - 0.21404).abs() < 1e-4, "{:?}", m.colors);
     
    let m = load("cylinder-r100.stp");
    assert_eq!(m.tris, 124, "{}", m.json);
    let (a, _) = ngon(32.0, 100.0);
    assert!(close(m.volume, a * 50.0, 1e-6));
    assert_eq!(m.colors, vec![None]);
}

#[test]
fn hemisphere_closes_at_the_pole() {
    let m = load("hemisphere.stp");
    let v = 2.0 / 3.0 * PI * 1000.0;
    assert!(m.volume < v && m.volume > 0.85 * v, "{} vs {v}", m.volume);
    assert!(close(m.max[2], 10.0, 1e-9), "{:?}", m.max);
    assert!(m.tris > 40 && m.tris < 100, "{}", m.tris);
}

#[test]
fn cone_in_degrees() {
    let m = load("frustum-deg.stp");
    let v = PI * 10.0 / 3.0 * (25.0 + 50.0 + 100.0);
    assert!(m.volume < v && m.volume > 0.9 * v, "{} vs {v}", m.volume);
    assert!(close(m.max[0], 10.0, 1e-6), "{:?}", m.max);
}

#[test]
fn assembly_placements() {
    for name in ["assembly.stp", "assembly-swapped.stp"] {
        let m = load(name);
        assert_eq!(m.tris, 24, "{name}");
        assert!(close(m.volume, 12000.0, 1e-9), "{name} {}", m.volume);
        assert!(near3(m.min, [0.0, 0.0, 0.0]) && near3(m.max, [100.0, 20.0, 30.0]), "{name} {:?} {:?}", m.min, m.max);
         
         
        assert_eq!(m.colors.len(), 2, "{name}");
        assert!(m.colors.iter().all(|c| *c == m.colors[0]));
        assert!(m.json.contains("\"part\":0") && m.json.contains("\"part\":1"), "{}", m.json);
        assert!(m.json.contains("\"parts\":[\"block\",\"block\"]"), "{}", m.json);
    }
}

#[test]
fn single_part_has_one_named_part() {
    let m = load("box.stp");
    assert!(m.json.contains("\"part\":0") && !m.json.contains("\"part\":1"), "{}", m.json);
    let m = load("plate.igs");
    assert!(m.json.contains("\"parts\":[\"\"]"), "{}", m.json);
}

#[test]
fn iges_trimmed_plate_with_hole() {
    let m = load("plate.igs");
    let exact = 800.0 - PI * 25.0;
    assert!(m.area > exact && m.area < exact * 1.03, "{} {}", m.area, m.json);
    assert!(near3(m.min, [0.0, 0.0, 0.0]) && near3(m.max, [40.0, 20.0, 0.0]));
     
    let c = m.colors[0].unwrap();
    assert!((c[0] - 0.0331).abs() < 1e-3 && (c[1] - 0.3185).abs() < 1e-3 && c[2] == 1.0, "{c:?}");
    assert!(m.tris < 40, "{}", m.tris);
}
