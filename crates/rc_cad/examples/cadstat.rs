

use rc_cad::{Import, Kind};
use std::time::Instant;

fn main() {
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path).expect("read");
        let kind = if path.to_lowercase().ends_with(".igs") || path.to_lowercase().ends_with(".iges") { Kind::Iges } else { Kind::Step };
        let t0 = Instant::now();
        let mut im = match Import::load(&bytes, kind, rc_cad::Accuracy::standard(1.0)) {
            Ok(im) => im,
            Err(e) => {
                println!("{path}: ERROR {e}");
                continue;
            }
        };
        let t1 = t0.elapsed();
        let mut panics = 0;
        for i in 0..im.job_count() {
            let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| im.run(i))).map(|ok| if ok { Ok(()) } else { Err(()) });
            if !matches!(r, Ok(Ok(()))) {
                if let Ok(dir) = std::env::var("RC_CAD_DUMP") {
                    let (pts, edges, nb) = im.job_input(i);
                    let mut t = format!("{nb}\n");
                    for p in &pts {
                        t += &format!("{} {}\n", p.0, p.1);
                    }
                    t += "E\n";
                    for e in &edges {
                        t += &format!("{} {}\n", e.0, e.1);
                    }
                    std::fs::write(format!("{dir}/job{i}.txt"), t).unwrap();
                    eprintln!("dumped job {i}: {} pts, {} boundary, {} edges", pts.len(), nb, edges.len());
                }
                panics += 1;
                im.face_failed("panic");
            }
        }
        if let Ok(lim) = std::env::var("RC_CAD_FAR") {
            let lim: f64 = lim.parse().unwrap();
            for i in 0..im.job_count() {
                let (k, lo, hi) = im.job_info(i);
                if (0..3).any(|c| lo[c] < -lim || hi[c] > lim) {
                    eprintln!("far job {i} {k} {lo:?} {hi:?}");
                    let (pts, nb) = im.job_points(i);
                    let far: Vec<(usize, [f64; 3])> = pts.iter().cloned().enumerate().filter(|(_, p)| p.iter().any(|c| c.abs() > lim)).take(5).collect();
                    eprintln!("   n {} boundary {nb} far {far:?}", pts.len());
                    eprintln!("   first {:?}", &pts[..pts.len().min(4)]);
                    let (uv, _, _) = im.job_input(i);
                    for k in 25..50.min(uv.len()) {
                        eprintln!("   {k} uv {:?} xyz {:?}", uv[k], pts[k]);
                    }
                }
            }
        }
        let (json, f) = im.finish();
        let mut vol = 0.0f64;
        let (mut lo, mut hi) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
        for q in f.chunks(3) {
            for k in 0..3 {
                lo[k] = lo[k].min(q[k]);
                hi[k] = hi[k].max(q[k]);
            }
        }
        for t in f.chunks(9) {
            let p: Vec<[f64; 3]> = (0..3).map(|k| [t[3 * k] as f64, t[3 * k + 1] as f64, t[3 * k + 2] as f64]).collect();
            let q = [p[1][1] * p[2][2] - p[1][2] * p[2][1], p[1][2] * p[2][0] - p[1][0] * p[2][2], p[1][0] * p[2][1] - p[1][1] * p[2][0]];
            vol += (p[0][0] * q[0] + p[0][1] * q[1] + p[0][2] * q[2]) / 6.0;
        }
        let head: String = match json.find("\"faces\"") {
            Some(k) => json[k..].to_string(),
            None => json.chars().take(600).collect(),
        };
        println!("{path}: load {:?} total {:?} tris {} panics {panics} volume {vol:.1} bbox {lo:?} {hi:?}\n  {head}", t1, t0.elapsed(), f.len() / 9);
    }
}
