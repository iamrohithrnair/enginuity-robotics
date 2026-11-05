// Exposes CAD import jobs and mesh buffers to native and WebAssembly callers.







mod geom;
mod iges;
mod math;
mod nurbs;
mod p21;
mod step;
mod tess;

pub use geom::{Accuracy, Tol};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use tess::{FaceJob, Rgba};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Step,
    Iges,
}

pub struct Import {
    jobs: Vec<FaceJob>,
    faces: usize,
    failed: usize,
    skipped: BTreeMap<String, usize>,
    meshes: Vec<(Option<Rgba>, u32, Vec<f32>)>,
    by_color: HashMap<([u32; 4], u32), usize>,
    
    parts: Vec<String>,
}

impl Import {
    
    pub fn load(bytes: &[u8], kind: Kind, acc: Accuracy) -> Result<Import, String> {
        let (faces, mut skipped, parts) = match kind {
            Kind::Step => {
                let m = step::load(bytes, acc)?;
                let mut sk = m.skipped;
                if m.bad_instances > 0 {
                    sk.insert("unreadable STEP instances".into(), m.bad_instances);
                }
                (m.faces, sk, m.parts)
            }
            Kind::Iges => {
                let m = iges::load(bytes, acc)?;
                (m.faces, m.skipped, vec![String::new()])
            }
        };
        let n = faces.len();
        let mut jobs: Vec<FaceJob> = Vec::new();
        let mut keyed: HashMap<u64, Option<usize>> = HashMap::new();
        let mut failed = 0;
        for f in faces {
            if let Some(k) = f.key {
                if let Some(slot) = keyed.get(&k) {
                    match slot {
                        Some(j) => jobs[*j].instances.push((f.xform, f.color, f.part)),
                        None => failed += 1,
                    }
                    continue;
                }
            }
            match tess::build(&f) {
                Ok(job) => {
                    if let Some(k) = f.key {
                        keyed.insert(k, Some(jobs.len()));
                    }
                    jobs.push(job);
                }
                Err(e) => {
                    if let Some(k) = f.key {
                        keyed.insert(k, None);
                    }
                    failed += 1;
                    *skipped.entry(format!("face: {e}")).or_default() += 1;
                }
            }
        }
        if n == 0 {
            return Err("No surfaces or solids found in the file".into());
        }
        Ok(Import { jobs, faces: n, failed, skipped, meshes: Vec::new(), by_color: HashMap::new(), parts })
    }

    
    pub fn job_input(&self, i: usize) -> (Vec<(f64, f64)>, Vec<(usize, usize)>, usize) {
        let j = &self.jobs[i];
        (j.pts.clone(), j.edges.clone(), j.n_boundary)
    }

    
    pub fn job_points(&self, i: usize) -> (Vec<[f64; 3]>, usize) {
        (self.jobs[i].xyz.clone(), self.jobs[i].n_boundary)
    }

    
    pub fn job_info(&self, i: usize) -> (&'static str, [f64; 3], [f64; 3]) {
        let j = &self.jobs[i];
        let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in &j.xyz {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        (j.kind, lo, hi)
    }

    pub fn job_count(&self) -> usize {
        self.jobs.len()
    }

    
    pub fn add_triangles(&mut self, i: usize, tris: &[[usize; 3]], extra: &[math::V3]) {
        let job = &self.jobs[i];
        let n = job.xyz.len();
        let at = |k: usize| if k < n { job.xyz[k] } else { extra[k - n] };
        for (x, color, part) in job.instances.clone() {
            let key = (color.map(|c| c.map(f32::to_bits)).unwrap_or([u32::MAX; 4]), part);
            let slot = *self.by_color.entry(key).or_insert_with(|| {
                self.meshes.push((color, part, Vec::new()));
                self.meshes.len() - 1
            });
            let mirror = x.det() < 0.0;
            let out = &mut self.meshes[slot].2;
            for t in tris {
                let (a, b, c) = if mirror { (t[0], t[2], t[1]) } else { (t[0], t[1], t[2]) };
                let (p, q, r) = (x.apply(at(a)), x.apply(at(b)), x.apply(at(c)));
                if math::norm(math::cross(math::sub(q, p), math::sub(r, p))) < 1e-12 {
                    continue;
                }
                for v in [p, q, r] {
                    out.extend_from_slice(&[v[0] as f32, v[1] as f32, v[2] as f32]);
                }
            }
        }
    }

    pub fn face_failed(&mut self, reason: &str) {
        self.failed += self.jobs.len().min(1);
        *self.skipped.entry(format!("face: {reason}")).or_default() += 1;
    }

    
    
    pub fn run(&mut self, i: usize) -> bool {
        let job = &self.jobs[i];
        let mut res = Err(String::new());
        for v in 0..VARIANTS {
            let r = std::panic::catch_unwind(|| attempt(&job.pts, &job.xyz, &job.edges, job.n_boundary, job.flip, v));
            if let Ok(Ok(t)) = r {
                res = Ok(t);
                break;
            }
            res = Err(match r {
                Ok(Err(e)) => e,
                _ => "triangulation error".into(),
            });
        }
        match res {
            Ok((t, extra)) => {
                self.add_triangles(i, &t, &extra);
                true
            }
            Err(e) => {
                self.face_failed(&e);
                false
            }
        }
    }

    
    pub fn finish(&self) -> (String, Vec<f32>) {
        let mut floats = Vec::new();
        let mut parts = Vec::new();
        for (c, part, v) in &self.meshes {
            if v.is_empty() {
                continue;
            }
            let color = match c {
                Some(c) => format!("[{},{},{},{}]", c[0], c[1], c[2], c[3]),
                None => "null".into(),
            };
            parts.push(format!("{{\"color\":{color},\"offset\":{},\"count\":{},\"part\":{part}}}", floats.len(), v.len()));
            floats.extend_from_slice(v);
        }
        let names: Vec<String> = self.parts.iter().map(|n| json_str(n)).collect();
        let skipped: Vec<String> = self.skipped.iter().map(|(k, v)| format!("{}:{v}", json_str(k))).collect();
        let json = format!(
            "{{\"meshes\":[{}],\"parts\":[{}],\"faces\":{},\"failed\":{},\"skipped\":{{{}}}}}",
            parts.join(","),
            names.join(","),
            self.faces,
            self.failed,
            skipped.join(",")
        );
        (json, floats)
    }
}



pub const VARIANTS: u32 = 5;


type Attempt = Result<(Vec<[usize; 3]>, Vec<math::V3>), String>;

fn attempt(pts: &[(f64, f64)], xyz: &[math::V3], edges: &[(usize, usize)], nb: usize, flip: bool, v: u32) -> Attempt {
    match v {
        0 | 1 => tess::triangulate(pts, edges, flip, v).map(|t| (t, vec![])),
        _ => {
            let interior = if v == 4 { 0 } else { pts.len() - nb };
             
            let (bp, bx) = (&pts[..nb], &xyz[..nb]);
            let (mut rp, mut rx, re) = tess::repair(bp, bx, edges);
            let added = rx.len() - nb;
            let base = rp.len();
            rp.extend_from_slice(&pts[nb..nb + interior]);
            rx.extend_from_slice(&xyz[nb..nb + interior]);
            let tris = tess::triangulate(&rp, &re, flip, if v == 3 { 2 } else { 0 })?;
             
            let mut extra: Vec<math::V3> = rx[nb..nb + added].to_vec();
            extra.extend_from_slice(&rx[base..]);
            let remap = |i: usize| -> usize {
                if i < nb {
                    i
                } else if i < base {
                    pts.len() + (i - nb)
                } else {
                    pts.len() + added + (i - base)
                }
            };
            Ok((tris.into_iter().map(|t| [remap(t[0]), remap(t[1]), remap(t[2])]).collect(), extra))
        }
    }
}

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push(' '),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}


