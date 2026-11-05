// Reads IGES entities into the CAD geometry model.





use crate::geom::{adaptive_t, Accuracy, Curve, Surface, Tol};
use crate::math::*;
use crate::nurbs::{BCurve, BSurf};
use crate::tess::{FaceIn, Rgba};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::f64::consts::TAU;

#[derive(Clone, Debug)]
enum P {
    Num(f64),
    Str(String),
    Null,
}

impl P {
    fn f(&self) -> f64 {
        match self {
            P::Num(v) => *v,
            _ => 0.0,
        }
    }
    fn i(&self) -> i64 {
        self.f().round() as i64
    }
}

struct De {
    kind: i64,

    xform: i64,
    status: [u8; 4],
    color: i64,
    form: i64,
}

struct Iges {
    des: HashMap<usize, De>,
    params: HashMap<usize, Vec<P>>,
    unit: f64,
}


fn parse_params(s: &str, pd: u8, rd: u8) -> Vec<P> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        while i < b.len() && b[i] == b' ' {
            i += 1;
        }
        if i >= b.len() {
            break;
        }
        if b[i] == rd {
            break;
        }
        if b[i] == pd {
            out.push(P::Null);
            i += 1;
            continue;
        }
         
        let st = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i > st && i < b.len() && (b[i] == b'H' || b[i] == b'h') {
            let n: usize = s[st..i].parse().unwrap_or(0);
            let from = i + 1;
            let to = (from + n).min(b.len());
            out.push(P::Str(String::from_utf8_lossy(&b[from..to]).into_owned()));
            i = to;
        } else {
            i = st;
            while i < b.len() && b[i] != pd && b[i] != rd {
                i += 1;
            }
            let t = s[st..i].trim().replace(['D', 'd'], "E");
            if t.is_empty() {
                out.push(P::Null);
            } else {
                match t.parse::<f64>() {
                    Ok(v) => out.push(P::Num(v)),
                    Err(_) => out.push(P::Str(t)),
                }
            }
        }
        while i < b.len() && b[i] == b' ' {
            i += 1;
        }
        if i < b.len() && b[i] == pd {
            i += 1;
            continue;
        }
        break;
    }
    out
}

fn field(line: &str, k: usize) -> &str {
    let s = k * 8;
    if s >= line.len() {
        return "";
    }
    line[s..(s + 8).min(line.len())].trim()
}

