




use crate::geom::{Surface, Tol};
use crate::math::*;
use std::collections::HashMap;

pub type Rgba = [f32; 4];


pub struct FaceIn {
    
    pub key: Option<u64>,
    pub surface: Surface,
    
    pub loops: Vec<Vec<V3>>,
    
    pub uv_loops: Vec<Vec<((f64, f64), V3)>>,
    
    pub sense: bool,
    pub color: Option<Rgba>,
    
    pub xform: Xform,
    pub tol: Tol,
    
    pub part: u32,
}


pub struct FaceJob {
    pub pts: Vec<(f64, f64)>,
    pub xyz: Vec<V3>,
    pub edges: Vec<(usize, usize)>,
    pub n_boundary: usize,
    pub flip: bool,
    pub instances: Vec<(Xform, Option<Rgba>, u32)>,
    
    pub kind: &'static str,
}

type Uv = (f64, f64);

struct Pt {
    uv: Uv,
    p: V3,
}


fn unwrap(x: f64, prev: f64, period: Option<f64>) -> f64 {
    match period {
        Some(p) if p > 0.0 => x + ((prev - x) / p).round() * p,
        _ => x,
    }
}

fn signed_area(c: &[Pt]) -> f64 {
    let n = c.len();
    let mut a = 0.0;
    for i in 0..n {
        let (p, q) = (c[i].uv, c[(i + 1) % n].uv);
        a += p.0 * q.1 - q.0 * p.1;
    }
    0.5 * a
}