pub fn import(bytes: &[u8], kind: Kind, acc: Accuracy) -> Result<(String, Vec<f32>), String> {
    let mut im = Import::load(bytes, kind, acc)?;
    for i in 0..im.job_count() {
        im.run(i);
    }
    Ok(im.finish())
}

 

struct State {
    import: Option<Import>,
    result: Vec<u8>,
}

thread_local! {
    static STATE: RefCell<State> = const { RefCell::new(State { import: None, result: Vec::new() }) };
}

fn set_result(b: Vec<u8>) {
    STATE.with(|s| s.borrow_mut().result = b);
}

#[no_mangle]
pub extern "C" fn rc_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}



#[no_mangle]
pub unsafe extern "C" fn rc_free(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}







#[no_mangle]
pub unsafe extern "C" fn rc_cad_load(p: *const u8, len: usize, kind: u32, lin_mm: f64) -> i32 {
    let bytes = std::slice::from_raw_parts(p, len);
    let kind = if kind == 1 { Kind::Iges } else { Kind::Step };
    let acc = Accuracy::standard(if lin_mm > 0.0 { lin_mm } else { 1.0 });
    match Import::load(bytes, kind, acc) {
        Ok(im) => {
            let n = im.job_count() as i32;
            STATE.with(|s| s.borrow_mut().import = Some(im));
            n
        }
        Err(e) => {
            STATE.with(|s| s.borrow_mut().import = None);
            set_result(e.into_bytes());
            -1
        }
    }
}