fn read(bytes: &[u8]) -> Result<Iges, String> {
    let text = String::from_utf8_lossy(bytes);
    let mut g = String::new();
    let mut d: Vec<String> = Vec::new();
    let mut p: Vec<(usize, String)> = Vec::new();
    let mut seen = false;
    for raw in text.split('\n') {
        let line = raw.trim_end_matches('\r');
        if line.len() < 73 {
            continue;
        }
        let Some(sec) = line.as_bytes().get(72).copied() else { continue };
        let body = &line[..72];
        match sec {
            b'S' => seen = true,
            b'G' => {
                seen = true;
                g.push_str(body);
            }
            b'D' => d.push(body.to_string()),
            b'P' => {
                let ptr: usize = line.get(64..72).map(|s| s.trim()).and_then(|s| s.parse().ok()).unwrap_or(0);
                p.push((ptr, line[..64].to_string()));
            }
            b'C' => return Err("Compressed IGES files are not supported".into()),
            _ => {}
        }
    }
    if !seen || d.is_empty() {
        return Err("Not an IGES file".into());
    }
     
    let gb = g.as_bytes();
    let (pd, rd) = {
        let mut pd = b',';
        let mut rd = b';';
        if gb.len() >= 3 && gb[0] == b'1' && (gb[1] == b'H' || gb[1] == b'h') {
            pd = gb[2];
             
            if gb.len() >= 6 && gb[4] == b'1' && (gb[5] == b'H' || gb[5] == b'h') {
                rd = gb.get(6).copied().unwrap_or(b';');
            }
        } else if gb.first() == Some(&b',') {
             
            if gb.len() >= 4 && gb[1] == b'1' && (gb[2] == b'H' || gb[2] == b'h') {
                rd = gb[3];
            }
        }
        (pd, rd)
    };
    let gp = parse_params(&g, pd, rd);
    let unit_flag = gp.get(13).map(|v| v.i()).unwrap_or(2);
    let unit_name = match gp.get(14) {
        Some(P::Str(s)) => s.trim().to_ascii_uppercase(),
        _ => String::new(),
    };
    let unit = match unit_flag {
        1 => 25.4,
        2 => 1.0,
        4 => 304.8,
        5 => 1_609_344.0,
        6 => 1000.0,
        7 => 1_000_000.0,
        8 => 0.0254,
        9 => 0.001,
        10 => 10.0,
        11 => 0.000_025_4,
        _ => match unit_name.trim_start_matches("UNITS=") {
            "IN" | "INCH" => 25.4,
            "FT" => 304.8,
            "M" => 1000.0,
            "CM" => 10.0,
            "KM" => 1e6,
            "UM" => 1e-3,
            "MIL" => 0.0254,
            _ => 1.0,
        },
    };
     
    let mut des = HashMap::new();
    for (k, pair) in d.chunks(2).enumerate() {
        if pair.len() < 2 {
            break;
        }
        let (l1, l2) = (&pair[0], &pair[1]);
        let num = |s: &str| s.parse::<i64>().unwrap_or(0);
        let st = field(l1, 8);
        let st = format!("{st:0>8}");
        let sb = st.as_bytes();
        let two = |i: usize| ((sb[i] - b'0') as u32 * 10 + (sb[i + 1] - b'0') as u32) as u8;
        let status = if sb.iter().all(|c| c.is_ascii_digit()) { [two(0), two(2), two(4), two(6)] } else { [0; 4] };
        des.insert(
            2 * k + 1,
            De { kind: num(field(l1, 0)), xform: num(field(l1, 6)), status, color: num(field(l2, 2)), form: num(field(l2, 4)) },
        );
    }
     
    let mut chunks: HashMap<usize, String> = HashMap::new();
    for (ptr, body) in p {
        chunks.entry(ptr).or_default().push_str(&body);
    }
    let mut params = HashMap::new();
    for (ptr, s) in chunks {
        let mut v = parse_params(&s, pd, rd);
        if !v.is_empty() {
            v.remove(0);  
        }
        params.insert(ptr, v);
    }
    Ok(Iges { des, params, unit })
}


type Seg = (Curve, f64, f64);

struct Ctx {
    g: Iges,
    skipped: BTreeMap<String, usize>,
    
    tol: Tol,
    
    face_tol: Tol,
}

impl Ctx {
    fn skip(&mut self, kind: i64) {
        *self.skipped.entry(format!("IGES entity {kind}")).or_default() += 1;
    }

    fn par(&self, de: usize) -> Option<&Vec<P>> {
        self.g.params.get(&de)
    }

    fn n(&self, de: usize, i: usize) -> f64 {
        self.par(de).and_then(|v| v.get(i)).map(|p| p.f()).unwrap_or(0.0)
    }

    fn ptr(&self, de: usize, i: usize) -> usize {
        self.par(de).and_then(|v| v.get(i)).map(|p| p.i()).unwrap_or(0).unsigned_abs() as usize
    }

    
    fn xform(&self, de: usize) -> Xform {
        let mut t = Xform::IDENTITY;
        let mut cur = self.g.des.get(&de).map(|d| d.xform).unwrap_or(0);
        let mut guard = 0;
        while cur > 0 && guard < 16 {
            let m = cur as usize;
            if self.g.des.get(&m).map(|d| d.kind) != Some(124) {
                break;
            }
            let v: Vec<f64> = (0..12).map(|i| self.n(m, i)).collect();
            let x = Xform { m: [[v[0], v[1], v[2], v[3]], [v[4], v[5], v[6], v[7]], [v[8], v[9], v[10], v[11]]] };
            t = x.mul(&t);
            cur = self.g.des.get(&m).map(|d| d.xform).unwrap_or(0);
            guard += 1;
        }
        t
    }