fn project_loop(s: &Surface, pts: &[V3], pu: Option<f64>, pv: Option<f64>, tol: Tol) -> Vec<Pt> {
    let mut out: Vec<Pt> = Vec::with_capacity(pts.len());
    let mut prev: Option<Uv> = None;
    let poles = s.poles_v();
    let at_pole = |v: f64| poles.iter().any(|p| (v - p).abs() < 1e-9);
    for p in pts {
        let (mut u, mut v) = s.project(*p, prev);
        if let Some(q) = prev {
            u = unwrap(u, q.0, pu);
            v = unwrap(v, q.1, pv);
             
            if at_pole(q.1) && !at_pole(v) && (u - q.0).abs() > 1e-12 {
                let pole3 = out.last().map(|l| l.p).unwrap_or(*p);
                out.push(Pt { uv: (u, q.1), p: pole3 });
            }
        }
        let uv = (u, v);
         
        if let Some(last) = out.last() {
            let (luv, l3) = (last.uv, last.p);
            refine_chord(s, luv, l3, uv, *p, pu, pv, tol, 0, &mut out);
        }
        out.push(Pt { uv, p: *p });
        prev = Some(uv);
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn refine_chord(s: &Surface, a: Uv, a3: V3, b: Uv, b3: V3, pu: Option<f64>, pv: Option<f64>, tol: Tol, depth: u32, out: &mut Vec<Pt>) {
    if depth > 10 || matches!(s, Surface::Plane(_)) {
        return;
    }
    let mid_uv = (0.5 * (a.0 + b.0), 0.5 * (a.1 + b.1));
    let m3 = lerp(a3, b3, 0.5);
    if dist(s.eval(mid_uv.0, mid_uv.1), m3) <= tol.lin {
        return;
    }
    let (mut u, mut v) = s.project(m3, Some(mid_uv));
    u = unwrap(u, mid_uv.0, pu);
    v = unwrap(v, mid_uv.1, pv);
    let q3 = s.eval(u, v);
     
    if dist(q3, m3) > 50.0 * tol.lin + dist(a3, b3) {
        return;
    }
    refine_chord(s, a, a3, (u, v), q3, pu, pv, tol, depth + 1, out);
    out.push(Pt { uv: (u, v), p: q3 });
    refine_chord(s, (u, v), q3, b, b3, pu, pv, tol, depth + 1, out);
}


fn winding(c: &[Pt], ax: usize, period: Option<f64>) -> i64 {
    let Some(p) = period else { return 0 };
    if c.len() < 2 {
        return 0;
    }
    let get = |q: &Pt| if ax == 0 { q.uv.0 } else { q.uv.1 };
    let first = get(&c[0]);
    let last = get(&c[c.len() - 1]);
    let closing = unwrap(first, last, Some(p));
    ((closing - first) / p).round() as i64
}



fn open_at(c: &[Pt], ax: usize, p: f64, a0: f64, s: &Surface) -> Option<Vec<Pt>> {
    let n = c.len();
    let get = |q: &Uv| if ax == 0 { q.0 } else { q.1 };
     
    let mut seq: Vec<Uv> = c.iter().map(|q| q.uv).collect();
    let closing = {
        let f = c[0].uv;
        let l = c[n - 1].uv;
        if ax == 0 {
            (unwrap(f.0, l.0, Some(p)), f.1)
        } else {
            (f.0, unwrap(f.1, l.1, Some(p)))
        }
    };
    seq.push(closing);
    let mut pts3: Vec<V3> = c.iter().map(|q| q.p).collect();
    pts3.push(c[0].p);
    let shift = |q: Uv, d: f64| if ax == 0 { (q.0 + d, q.1) } else { (q.0, q.1 + d) };
    let total = get(&seq[n]) - get(&seq[0]);
     
    let eps = 1e-9 * p.max(1.0);
    if let Some(i) = (0..n).find(|&i| {
        let r = (get(&seq[i]) - a0).rem_euclid(p);
        r < eps || p - r < eps
    }) {
        let mut out: Vec<Pt> = Vec::with_capacity(n + 1);
        for j in i..=n {
            out.push(Pt { uv: seq[j], p: pts3[j] });
        }
        for j in 1..=i {
            out.push(Pt { uv: shift(seq[j], total), p: pts3[j] });
        }
        let d = a0 - get(&out[0].uv);
        let d = d - (d / p).round() * p + (d / p).round() * p;  
        for q in out.iter_mut() {
            q.uv = shift(q.uv, d);
        }
        out.dedup_by(|b, a| (a.uv.0 - b.uv.0).abs() < 1e-12 && (a.uv.1 - b.uv.1).abs() < 1e-12);
        return Some(out);
    }
     
    for i in 0..n {
        let (x0, x1) = (get(&seq[i]), get(&seq[i + 1]));
        let k0 = ((x0 - a0) / p).floor();
        let k1 = ((x1 - a0) / p).floor();
        if k0 != k1 || (x1 - a0).rem_euclid(p) == 0.0 {
            let k = if x1 > x0 { k1 } else { k0 };
            let line = a0 + k * p;
            let t = if (x1 - x0).abs() > 0.0 { ((line - x0) / (x1 - x0)).clamp(0.0, 1.0) } else { 0.0 };
            let other = if ax == 0 { seq[i].1 + (seq[i + 1].1 - seq[i].1) * t } else { seq[i].0 + (seq[i + 1].0 - seq[i].0) * t };
            let cut: Uv = if ax == 0 { (line, other) } else { (other, line) };
            let cut3 = s.eval(cut.0, cut.1);
             
            let mut out = vec![Pt { uv: cut, p: cut3 }];
            for j in (i + 1)..=n {
                out.push(Pt { uv: seq[j], p: pts3[j] });
            }
            for j in 1..=i {
                out.push(Pt { uv: shift(seq[j], total), p: pts3[j] });
            }
            out.push(Pt { uv: shift(cut, total), p: cut3 });
             
            let d = a0 - line;
            for q in out.iter_mut() {
                q.uv = shift(q.uv, d);
            }
            out.dedup_by(|b, a| (a.uv.0 - b.uv.0).abs() < 1e-12 && (a.uv.1 - b.uv.1).abs() < 1e-12);
            return Some(out);
        }
    }
    None
}


fn steps(s: &Surface, bb: (Uv, Uv), tol: Tol) -> (f64, f64) {
    let inf = f64::INFINITY;
    match s {
        Surface::Plane(_) => (inf, inf),
        Surface::Cylinder(_, r) => (tol.arc_step(*r), inf),
        Surface::Cone(_, r, a) => {
            let rmax = (r + bb.0 .1 * a.tan()).abs().max((r + bb.1 .1 * a.tan()).abs());
            (tol.arc_step(rmax.max(tol.lin)), inf)
        }
        Surface::Sphere(_, r) => (tol.arc_step(*r), tol.arc_step(*r)),
        Surface::Torus(_, big, r) => (tol.arc_step(big + r), tol.arc_step(*r)),
        _ => generic_steps(s, bb, tol),
    }
}


fn generic_steps(s: &Surface, bb: (Uv, Uv), tol: Tol) -> (f64, f64) {
    let (n_u, n_v) = match s {
        Surface::BSpline(b) => {
            let (a, c) = b.spans();
            ((a * 4).clamp(8, 48), (c * 4).clamp(8, 48))
        }
        _ => (24, 24),
    };
    let ((u0, v0), (u1, v1)) = bb;
    let hu = (u1 - u0) / n_u as f64;
    let hv = (v1 - v0) / n_v as f64;
    let mut su: f64 = f64::INFINITY;
    let mut sv: f64 = f64::INFINITY;
    if !(hu > 0.0) || !(hv > 0.0) {
        return (su, sv);
    }
    for i in 1..n_u {
        for j in 1..n_v {
            let u = u0 + hu * i as f64;
            let v = v0 + hv * j as f64;
            let c = s.eval(u, v);
            let (pu1, pu0) = (s.eval(u + hu, v), s.eval(u - hu, v));
            let (pv1, pv0) = (s.eval(u, v + hv), s.eval(u, v - hv));
            let duu = norm(add(sub(pu1, scale(c, 2.0)), pu0)) / (hu * hu);
            let dvv = norm(add(sub(pv1, scale(c, 2.0)), pv0)) / (hv * hv);
            let du = norm(sub(pu1, pu0)) / (2.0 * hu);
            let dv = norm(sub(pv1, pv0)) / (2.0 * hv);
            if duu > 1e-12 {
                su = su.min((8.0 * tol.lin / duu).sqrt()).min(tol.ang * du / duu);
            }
            if dvv > 1e-12 {
                sv = sv.min((8.0 * tol.lin / dvv).sqrt()).min(tol.ang * dv / dvv);
            }
        }
    }
    (su, sv)
}


struct SegGrid {
    cell: f64,
    map: HashMap<(i64, i64), Vec<usize>>,
}

impl SegGrid {
    fn new(segs: &[(Uv, Uv)], cell: f64) -> SegGrid {
        let mut map: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (k, (a, b)) in segs.iter().enumerate() {
            let (x0, x1) = ((a.0.min(b.0) / cell).floor() as i64, (a.0.max(b.0) / cell).floor() as i64);
            let (y0, y1) = ((a.1.min(b.1) / cell).floor() as i64, (a.1.max(b.1) / cell).floor() as i64);
            if (x1 - x0 + 1) * (y1 - y0 + 1) > 1_000_000 {
                continue;
            }
            for x in x0..=x1 {
                for y in y0..=y1 {
                    map.entry((x, y)).or_default().push(k);
                }
            }
        }
        SegGrid { cell, map }
    }

    fn near(&self, segs: &[(Uv, Uv)], p: Uv, r: f64) -> bool {
        let (cx, cy) = ((p.0 / self.cell).floor() as i64, (p.1 / self.cell).floor() as i64);
        for x in cx - 1..=cx + 1 {
            for y in cy - 1..=cy + 1 {
                if let Some(v) = self.map.get(&(x, y)) {
                    for k in v {
                        let (a, b) = segs[*k];
                        let (dx, dy) = (b.0 - a.0, b.1 - a.1);
                        let l2 = dx * dx + dy * dy;
                        let t = if l2 > 0.0 { (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
                        let (qx, qy) = (a.0 + t * dx - p.0, a.1 + t * dy - p.1);
                        if qx * qx + qy * qy < r * r {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }
}


pub fn build(face: &FaceIn) -> Result<FaceJob, String> {
    let s = &face.surface;
    let tol = face.tol;
    let pu = s.period_u();
    let pv = s.period_v();
    let mut loops: Vec<Vec<Pt>> = Vec::new();
    for l in &face.loops {
        let mut c = project_loop(s, l, pu, pv, tol);
        c.dedup_by(|b, a| dist(a.p, b.p) < 1e-12 && (a.uv.0 - b.uv.0).abs() < 1e-12 && (a.uv.1 - b.uv.1).abs() < 1e-12);
        while c.len() > 2 && dist(c[0].p, c[c.len() - 1].p) < 1e-12 {
            c.pop();
        }
        if c.len() >= 2 {
            loops.push(c);
        }
    }
    for l in &face.uv_loops {
        let mut c: Vec<Pt> = Vec::with_capacity(l.len());
        for (uv, p) in l {
            let uv = match c.last() {
                Some(q) => (unwrap(uv.0, q.uv.0, pu), unwrap(uv.1, q.uv.1, pv)),
                None => *uv,
            };
            c.push(Pt { uv, p: *p });
        }
        c.dedup_by(|b, a| (a.uv.0 - b.uv.0).abs() < 1e-12 && (a.uv.1 - b.uv.1).abs() < 1e-12);
        if c.len() > 2 && (c[0].uv.0 - c[c.len() - 1].uv.0).abs() < 1e-12 && (c[0].uv.1 - c[c.len() - 1].uv.1).abs() < 1e-12 {
            c.pop();
        }
        if c.len() >= 2 {
            loops.push(c);
        }
    }
     
    if loops.is_empty() && s.period_u().is_none() {
        return Err("face without boundary".into());
    }

     
    let wu: Vec<i64> = loops.iter().map(|c| winding(c, 0, pu)).collect();
    let wv: Vec<i64> = loops.iter().map(|c| winding(c, 1, pv)).collect();
    let mut contours: Vec<Vec<Pt>> = Vec::new();
    let band_axis = if wu.iter().any(|w| *w != 0) {
        Some(0)
    } else if wv.iter().any(|w| *w != 0) {
        Some(1)
    } else {
        None
    };
    let mut seams: Vec<(f64, f64, f64)> = Vec::new();  
    match band_axis {
        None => {
             
            let outer = (0..loops.len()).max_by(|a, b| signed_area(&loops[*a]).abs().total_cmp(&signed_area(&loops[*b]).abs())).unwrap_or(0);
            let centre = |c: &[Pt]| {
                let n = c.len() as f64;
                (c.iter().map(|q| q.uv.0).sum::<f64>() / n, c.iter().map(|q| q.uv.1).sum::<f64>() / n)
            };
            let oc = if loops.is_empty() { (0.0, 0.0) } else { centre(&loops[outer]) };
            for (k, mut c) in loops.into_iter().enumerate() {
                if k != outer {
                    let cc = centre(&c);
                    let du = pu.map(|p| ((oc.0 - cc.0) / p).round() * p).unwrap_or(0.0);
                    let dv = pv.map(|p| ((oc.1 - cc.1) / p).round() * p).unwrap_or(0.0);
                    for q in c.iter_mut() {
                        q.uv = (q.uv.0 + du, q.uv.1 + dv);
                    }
                }
                contours.push(c);
            }
            if contours.iter().map(|c| signed_area(c).abs()).fold(0.0, f64::max) < 1e-14 {
                full_domain(s, &mut contours, &mut seams)?;
            }
        }
        Some(ax) => {
            let period = if ax == 0 { pu } else { pv }.unwrap_or(std::f64::consts::TAU);
            let get = |q: &Pt| if ax == 0 { q.uv.0 } else { q.uv.1 };
            let wind = if ax == 0 { &wu } else { &wv };
            let (wrapping, holes): (Vec<usize>, Vec<usize>) = (0..loops.len()).partition(|k| wind[*k] != 0);
             
            let mut ivals: Vec<(f64, f64)> = holes
                .iter()
                .map(|k| {
                    let lo = loops[*k].iter().map(&get).fold(f64::INFINITY, f64::min);
                    let hi = loops[*k].iter().map(&get).fold(f64::NEG_INFINITY, f64::max);
                    (lo.rem_euclid(period), lo.rem_euclid(period) + (hi - lo))
                })
                .collect();
            ivals.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut a0 = get(&loops[wrapping[0]][0]).rem_euclid(period);
            if !ivals.is_empty() {
                let mut best = (0.0, a0);
                for i in 0..ivals.len() {
                    let end = ivals[i].1;
                    let next = if i + 1 < ivals.len() { ivals[i + 1].0 } else { ivals[0].0 + period };
                    if next - end > best.0 {
                        best = (next - end, (end + next) / 2.0);
                    }
                }
                a0 = best.1.rem_euclid(period);
            }
            let opened: Option<Vec<Vec<Pt>>> = wrapping.iter().map(|k| open_at(&loops[*k], ax, period, a0, s)).collect();
            let mut paths = opened.ok_or("seam crossing not found")?;
             
            for p in paths.iter_mut() {
                if p.len() >= 2 && get(&p[p.len() - 1]) < get(&p[0]) {
                    p.reverse();
                    let d = a0 - get(&p[0]);
                    for q in p.iter_mut() {
                        q.uv = if ax == 0 { (q.uv.0 + d, q.uv.1) } else { (q.uv.0, q.uv.1 + d) };
                    }
                }
            }
            let other = |q: &Pt| if ax == 0 { q.uv.1 } else { q.uv.0 };
            let mean_other = |p: &Vec<Pt>| p.iter().map(&other).sum::<f64>() / p.len().max(1) as f64;
             
            let other_period = if ax == 0 { pv } else { pu };
            if let (Some(op), Some(first)) = (other_period, paths.first().map(&mean_other)) {
                for p in paths.iter_mut().skip(1) {
                    let d = ((first - mean_other(p)) / op).round() * op;
                    if d != 0.0 {
                        for q in p.iter_mut() {
                            q.uv = if ax == 0 { (q.uv.0, q.uv.1 + d) } else { (q.uv.0 + d, q.uv.1) };
                        }
                    }
                }
            }
            for p in &paths {
                let (first, last) = (get(&p[0]), get(&p[p.len() - 1]));
                if (first - a0).abs() > 1e-9 * (1.0 + a0.abs()) || (last - first - period).abs() > 1e-6 * period {
                    return Err("open seam path".into());
                }
            }
            paths.sort_by(|a, b| mean_other(a).total_cmp(&mean_other(b)));
            let mk = |a: f64, o: f64| if ax == 0 { (a, o) } else { (o, a) };
            match paths.len() {
                1 => {
                     
                    let poles = if ax == 0 { s.poles_v() } else { vec![] };
                    let path = paths.pop().unwrap();
                     
                    let goes_up = wind[wrapping[0]] > 0;
                    let interior_high = goes_up == face.sense;
                    let m = mean_other(&path);
                    let pole = if interior_high {
                        poles.iter().copied().filter(|p| *p > m).fold(f64::INFINITY, f64::min)
                    } else {
                        poles.iter().copied().filter(|p| *p < m).fold(f64::NEG_INFINITY, f64::max)
                    };
                    let pole = if pole.is_finite() {
                        pole
                    } else {
                         
                        let alt = poles.iter().copied().find(|p| p.is_finite()).ok_or("open periodic face")?;
                        alt
                    };
                    let mut c = path;
                    let end = mk(a0 + period, pole);
                    let start = mk(a0, pole);
                    seams.push((a0 + period, other(&c[c.len() - 1]), pole));
                    seams.push((a0, pole, other(&c[0])));
                    c.push(Pt { uv: end, p: s.eval(end.0, end.1) });
                    c.push(Pt { uv: start, p: s.eval(start.0, start.1) });
                    contours.push(c);
                }
                _ => {
                     
                    let hi = paths.pop().unwrap();
                    let lo = paths.remove(0);
                    let mut c: Vec<Pt> = lo;
                    let lo_end = other(&c[c.len() - 1]);
                    let lo_start = other(&c[0]);
                    let mut h = hi;
                    h.reverse();
                    seams.push((a0 + period, lo_end, other(&h[0])));
                    seams.push((a0, other(&h[h.len() - 1]), lo_start));
                    c.extend(h);
                    contours.push(c);
                    for p in paths {
                        contours.push(p);
                    }
                }
            }
            for k in holes {
                let mut c: Vec<Pt> = std::mem::take(&mut loops[k]);
                let lo = c.iter().map(&get).fold(f64::INFINITY, f64::min);
                let d = (((lo - a0) / period).floor()) * -period;
                for q in c.iter_mut() {
                    q.uv = if ax == 0 { (q.uv.0 + d, q.uv.1) } else { (q.uv.0, q.uv.1 + d) };
                }
                contours.push(c);
            }
        }
    }

     
    let (mut u0, mut v0, mut u1, mut v1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for c in &contours {
        for q in c {
            u0 = u0.min(q.uv.0);
            u1 = u1.max(q.uv.0);
            v0 = v0.min(q.uv.1);
            v1 = v1.max(q.uv.1);
        }
    }
    if !(u1 > u0) || !(v1 > v0) {
        return Err("degenerate face".into());
    }
    let (mut su, mut sv) = (0.0, 0.0);
    let mut n = 0.0;
    let (hu, hv) = ((u1 - u0) * 1e-4, (v1 - v0) * 1e-4);
    for i in 0..5 {
        for j in 0..5 {
            let u = u0 + (u1 - u0) * (0.1 + 0.2 * i as f64);
            let v = v0 + (v1 - v0) * (0.1 + 0.2 * j as f64);
            su += norm(sub(s.eval(u + hu, v), s.eval(u - hu, v))) / (2.0 * hu);
            sv += norm(sub(s.eval(u, v + hv), s.eval(u, v - hv))) / (2.0 * hv);
            n += 1.0;
        }
    }
    su = if su / n > 1e-12 { su / n } else { 1.0 };
    sv = if sv / n > 1e-12 { sv / n } else { 1.0 };

     
    let (st_u, st_v) = steps(s, ((u0, v0), (u1, v1)), tol);
    let span_u = u1 - u0;
    let span_v = v1 - v0;
    let mut nu = if st_u.is_finite() { (span_u / st_u).ceil() as usize } else { 1 };
    let mut nv = if st_v.is_finite() { (span_v / st_v).ceil() as usize } else { 1 };
    if st_u.is_finite() && !st_v.is_finite() && !matches!(s, Surface::Plane(_)) {
        nv = ((span_v * sv) / (8.0 * span_u * su / nu.max(1) as f64)).ceil().clamp(1.0, 64.0) as usize;
    }
    if st_v.is_finite() && !st_u.is_finite() && !matches!(s, Surface::Plane(_)) {
        nu = ((span_u * su) / (8.0 * span_v * sv / nv.max(1) as f64)).ceil().clamp(1.0, 64.0) as usize;
    }
    nu = nu.clamp(1, 4000);
    nv = nv.clamp(1, 4000);
    while nu * nv > 60_000 {
        nu = (nu * 3 / 4).max(1);
        nv = (nv * 3 / 4).max(1);
    }

     
    let mut pts: Vec<Uv> = Vec::new();
    let mut xyz: Vec<V3> = Vec::new();
    let mut index: HashMap<(u64, u64), usize> = HashMap::new();
    let mut edges: Vec<(usize, usize)> = Vec::new();
    let mut segs: Vec<(Uv, Uv)> = Vec::new();
    let mut add_pt = |uv: Uv, p: V3, pts: &mut Vec<Uv>, xyz: &mut Vec<V3>| -> usize {
        let sc = (uv.0 * su, uv.1 * sv);
        let key = (((sc.0 * 1e9).round()) as i64 as u64, ((sc.1 * 1e9).round()) as i64 as u64);
        *index.entry(key).or_insert_with(|| {
            pts.push(sc);
            xyz.push(p);
            pts.len() - 1
        })
    };
     
    let row = |k: usize| v0 + span_v * k as f64 / nv as f64;
    let col = |k: usize| u0 + span_u * k as f64 / nu as f64;
    let mut seam_extra: Vec<(f64, f64, Vec<f64>)> = Vec::new();
    if band_axis.is_some() {
        let ax = band_axis.unwrap();
        for (a, o0, o1) in &seams {
            let (lo, hi) = (o0.min(*o1), o0.max(*o1));
            let ks: Vec<f64> = if ax == 0 { (1..nv).map(row).filter(|v| *v > lo && *v < hi).collect() } else { (1..nu).map(col).filter(|u| *u > lo && *u < hi).collect() };
            let ks = if o1 < o0 { ks.into_iter().rev().collect() } else { ks };
            seam_extra.push((*a, *o0, ks));
        }
    }
    for c in &contours {
        let mut ids: Vec<usize> = Vec::with_capacity(c.len());
        for (i, q) in c.iter().enumerate() {
            ids.push(add_pt(q.uv, q.p, &mut pts, &mut xyz));
             
            let next = &c[(i + 1) % c.len()];
            if let Some(ax) = band_axis {
                let a_of = |uv: Uv| if ax == 0 { uv.0 } else { uv.1 };
                let o_of = |uv: Uv| if ax == 0 { uv.1 } else { uv.0 };
                for (a, o0, ks) in &seam_extra {
                    if (a_of(q.uv) - a).abs() < 1e-9 && (a_of(next.uv) - a).abs() < 1e-9 && (o_of(q.uv) - o0).abs() < 1e-9 {
                        for o in ks {
                            let uv = if ax == 0 { (*a, *o) } else { (*o, *a) };
                            ids.push(add_pt(uv, s.eval(uv.0, uv.1), &mut pts, &mut xyz));
                        }
                    }
                }
            }
        }
        ids.dedup();
        if ids.len() > 1 && ids[0] == ids[ids.len() - 1] {
            ids.pop();
        }
        for i in 0..ids.len() {
            let (a, b) = (ids[i], ids[(i + 1) % ids.len()]);
            if a != b {
                edges.push((a, b));
                segs.push((pts[a], pts[b]));
            }
        }
    }
    edges.sort_unstable_by_key(|e| (e.0.min(e.1), e.0.max(e.1)));
    edges.dedup_by_key(|e| (e.0.min(e.1), e.0.max(e.1)));
    let n_boundary = pts.len();
    if n_boundary < 3 || edges.len() < 3 {
        return Err("face boundary has too few points".into());
    }

     
    if nu > 1 || nv > 1 {
        let step_s = ((span_u * su) / nu as f64).min((span_v * sv) / nv as f64);
        let margin = 0.3 * step_s;
        let grid = SegGrid::new(&segs, margin.max(1e-9) * 2.0);
        for j in 1..nv.max(2) {
            if nv == 1 {
                break;
            }
            let v = row(j);
            let y = v * sv;
            let mut xs: Vec<f64> = segs
                .iter()
                .filter_map(|(a, b)| {
                    if (a.1 <= y && b.1 > y) || (b.1 <= y && a.1 > y) {
                        Some(a.0 + (y - a.1) / (b.1 - a.1) * (b.0 - a.0))
                    } else {
                        None
                    }
                })
                .collect();
            xs.sort_by(|a, b| a.total_cmp(b));
            for i in 1..nu.max(2) {
                if nu == 1 {
                    break;
                }
                let u = col(i);
                let x = u * su;
                let inside = xs.iter().filter(|c| **c < x).count() % 2 == 1;
                if inside && !grid.near(&segs, (x, y), margin) {
                    pts.push((x, y));
                    xyz.push(s.eval(u, v));
                }
            }
        }
    }
    let kind = match s {
        Surface::Plane(_) => "plane",
        Surface::Cylinder(..) => "cylinder",
        Surface::Cone(..) => "cone",
        Surface::Sphere(..) => "sphere",
        Surface::Torus(..) => "torus",
        Surface::BSpline(_) => "bspline",
        Surface::Extrusion(..) => "extrusion",
        Surface::Revolution(..) => "revolution",
        Surface::Ruled(..) => "ruled",
    };
    Ok(FaceJob { pts, xyz, edges, n_boundary, flip: !face.sense, instances: vec![(face.xform, face.color, face.part)], kind })
}



fn full_domain(s: &Surface, contours: &mut Vec<Vec<Pt>>, seams: &mut Vec<(f64, f64, f64)>) -> Result<(), String> {
    let pu = s.period_u().ok_or("degenerate face")?;
    let ((_, _), (dv0, dv1)) = s.domain();
    let (mut v0, mut v1) = (dv0, dv1);
    if !v0.is_finite() || !v1.is_finite() {
        if let Some(pv) = s.period_v() {
            v0 = 0.0;
            v1 = pv;
        } else {
            let all: Vec<f64> = contours.iter().flatten().map(|q| q.uv.1).collect();
            v0 = all.iter().copied().fold(f64::INFINITY, f64::min);
            v1 = all.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        }
    }
    if !(v1 > v0) {
        return Err("degenerate face".into());
    }
    let u0 = contours.iter().flatten().map(|q| q.uv.0).fold(f64::INFINITY, f64::min);
    let u0 = if u0.is_finite() { u0 } else { 0.0 };
    let corners = [(u0, v0), (u0 + pu, v0), (u0 + pu, v1), (u0, v1)];
    contours.clear();
    contours.push(corners.iter().map(|uv| Pt { uv: *uv, p: s.eval(uv.0, uv.1) }).collect());
    seams.clear();
    Ok(())
}




pub fn repair(pts: &[(f64, f64)], xyz: &[V3], edges: &[(usize, usize)]) -> (Vec<(f64, f64)>, Vec<V3>, Vec<(usize, usize)>) {
    let mut pts = pts.to_vec();
    let mut xyz = xyz.to_vec();
    let scale = pts.iter().fold(0.0f64, |m, p| m.max(p.0.abs()).max(p.1.abs())).max(1e-9);
    let eps = 1e-9 * scale;
    let mut edges: Vec<(usize, usize)> = edges.to_vec();
    let on_boundary: Vec<usize> = {
        let mut v: Vec<usize> = edges.iter().flat_map(|e| [e.0, e.1]).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    for _round in 0..3 {
         
        let mut splits: Vec<Vec<(f64, usize)>> = vec![Vec::new(); edges.len()];
        let seg = |pts: &Vec<(f64, f64)>, e: (usize, usize)| (pts[e.0], pts[e.1]);
        for (k, e) in edges.iter().enumerate() {
            let (a, b) = seg(&pts, *e);
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let l2 = dx * dx + dy * dy;
            if l2 <= 0.0 {
                continue;
            }
            for &q in &on_boundary {
                if q == e.0 || q == e.1 {
                    continue;
                }
                let p = pts[q];
                let t = ((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2;
                if t <= 1e-12 || t >= 1.0 - 1e-12 {
                    continue;
                }
                let (cx, cy) = (a.0 + t * dx - p.0, a.1 + t * dy - p.1);
                if (cx * cx + cy * cy).sqrt() < eps * 10.0 {
                    splits[k].push((t, q));
                }
            }
        }
        let n_edges = edges.len();
        for i in 0..n_edges {
            for j in (i + 1)..n_edges {
                let (e, f) = (edges[i], edges[j]);
                if e.0 == f.0 || e.0 == f.1 || e.1 == f.0 || e.1 == f.1 {
                    continue;
                }
                let (a, b) = seg(&pts, e);
                let (c, d) = seg(&pts, f);
                let r = (b.0 - a.0, b.1 - a.1);
                let q = (d.0 - c.0, d.1 - c.1);
                let den = r.0 * q.1 - r.1 * q.0;
                if den.abs() < 1e-300 {
                    continue;
                }
                let t = ((c.0 - a.0) * q.1 - (c.1 - a.1) * q.0) / den;
                let u = ((c.0 - a.0) * r.1 - (c.1 - a.1) * r.0) / den;
                if t > 1e-12 && t < 1.0 - 1e-12 && u > 1e-12 && u < 1.0 - 1e-12 {
                    let x = (a.0 + t * r.0, a.1 + t * r.1);
                    let p3 = lerp(lerp(xyz[e.0], xyz[e.1], t), lerp(xyz[f.0], xyz[f.1], u), 0.5);
                    pts.push(x);
                    xyz.push(p3);
                    let id = pts.len() - 1;
                    splits[i].push((t, id));
                    splits[j].push((u, id));
                }
            }
        }
        if splits.iter().all(|v| v.is_empty()) {
            break;
        }
        let mut next = Vec::with_capacity(edges.len() * 2);
        for (k, e) in edges.iter().enumerate() {
            let mut v = std::mem::take(&mut splits[k]);
            v.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut prev = e.0;
            for (_, id) in v {
                if id != prev {
                    next.push((prev, id));
                    prev = id;
                }
            }
            if prev != e.1 {
                next.push((prev, e.1));
            }
        }
        next.sort_unstable_by_key(|e| (e.0.min(e.1), e.0.max(e.1)));
        next.dedup_by_key(|e| (e.0.min(e.1), e.0.max(e.1)));
        edges = next;
    }
    (pts, xyz, edges)
}




pub fn triangulate(pts: &[(f64, f64)], edges: &[(usize, usize)], flip: bool, variant: u32) -> Result<Vec<[usize; 3]>, String> {
    if pts.iter().any(|p| !p.0.is_finite() || !p.1.is_finite()) {
        return Err("invalid point".into());
    }
    let rotated: Vec<(f64, f64)>;
    let pts = if variant == 0 {
        pts
    } else {
        let (s, c) = (0.731 * variant as f64).sin_cos();
        rotated = pts.iter().map(|p| (c * p.0 - s * p.1, s * p.0 + c * p.1)).collect();
        &rotated[..]
    };
    let tris = cdt::triangulate_with_edges(pts, edges).map_err(|e| format!("{e}"))?;
    let mut out = Vec::with_capacity(tris.len());
    for (a, b, c) in tris {
        let (pa, pb, pc) = (pts[a], pts[b], pts[c]);
        let area = (pb.0 - pa.0) * (pc.1 - pa.1) - (pc.0 - pa.0) * (pb.1 - pa.1);
         
        if (area > 0.0) == flip {
            out.push([a, c, b]);
        } else {
            out.push([a, b, c]);
        }
    }
    Ok(out)
}