#[no_mangle]
pub extern "C" fn rc_cad_face(i: u32, variant: u32) -> i32 {
    let i = i as usize;
    let input = STATE.with(|s| {
        let s = s.borrow();
        let im = s.import.as_ref()?;
        let j = im.jobs.get(i)?;
        Some((j.pts.clone(), j.xyz.clone(), j.edges.clone(), j.n_boundary, j.flip))
    });
    let Some((pts, xyz, edges, nb, flip)) = input else { return 1 };
    let res = attempt(&pts, &xyz, &edges, nb, flip, variant.min(VARIANTS - 1));
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let Some(im) = s.import.as_mut() else { return 1 };
        match res {
            Ok((t, extra)) => {
                im.add_triangles(i, &t, &extra);
                0
            }
            Err(e) => {
                if variant + 1 >= VARIANTS {
                    im.face_failed(&e);
                }
                1
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn rc_cad_variants() -> u32 {
    VARIANTS
}


#[no_mangle]
pub extern "C" fn rc_cad_face_trapped() {
    STATE.with(|s| {
        if let Ok(mut s) = s.try_borrow_mut() {
            if let Some(im) = s.import.as_mut() {
                im.face_failed("triangulation error");
            }
        }
    });
}


#[no_mangle]
pub extern "C" fn rc_cad_finish() -> i32 {
    let out = STATE.with(|s| {
        let s = s.borrow();
        s.import.as_ref().map(|im| im.finish())
    });
    let Some((json, floats)) = out else { return -1 };
    let mut b = Vec::with_capacity(8 + json.len() + floats.len() * 4);
    b.extend_from_slice(&(json.len() as u32).to_le_bytes());
    b.extend_from_slice(json.as_bytes());
    while b.len() % 4 != 0 {
        b.push(0);
    }
    for f in floats {
        b.extend_from_slice(&f.to_le_bytes());
    }
    let n = b.len() as i32;
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.result = b;
        s.import = None;
    });
    n
}

#[no_mangle]
pub extern "C" fn rc_result_ptr() -> *const u8 {
    STATE.with(|s| s.borrow().result.as_ptr())
}

#[no_mangle]
pub extern "C" fn rc_result_len() -> usize {
    STATE.with(|s| s.borrow().result.len())
}