    fn color(&self, de: usize) -> Option<Rgba> {
        let c = self.g.des.get(&de)?.color;
        if c < 0 {
            let p = (-c) as usize;
            if self.g.des.get(&p).map(|d| d.kind) == Some(314) {
                let c = |k: usize| crate::step::srgb_to_linear((self.n(p, k) / 100.0) as f32);
                return Some([c(0), c(1), c(2), 1.0]);
            }
            return None;
        }
        Some(match c {
            1 => [0.0, 0.0, 0.0, 1.0],
            2 => [1.0, 0.0, 0.0, 1.0],
            3 => [0.0, 1.0, 0.0, 1.0],
            4 => [0.0, 0.0, 1.0, 1.0],
            5 => [1.0, 1.0, 0.0, 1.0],
            6 => [1.0, 0.0, 1.0, 1.0],
            7 => [0.0, 1.0, 1.0, 1.0],
            8 => [1.0, 1.0, 1.0, 1.0],
            _ => return None,
        })
    }

    fn point116(&self, de: usize) -> Option<V3> {
        if self.g.des.get(&de)?.kind != 116 {
            return None;
        }
        Some(self.xform(de).apply([self.n(de, 0), self.n(de, 1), self.n(de, 2)]))
    }

    fn dir123(&self, de: usize) -> Option<V3> {
        if de == 0 || self.g.des.get(&de)?.kind != 123 {
            return None;
        }
        let x = self.xform(de);
        let v = [self.n(de, 0), self.n(de, 1), self.n(de, 2)];
        normalize(sub(x.apply(v), x.apply([0.0; 3])))
    }

    
    fn curve(&mut self, de: usize, depth: u32) -> Option<Vec<Seg>> {
        if depth > 8 {
            return None;
        }
        let d = self.g.des.get(&de)?;
        let (kind, form) = (d.kind, d.form);
        let x = self.xform(de);
        let mut segs: Vec<Seg> = match kind {
            100 => {
                let zt = self.n(de, 0);
                let c = [self.n(de, 1), self.n(de, 2), zt];
                let s = [self.n(de, 3), self.n(de, 4), zt];
                let e = [self.n(de, 5), self.n(de, 6), zt];
                let r = dist(c, s);
                let a0 = (s[1] - c[1]).atan2(s[0] - c[0]);
                let mut a1 = (e[1] - c[1]).atan2(e[0] - c[0]);
                while a1 <= a0 + 1e-12 {
                    a1 += TAU;
                }
                if a1 - a0 > TAU {
                    a1 -= TAU;
                }
                vec![(Curve::Circle { f: Frame { o: c, ..Frame::IDENTITY }, r }, a0, a1)]
            }
            102 => {
                let n = self.n(de, 0) as usize;
                let mut out = Vec::new();
                for k in 0..n {
                    let c = self.ptr(de, 1 + k);
                    out.extend(self.curve(c, depth + 1)?);
                }
                 
                let x2 = x;
                for s in out.iter_mut() {
                    s.0.transform(&x2);
                }
                return Some(out);
            }
            104 if form == 1 => {
                let (a, c, f) = (self.n(de, 0), self.n(de, 2), self.n(de, 5));
                let zt = self.n(de, 6);
                if a.abs() < 1e-300 || c.abs() < 1e-300 || -f / a <= 0.0 || -f / c <= 0.0 {
                    return None;
                }
                let (ra, rb) = ((-f / a).sqrt(), (-f / c).sqrt());
                let s = [self.n(de, 7), self.n(de, 8)];
                let e = [self.n(de, 9), self.n(de, 10)];
                let t0 = (s[1] / rb).atan2(s[0] / ra);
                let mut t1 = (e[1] / rb).atan2(e[0] / ra);
                while t1 <= t0 + 1e-12 {
                    t1 += TAU;
                }
                vec![(Curve::Ellipse { f: Frame { o: [0.0, 0.0, zt], ..Frame::IDENTITY }, a: ra, b: rb }, t0, t1)]
            }
            106 if matches!(form, 11 | 12 | 63) => {
                let ip = self.n(de, 0) as i64;
                let n = self.n(de, 1) as usize;
                let pts: Vec<V3> = if ip == 1 {
                    let zt = self.n(de, 2);
                    (0..n).map(|k| [self.n(de, 3 + 2 * k), self.n(de, 4 + 2 * k), zt]).collect()
                } else {
                    let stride = if ip == 3 { 6 } else { 3 };
                    (0..n).map(|k| [self.n(de, 2 + stride * k), self.n(de, 3 + stride * k), self.n(de, 4 + stride * k)]).collect()
                };
                if pts.len() < 2 {
                    return None;
                }
                let last = (pts.len() - 1) as f64;
                vec![(Curve::Poly(pts), 0.0, last)]
            }
            110 => {
                let a = [self.n(de, 0), self.n(de, 1), self.n(de, 2)];
                let b = [self.n(de, 3), self.n(de, 4), self.n(de, 5)];
                vec![(Curve::Line { p: a, d: sub(b, a) }, 0.0, 1.0)]
            }
            126 => {
                let k = self.n(de, 0) as usize;
                let m = self.n(de, 1) as usize;
                let nk = k + m + 2;
                let base = 6;
                let knots: Vec<f64> = (0..nk).map(|i| self.n(de, base + i)).collect();
                let w: Vec<f64> = (0..=k).map(|i| self.n(de, base + nk + i)).collect();
                let pts: Vec<V3> = (0..=k).map(|i| {
                    let o = base + nk + k + 1 + 3 * i;
                    [self.n(de, o), self.n(de, o + 1), self.n(de, o + 2)]
                }).collect();
                let o = base + nk + 4 * (k + 1);
                let (v0, v1) = (self.n(de, o), self.n(de, o + 1));
                let c = BCurve::new(m, knots, &pts, Some(&w))?;
                let (d0, d1) = c.domain();
                let (v0, v1) = if v1 > v0 { (v0.max(d0), v1.min(d1)) } else { (d0, d1) };
                vec![(Curve::BSpline(c), v0, v1)]
            }
            _ => {
                self.skip(kind);
                return None;
            }
        };
        for s in segs.iter_mut() {
            s.0.transform(&x);
        }
        Some(segs)
    }

    
    fn surface(&mut self, de: usize) -> Option<(Surface, Option<((f64, f64), (f64, f64))>)> {
        let d = self.g.des.get(&de)?;
        let kind = d.kind;
        let x = self.xform(de);
        let (mut s, dom) = match kind {
            128 => {
                let (k1, k2) = (self.n(de, 0) as usize, self.n(de, 1) as usize);
                let (m1, m2) = (self.n(de, 2) as usize, self.n(de, 3) as usize);
                let (n1, n2) = (k1 + m1 + 2, k2 + m2 + 2);
                let base = 9;
                let ku: Vec<f64> = (0..n1).map(|i| self.n(de, base + i)).collect();
                let kv: Vec<f64> = (0..n2).map(|i| self.n(de, base + n1 + i)).collect();
                let nw = (k1 + 1) * (k2 + 1);
                let wb = base + n1 + n2;
                let pb = wb + nw;
                let mut pts = vec![vec![[0.0; 3]; k2 + 1]; k1 + 1];
                let mut w = vec![vec![1.0; k2 + 1]; k1 + 1];
                for j in 0..=k2 {
                    for i in 0..=k1 {
                        let idx = i + j * (k1 + 1);
                        w[i][j] = self.n(de, wb + idx);
                        pts[i][j] = [self.n(de, pb + 3 * idx), self.n(de, pb + 3 * idx + 1), self.n(de, pb + 3 * idx + 2)];
                    }
                }
                let rb = pb + 3 * nw;
                let (u0, u1, v0, v1) = (self.n(de, rb), self.n(de, rb + 1), self.n(de, rb + 2), self.n(de, rb + 3));
                let b = BSurf::new(m1, m2, ku, kv, &pts, Some(&w))?;
                let ((du0, du1), (dv0, dv1)) = b.domain();
                let dom = if u1 > u0 && v1 > v0 { ((u0.max(du0), u1.min(du1)), (v0.max(dv0), v1.min(dv1))) } else { ((du0, du1), (dv0, dv1)) };
                (Surface::BSpline(b), Some(dom))
            }
            108 => {
                let n = [self.n(de, 0), self.n(de, 1), self.n(de, 2)];
                let dd = self.n(de, 3);
                let nn = normalize(n)?;
                let o = scale(nn, dd / norm(n));
                (Surface::Plane(Frame::from_axes(o, Some(nn), None)), None)
            }
            118 => {
                let c1 = self.single(self.ptr(de, 0))?;
                let mut c2 = self.single(self.ptr(de, 1))?;
                if self.n(de, 2) as i64 == 1 {
                    c2 = reverse_seg(c2);
                }
                (Surface::Ruled(seg_curve(c1), seg_curve(c2)), Some(((0.0, 1.0), (0.0, 1.0))))
            }
            120 => {
                let axis = self.single(self.ptr(de, 0))?;
                let gen = self.single(self.ptr(de, 1))?;
                let (sa, ta) = (self.n(de, 2), self.n(de, 3));
                let (o, a) = match &axis.0 {
                    Curve::Line { p, d } => (*p, normalize(*d)?),
                    _ => return None,
                };
                let (g0, g1) = (gen.1, gen.2);
                (Surface::Revolution(gen.0, o, a), Some(((sa, ta), (g0.min(g1), g0.max(g1)))))
            }
            122 => {
                let dir = self.single(self.ptr(de, 0))?;
                let l = [self.n(de, 1), self.n(de, 2), self.n(de, 3)];
                let start = dir.0.eval(dir.1);
                let (t0, t1) = (dir.1, dir.2);
                (Surface::Extrusion(dir.0, sub(l, start)), Some(((t0.min(t1), t0.max(t1)), (0.0, 1.0))))
            }
            190 | 192 | 194 | 196 | 198 => {
                let p = self.point116(self.ptr(de, 0))?;
                let (axis, refd, a, b) = match kind {
                    190 => (self.dir123(self.ptr(de, 1)), self.dir123(self.ptr(de, 2)), 0.0, 0.0),
                    192 => (self.dir123(self.ptr(de, 1)), self.dir123(self.ptr(de, 3)), self.n(de, 2), 0.0),
                    194 => (self.dir123(self.ptr(de, 1)), self.dir123(self.ptr(de, 4)), self.n(de, 2), self.n(de, 3).to_radians()),
                    196 => (self.dir123(self.ptr(de, 2)), self.dir123(self.ptr(de, 3)), self.n(de, 1), 0.0),
                    _ => (self.dir123(self.ptr(de, 1)), self.dir123(self.ptr(de, 4)), self.n(de, 2), self.n(de, 3)),
                };
                let f = Frame::from_axes(p, axis, refd);
                let s = match kind {
                    190 => Surface::Plane(f),
                    192 => Surface::Cylinder(f, a),
                    194 => Surface::Cone(f, a, b),
                    196 => Surface::Sphere(f, a),
                    _ => Surface::Torus(f, a, b),
                };
                 
                (s, None)
            }
            _ => {
                self.skip(kind);
                return None;
            }
        };
        s.transform(&x);
        Some((s, dom))
    }

    
    fn single(&mut self, de: usize) -> Option<Seg> {
        let mut v = self.curve(de, 0)?;
        if v.len() == 1 {
            v.pop()
        } else {
            None
        }
    }

    
    fn polyline(&self, segs: &[Seg]) -> Vec<V3> {
        let mut out: Vec<V3> = Vec::new();
        for (c, t0, t1) in segs {
            let pts = c.sample(*t0, *t1, self.tol);
            if let (Some(l), Some(f)) = (out.last(), pts.first()) {
                if dist(*l, *f) < 1e-9 {
                    out.pop();
                }
            }
            out.extend(pts);
        }
        if out.len() > 1 && dist(out[0], out[out.len() - 1]) < 1e-9 {
            out.pop();
        }
        out
    }

    
    
    fn boundary(&mut self, de: usize, s: &Surface, use_b: bool) -> Option<Result<Vec<((f64, f64), V3)>, Vec<V3>>> {
        if self.g.des.get(&de)?.kind != 142 {
            self.skip(self.g.des.get(&de)?.kind);
            return None;
        }
        let (b, c) = (self.ptr(de, 2), self.ptr(de, 3));
        if use_b && b != 0 {
            if let Some(segs) = self.curve(b, 0) {
                let mut out: Vec<((f64, f64), V3)> = Vec::new();
                for (cv, t0, t1) in &segs {
                    let n0 = match cv {
                        Curve::BSpline(bc) => (bc.spans() * (bc.p + 1)).clamp(2, 4000),
                        Curve::Poly(v) => v.len().max(2),
                        Curve::Line { .. } => 2,
                        _ => 16,
                    };
                    let f = |t: f64| {
                        let q = cv.eval(t);
                        s.eval(q[0], q[1])
                    };
                    for (t, p) in adaptive_t(&f, *t0, *t1, n0, self.tol) {
                        let q = cv.eval(t);
                        if let Some(l) = out.last() {
                            if (l.0 .0 - q[0]).abs() < 1e-12 && (l.0 .1 - q[1]).abs() < 1e-12 {
                                continue;
                            }
                        }
                        out.push(((q[0], q[1]), p));
                    }
                }
                if out.len() > 1 {
                    let (f, l) = (out[0].0, out[out.len() - 1].0);
                    if (f.0 - l.0).abs() < 1e-12 && (f.1 - l.1).abs() < 1e-12 {
                        out.pop();
                    }
                }
                return Some(Ok(out));
            }
        }
        if c != 0 {
            let segs = self.curve(c, 0)?;
            return Some(Err(self.polyline(&segs)));
        }
        None
    }

    fn trimmed(&mut self, de: usize) -> Option<FaceIn> {
        let (s, dom) = self.surface(self.ptr(de, 0))?;
        let n1 = self.n(de, 1) as i64;
        let n2 = self.n(de, 2) as usize;
        let use_b = matches!(s, Surface::BSpline(_) | Surface::Plane(_) if dom.is_some());
        let mut face = FaceIn { key: None, surface: s, loops: vec![], uv_loops: vec![], sense: true, color: None, xform: Xform::IDENTITY, tol: self.face_tol, part: 0 };
        let mut bounds: Vec<usize> = Vec::new();
        if n1 == 0 {
            let l = domain_loop(&face.surface, dom?, self.tol);
            face.uv_loops.push(l);
        } else {
            bounds.push(self.ptr(de, 3));
        }
        for k in 0..n2 {
            bounds.push(self.ptr(de, 4 + k));
        }
        for b in bounds {
            let surf = face.surface.clone();
            match self.boundary(b, &surf, use_b)? {
                Ok(uv) if uv.len() >= 2 => face.uv_loops.push(uv),
                Err(pts) if pts.len() >= 2 => face.loops.push(pts),
                _ => {}
            }
        }
        Some(face)
    }

    fn untrimmed(&mut self, de: usize) -> Option<FaceIn> {
        let (s, dom) = self.surface(de)?;
        let l = domain_loop(&s, dom?, self.tol);
        Some(FaceIn { key: None, surface: s, loops: vec![], uv_loops: vec![l], sense: true, color: None, xform: Xform::IDENTITY, tol: self.face_tol, part: 0 })
    }

    fn vertex(&self, list: usize, idx: usize) -> Option<V3> {
        if self.g.des.get(&list)?.kind != 502 || idx == 0 {
            return None;
        }
        let o = 1 + 3 * (idx - 1);
        Some(self.xform(list).apply([self.n(list, o), self.n(list, o + 1), self.n(list, o + 2)]))
    }

    
    fn edge(&mut self, list: usize, idx: usize, cache: &mut HashMap<(usize, usize), Option<Vec<V3>>>) -> Option<Vec<V3>> {
        if let Some(e) = cache.get(&(list, idx)) {
            return e.clone();
        }
        let res = (|| {
            if self.g.des.get(&list)?.kind != 504 || idx == 0 {
                return None;
            }
            let o = 1 + 5 * (idx - 1);
            let curve = self.ptr(list, o);
            let sv = self.vertex(self.ptr(list, o + 1), self.n(list, o + 2) as usize)?;
            let tv = self.vertex(self.ptr(list, o + 3), self.n(list, o + 4) as usize)?;
            let segs = self.curve(curve, 0)?;
            let mut pts = self.polyline(&segs);
            let closed = segs.first().map(|s| dist(s.0.eval(s.1), segs.last().unwrap().0.eval(segs.last().unwrap().2)) < 1e-9).unwrap_or(false);
            if closed && dist(sv, tv) < 1e-9 {
                pts.push(pts[0]);
            }
            if pts.len() < 2 {
                return None;
            }
            if dist(pts[0], tv) + dist(pts[pts.len() - 1], sv) < dist(pts[0], sv) + dist(pts[pts.len() - 1], tv) {
                pts.reverse();
            }
            let n = pts.len();
            pts[0] = sv;
            pts[n - 1] = tv;
            Some(pts)
        })();
        cache.insert((list, idx), res.clone());
        res
    }

    fn loop508(&mut self, de: usize, cache: &mut HashMap<(usize, usize), Option<Vec<V3>>>) -> Option<Vec<V3>> {
        if self.g.des.get(&de)?.kind != 508 {
            return None;
        }
        let n = self.n(de, 0) as usize;
        let mut out: Vec<V3> = Vec::new();
        let mut i = 1;
        for _ in 0..n {
            let ty = self.n(de, i) as i64;
            let list = self.ptr(de, i + 1);
            let idx = self.n(de, i + 2) as usize;
            let of = self.n(de, i + 3) as i64;
            let k = self.n(de, i + 4) as usize;
            i += 5 + 2 * k;
            if ty != 0 {
                continue;
            }
            let mut pts = self.edge(list, idx, cache)?;
            if of == 0 {
                pts.reverse();
            }
            if let Some(l) = out.last() {
                if dist(*l, pts[0]) < 1e-9 {
                    out.pop();
                }
            }
            out.extend(pts);
        }
        if out.len() > 1 && dist(out[0], out[out.len() - 1]) < 1e-9 {
            out.pop();
        }
        Some(out)
    }

    fn msbo(&mut self, de: usize, out: &mut Vec<FaceIn>) {
        let mut shells = vec![(self.ptr(de, 0), self.n(de, 1) as i64 != 0)];
        let nv = self.n(de, 2) as usize;
        for k in 0..nv {
            shells.push((self.ptr(de, 3 + 2 * k), self.n(de, 4 + 2 * k) as i64 != 0));
        }
        let mut cache = HashMap::new();
        let color = self.color(de);
        for (sh, sof) in shells {
            if self.g.des.get(&sh).map(|d| d.kind) != Some(514) {
                continue;
            }
            let nf = self.n(sh, 0) as usize;
            for k in 0..nf {
                let fde = self.ptr(sh, 1 + 2 * k);
                let of = self.n(sh, 2 + 2 * k) as i64 != 0;
                if self.g.des.get(&fde).map(|d| d.kind) != Some(510) {
                    self.skip(self.g.des.get(&fde).map(|d| d.kind).unwrap_or(0));
                    continue;
                }
                let Some((s, _)) = self.surface(self.ptr(fde, 0)) else { continue };
                let nl = self.n(fde, 1) as usize;
                let mut loops = Vec::new();
                for l in 0..nl {
                    if let Some(pts) = self.loop508(self.ptr(fde, 3 + l), &mut cache) {
                        if pts.len() >= 2 {
                            loops.push(pts);
                        }
                    }
                }
                if loops.is_empty() {
                    continue;
                }
                let c = self.color(fde).or(color);
                out.push(FaceIn { key: None, surface: s, loops, uv_loops: vec![], sense: of == sof, color: c, xform: Xform::IDENTITY, tol: self.face_tol, part: 0 });
            }
        }
    }
}


fn domain_loop(s: &Surface, dom: ((f64, f64), (f64, f64)), tol: Tol) -> Vec<((f64, f64), V3)> {
    let ((u0, u1), (v0, v1)) = dom;
    let n0 = match s {
        Surface::BSpline(b) => {
            let (a, c) = b.spans();
            (a.max(c) * (b.pu.max(b.pv) + 1)).clamp(2, 400)
        }
        Surface::Plane(_) => 1,
        _ => 16,
    };
    let mut l = Vec::new();
    for (a, b) in [((u0, v0), (u1, v0)), ((u1, v0), (u1, v1)), ((u1, v1), (u0, v1)), ((u0, v1), (u0, v0))] {
        let at = |t: f64| (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t);
        let f = |t: f64| {
            let uv = at(t);
            s.eval(uv.0, uv.1)
        };
        let pts = adaptive_t(&f, 0.0, 1.0, n0, tol);
        for (t, p) in &pts[..pts.len() - 1] {
            l.push((at(*t), *p));
        }
    }
    l
}

fn seg_curve(s: Seg) -> Curve {
     
    let (c, t0, t1) = s;
    let (d0, d1) = c.domain();
    if (t0 - d0).abs() < 1e-12 && (t1 - d1).abs() < 1e-12 {
        return c;
    }
    let pts: Vec<V3> = (0..=64).map(|k| c.eval(t0 + (t1 - t0) * k as f64 / 64.0)).collect();
    Curve::Poly(pts)
}

fn reverse_seg(s: Seg) -> Seg {
    let (c, t0, t1) = s;
    let pts: Vec<V3> = (0..=64).map(|k| c.eval(t1 + (t0 - t1) * k as f64 / 64.0)).collect();
    (Curve::Poly(pts), 0.0, 64.0)
}

pub struct Model {
    pub faces: Vec<FaceIn>,
    pub skipped: BTreeMap<String, usize>,
}

pub fn load(bytes: &[u8], acc: Accuracy) -> Result<Model, String> {
    let g = read(bytes)?;
    let unit = g.unit;
    let acc = acc.in_units(unit);
    let mut ctx = Ctx { g, skipped: BTreeMap::new(), tol: acc.edge, face_tol: acc.face };
    let xu = Xform::uniform_scale(unit);
    let mut faces = Vec::new();
     
    let mut used: HashSet<usize> = HashSet::new();
    let mut order: Vec<usize> = ctx.g.des.keys().copied().collect();
    order.sort_unstable();
    for de in &order {
        let d = &ctx.g.des[de];
        match d.kind {
            144 | 143 => {
                used.insert(ctx.ptr(*de, 0));
            }
            510 => {
                used.insert(ctx.ptr(*de, 0));
            }
            142 => {
                used.insert(ctx.ptr(*de, 1));
            }
            _ => {}
        }
    }
    for de in order {
        let (kind, status) = {
            let d = &ctx.g.des[&de];
            (d.kind, d.status)
        };
        let blanked = status[0] == 1;
        let physically_dependent = status[1] == 1 || status[1] == 3;
        if blanked {
            continue;
        }
        match kind {
            144 if !physically_dependent => match ctx.trimmed(de) {
                Some(mut f) => {
                    f.color = ctx.color(de).or_else(|| ctx.color(ctx.ptr(de, 0)));
                    f.xform = xu.mul(&ctx.xform(de));
                    faces.push(f);
                }
                None => *ctx.skipped.entry("IGES trimmed surface".into()).or_default() += 1,
            },
            186 if !physically_dependent => {
                let mut fs = Vec::new();
                ctx.msbo(de, &mut fs);
                let x = xu.mul(&ctx.xform(de));
                for mut f in fs {
                    f.xform = x;
                    faces.push(f);
                }
            }
            128 | 118 | 120 | 122 if !physically_dependent && !used.contains(&de) => {
                if let Some(mut f) = ctx.untrimmed(de) {
                    f.color = ctx.color(de);
                    f.xform = xu;
                    faces.push(f);
                }
            }
            143 | 140 | 141 | 308 | 408 if !physically_dependent => ctx.skip(kind),
            _ => {}
        }
    }
    Ok(Model { faces, skipped: ctx.skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_format_parameters() {
        let p = parse_params("126,1,1,0,0,1,0,0.,0.,1.D0,1.0E0,5Hab,cd,,3;", b',', b';');
        assert_eq!(p[0].i(), 126);
        assert_eq!(p[9].f(), 1.0);
        assert!(matches!(&p[11], P::Str(s) if s == "ab,cd"));
        assert!(matches!(p[12], P::Null));
        assert_eq!(p[13].i(), 3);
    }
}
