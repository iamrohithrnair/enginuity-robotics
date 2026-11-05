// Evaluates analytic curves and surfaces within CAD import tolerances.


use crate::math::*;
use crate::nurbs::{BCurve, BSurf};
use std::f64::consts::{PI, TAU};

#[derive(Clone, Debug)]
pub enum Curve {
    
    Line { p: V3, d: V3 },
    
    Circle { f: Frame, r: f64 },
    
    Ellipse { f: Frame, a: f64, b: f64 },
    BSpline(BCurve),
    
    Poly(Vec<V3>),
}


#[derive(Clone, Copy, Debug)]
pub struct Tol {
    pub lin: f64,
    pub ang: f64,
}






#[derive(Clone, Copy, Debug)]
pub struct Accuracy {
    pub edge: Tol,
    pub face: Tol,
}

impl Accuracy {
    pub fn standard(linear_mm: f64) -> Accuracy {
        let s = 0.5 * linear_mm;
        Accuracy { edge: Tol { lin: s, ang: 0.5 }, face: Tol { lin: s, ang: f64::INFINITY } }
    }

    
    pub fn in_units(&self, unit: f64) -> Accuracy {
        Accuracy { edge: Tol { lin: self.edge.lin / unit, ang: self.edge.ang }, face: Tol { lin: self.face.lin / unit, ang: self.face.ang } }
    }
}

impl Tol {
    
    
    pub fn arc_step(&self, r: f64) -> f64 {
        let r = r.abs();
        let by_lin = if r > self.lin { 2.0 * (1.0 - self.lin / r).acos() } else { PI / 2.0 };
        by_lin.min(self.ang).max(1e-3)
    }
}

impl Curve {
    pub fn eval(&self, t: f64) -> V3 {
        match self {
            Curve::Line { p, d } => add(*p, scale(*d, t)),
            Curve::Circle { f, r } => f.to_world([r * t.cos(), r * t.sin(), 0.0]),
            Curve::Ellipse { f, a, b } => f.to_world([a * t.cos(), b * t.sin(), 0.0]),
            Curve::BSpline(c) => c.eval(t),
            Curve::Poly(v) => {
                if v.is_empty() {
                    return [0.0; 3];
                }
                let n = v.len() - 1;
                let t = t.clamp(0.0, n as f64);
                let i = (t.floor() as usize).min(n.saturating_sub(1));
                if n == 0 {
                    return v[0];
                }
                lerp(v[i], v[i + 1], t - i as f64)
            }
        }
    }

    pub fn period(&self) -> Option<f64> {
        match self {
            Curve::Circle { .. } | Curve::Ellipse { .. } => Some(TAU),
            _ => None,
        }
    }

    pub fn domain(&self) -> (f64, f64) {
        match self {
            Curve::Line { .. } => (f64::NEG_INFINITY, f64::INFINITY),
            Curve::Circle { .. } | Curve::Ellipse { .. } => (0.0, TAU),
            Curve::BSpline(c) => c.domain(),
            Curve::Poly(v) => (0.0, v.len().saturating_sub(1) as f64),
        }
    }

    
    pub fn closed(&self) -> bool {
        match self {
            Curve::Circle { .. } | Curve::Ellipse { .. } => true,
            Curve::Line { .. } => false,
            _ => {
                let (a, b) = self.domain();
                let s = dist(self.eval(a), self.eval(b));
                let len = dist(self.eval(a), self.eval((a + b) / 2.0)) + 1e-9;
                s < 1e-7 * len.max(1.0)
            }
        }
    }

    
    pub fn param_of(&self, p: V3) -> f64 {
        match self {
            Curve::Line { p: o, d } => {
                let dd = dot(*d, *d);
                if dd > 0.0 {
                    dot(sub(p, *o), *d) / dd
                } else {
                    0.0
                }
            }
            Curve::Circle { f, .. } => {
                let l = f.to_local(p);
                let t = l[1].atan2(l[0]);
                if t < 0.0 {
                    t + TAU
                } else {
                    t
                }
            }
            Curve::Ellipse { f, a, b } => {
                let l = f.to_local(p);
                let t0 = (l[1] / b).atan2(l[0] / a);
                let t0 = if t0 < 0.0 { t0 + TAU } else { t0 };
                self.newton1(p, t0, (0.0, TAU), true)
            }
            Curve::BSpline(c) => {
                let (a, b) = c.domain();
                let n = (c.spans() * 8).clamp(16, 2000);
                let mut best = (f64::INFINITY, a);
                for i in 0..=n {
                    let t = a + (b - a) * i as f64 / n as f64;
                    let d = dist(c.eval(t), p);
                    if d < best.0 {
                        best = (d, t);
                    }
                }
                self.newton1(p, best.1, (a, b), false)
            }
            Curve::Poly(v) => {
                let mut best = (f64::INFINITY, 0.0);
                for i in 0..v.len().saturating_sub(1) {
                    let (a, b) = (v[i], v[i + 1]);
                    let ab = sub(b, a);
                    let l2 = dot(ab, ab);
                    let s = if l2 > 0.0 { (dot(sub(p, a), ab) / l2).clamp(0.0, 1.0) } else { 0.0 };
                    let d = dist(lerp(a, b, s), p);
                    if d < best.0 {
                        best = (d, i as f64 + s);
                    }
                }
                best.1
            }
        }
    }

    
    fn newton1(&self, p: V3, t0: f64, dom: (f64, f64), periodic: bool) -> f64 {
        let mut t = t0;
        let h = (dom.1 - dom.0).abs().max(1e-9) * 1e-6;
        for _ in 0..30 {
            let c = self.eval(t);
            let d1 = scale(sub(self.eval(t + h), self.eval(t - h)), 0.5 / h);
            let d2 = scale(add(sub(self.eval(t + h), scale(c, 2.0)), self.eval(t - h)), 1.0 / (h * h));
            let f = sub(c, p);
            let g = dot(f, d1);
            let hess = dot(d1, d1) + dot(f, d2);
            if hess.abs() < 1e-300 {
                break;
            }
            let step = -g / hess;
            let mut nt = t + step;
            if !periodic {
                nt = nt.clamp(dom.0, dom.1);
            }
            if (nt - t).abs() < 1e-12 * (1.0 + t.abs()) {
                t = nt;
                break;
            }
            t = nt;
        }
        t
    }

    
    pub fn sample(&self, t0: f64, t1: f64, tol: Tol) -> Vec<V3> {
        match self {
            Curve::Line { .. } => vec![self.eval(t0), self.eval(t1)],
            Curve::Circle { r, .. } => {
                 
                let n = (((t1 - t0).abs() / tol.arc_step(*r)).ceil() as usize).clamp(2, 100_000);
                (0..=n).map(|i| self.eval(t0 + (t1 - t0) * i as f64 / n as f64)).collect()
            }
            Curve::Ellipse { a, b, .. } => {
                 
                let rmin = (a.min(*b)).powi(2) / a.max(*b);
                let n = (((t1 - t0).abs() / tol.arc_step(rmin.max(1e-9))).ceil() as usize).clamp(2, 100_000);
                (0..=n).map(|i| self.eval(t0 + (t1 - t0) * i as f64 / n as f64)).collect()
            }
            Curve::Poly(v) => {
                let (a, b) = (t0.min(t1), t0.max(t1));
                let mut out = vec![self.eval(t0)];
                let mut ks: Vec<f64> = (0..v.len()).map(|i| i as f64).filter(|k| *k > a + 1e-9 && *k < b - 1e-9).collect();
                if t1 < t0 {
                    ks.reverse();
                }
                out.extend(ks.into_iter().map(|k| self.eval(k)));
                out.push(self.eval(t1));
                out
            }
            Curve::BSpline(c) => {
                let (a, b) = c.domain();
                let frac = ((t1 - t0).abs() / (b - a).max(1e-300)).min(1.0);
                let n0 = ((c.spans() as f64 * frac * (c.p as f64 + 1.0)).ceil() as usize).clamp(2, 4000);
                adaptive(|t| self.eval(t), t0, t1, n0, tol)
            }
        }
    }
}



pub fn adaptive(f: impl Fn(f64) -> V3, t0: f64, t1: f64, n0: usize, tol: Tol) -> Vec<V3> {
    adaptive_t(&f, t0, t1, n0, tol).into_iter().map(|(_, p)| p).collect()
}


pub fn adaptive_t(f: &impl Fn(f64) -> V3, t0: f64, t1: f64, n0: usize, tol: Tol) -> Vec<(f64, V3)> {
    let mut out = Vec::with_capacity(n0 * 2 + 1);
    let mut prev_t = t0;
    let mut prev = f(t0);
    out.push((t0, prev));
    for i in 1..=n0 {
        let t = t0 + (t1 - t0) * i as f64 / n0 as f64;
        let q = f(t);
        refine(f, prev_t, prev, t, q, tol, 0, &mut out);
        prev_t = t;
        prev = q;
    }
    out
}

fn refine(f: &impl Fn(f64) -> V3, ta: f64, a: V3, tb: f64, b: V3, tol: Tol, depth: u32, out: &mut Vec<(f64, V3)>) {
    if depth < 16 {
        let tm = 0.5 * (ta + tb);
        let m = f(tm);
        let chord = sub(b, a);
        let l2 = dot(chord, chord);
        let dev = if l2 > 0.0 {
            let s = (dot(sub(m, a), chord) / l2).clamp(0.0, 1.0);
            dist(m, add(a, scale(chord, s)))
        } else {
            dist(m, a)
        };
        let turn = match (normalize(sub(m, a)), normalize(sub(b, m))) {
            (Some(u), Some(v)) => dot(u, v).clamp(-1.0, 1.0).acos(),
            _ => 0.0,
        };
        if dev > tol.lin || (turn > tol.ang && l2.sqrt() > tol.lin * 1e-3) {
            refine(f, ta, a, tm, m, tol, depth + 1, out);
            refine(f, tm, m, tb, b, tol, depth + 1, out);
            return;
        }
    }
    out.push((tb, b));
}

fn xf_frame(f: &Frame, x: &Xform) -> Frame {
    let lin = |v: V3| sub(x.apply(v), x.apply([0.0; 3]));
    let o = x.apply(f.o);
    let z = normalize(lin(f.z)).unwrap_or(f.z);
    let xa = normalize(lin(f.x)).unwrap_or(f.x);
    Frame::from_axes(o, Some(z), Some(xa))
}

impl Curve {
    
    pub fn transform(&mut self, x: &Xform) {
        let lin = |v: V3| sub(x.apply(v), x.apply([0.0; 3]));
        match self {
            Curve::Line { p, d } => {
                *p = x.apply(*p);
                *d = lin(*d);
            }
            Curve::Circle { f, .. } | Curve::Ellipse { f, .. } => *f = xf_frame(f, x),
            Curve::BSpline(c) => c.transform(|q| x.apply(q)),
            Curve::Poly(v) => v.iter_mut().for_each(|q| *q = x.apply(*q)),
        }
    }
}

impl Surface {
    pub fn transform(&mut self, x: &Xform) {
        let lin = |v: V3| sub(x.apply(v), x.apply([0.0; 3]));
        match self {
            Surface::Plane(f) | Surface::Cylinder(f, _) | Surface::Cone(f, _, _) | Surface::Sphere(f, _) | Surface::Torus(f, _, _) => *f = xf_frame(f, x),
            Surface::BSpline(s) => s.transform(|q| x.apply(q)),
            Surface::Extrusion(c, d) => {
                c.transform(x);
                *d = lin(*d);
            }
            Surface::Revolution(c, o, a) => {
                c.transform(x);
                *o = x.apply(*o);
                *a = normalize(lin(*a)).unwrap_or(*a);
            }
            Surface::Ruled(c1, c2) => {
                c1.transform(x);
                c2.transform(x);
            }
        }
    }
}

#[derive(Clone, Debug)]
pub enum Surface {
    
    Plane(Frame),
    
    Cylinder(Frame, f64),
    
    Cone(Frame, f64, f64),
    
    Sphere(Frame, f64),
    
    Torus(Frame, f64, f64),
    BSpline(BSurf),
    
    Extrusion(Curve, V3),
    
    Revolution(Curve, V3, V3),
    
    Ruled(Curve, Curve),
}

fn rotate_about(p: V3, o: V3, a: V3, ang: f64) -> V3 {
    let q = sub(p, o);
    let (s, c) = ang.sin_cos();
    let r = add(add(scale(q, c), scale(cross(a, q), s)), scale(a, dot(a, q) * (1.0 - c)));
    add(o, r)
}

fn curve01(c: &Curve, t: f64) -> V3 {
    let (a, b) = c.domain();
    let (a, b) = if a.is_finite() && b.is_finite() { (a, b) } else { (0.0, 1.0) };
    c.eval(a + (b - a) * t)
}

impl Surface {
    pub fn eval(&self, u: f64, v: f64) -> V3 {
        match self {
            Surface::Plane(f) => f.to_world([u, v, 0.0]),
            Surface::Cylinder(f, r) => f.to_world([r * u.cos(), r * u.sin(), v]),
            Surface::Cone(f, r, a) => {
                let rr = r + v * a.tan();
                f.to_world([rr * u.cos(), rr * u.sin(), v])
            }
            Surface::Sphere(f, r) => f.to_world([r * v.cos() * u.cos(), r * v.cos() * u.sin(), r * v.sin()]),
            Surface::Torus(f, big, r) => {
                let rr = big + r * v.cos();
                f.to_world([rr * u.cos(), rr * u.sin(), r * v.sin()])
            }
            Surface::BSpline(s) => s.eval(u, v),
            Surface::Extrusion(c, d) => add(c.eval(u), scale(*d, v)),
            Surface::Revolution(c, o, a) => rotate_about(c.eval(v), *o, *a, u),
            Surface::Ruled(c1, c2) => lerp(curve01(c1, u), curve01(c2, u), v),
        }
    }

    pub fn period_u(&self) -> Option<f64> {
        match self {
            Surface::Cylinder(..) | Surface::Cone(..) | Surface::Sphere(..) | Surface::Torus(..) | Surface::Revolution(..) => Some(TAU),
            Surface::BSpline(s) => {
                let ((u0, u1), (v0, v1)) = s.domain();
                let closed = (0..=8).all(|k| {
                    let v = v0 + (v1 - v0) * k as f64 / 8.0;
                    dist(s.eval(u0, v), s.eval(u1, v)) < 1e-7 * (1.0 + norm(s.eval(u0, v)))
                });
                closed.then_some(u1 - u0)
            }
            Surface::Extrusion(c, _) if c.period().is_some() => c.period(),
            _ => None,
        }
    }

    pub fn period_v(&self) -> Option<f64> {
        match self {
            Surface::Torus(..) => Some(TAU),
            Surface::BSpline(s) => {
                let ((u0, u1), (v0, v1)) = s.domain();
                let closed = (0..=8).all(|k| {
                    let u = u0 + (u1 - u0) * k as f64 / 8.0;
                    dist(s.eval(u, v0), s.eval(u, v1)) < 1e-7 * (1.0 + norm(s.eval(u, v0)))
                });
                closed.then_some(v1 - v0)
            }
            Surface::Revolution(c, ..) if c.period().is_some() => c.period(),
            _ => None,
        }
    }

    
    pub fn domain(&self) -> ((f64, f64), (f64, f64)) {
        let inf = (f64::NEG_INFINITY, f64::INFINITY);
        match self {
            Surface::Plane(_) => (inf, inf),
            Surface::Cylinder(..) | Surface::Cone(..) => ((f64::NEG_INFINITY, f64::INFINITY), inf),
            Surface::Sphere(..) => (inf, (-PI / 2.0, PI / 2.0)),
            Surface::Torus(..) => (inf, inf),
            Surface::BSpline(s) => s.domain(),
            Surface::Extrusion(c, _) => (c.domain(), inf),
            Surface::Revolution(c, ..) => (inf, c.domain()),
            Surface::Ruled(..) => ((0.0, 1.0), (0.0, 1.0)),
        }
    }

    
    pub fn poles_v(&self) -> Vec<f64> {
        match self {
            Surface::Sphere(..) => vec![-PI / 2.0, PI / 2.0],
            Surface::Cone(_, r, a) if a.tan().abs() > 1e-12 => vec![-r / a.tan()],
            _ => vec![],
        }
    }

    
    pub fn project(&self, p: V3, hint: Option<(f64, f64)>) -> (f64, f64) {
        match self {
            Surface::Plane(f) => {
                let l = f.to_local(p);
                (l[0], l[1])
            }
            Surface::Cylinder(f, _) => {
                let l = f.to_local(p);
                (angle_or(l[1], l[0], hint.map(|h| h.0)), l[2])
            }
            Surface::Cone(f, r, a) => {
                let l = f.to_local(p);
                 
                let rad = (l[0] * l[0] + l[1] * l[1]).sqrt();
                let (ca, sa) = (a.cos(), a.sin());
                 
                let s = (rad - r) * sa + l[2] * ca;
                (angle_or(l[1], l[0], hint.map(|h| h.0)), s * ca)
            }
            Surface::Sphere(f, _) => {
                let l = f.to_local(p);
                let rxy = (l[0] * l[0] + l[1] * l[1]).sqrt();
                (angle_or(l[1], l[0], hint.map(|h| h.0)), l[2].atan2(rxy))
            }
            Surface::Torus(f, big, _) => {
                let l = f.to_local(p);
                let rxy = (l[0] * l[0] + l[1] * l[1]).sqrt();
                let v = l[2].atan2(rxy - big);
                (angle_or(l[1], l[0], hint.map(|h| h.0)), v)
            }
            _ => self.project_numeric(p, hint),
        }
    }

    fn project_numeric(&self, p: V3, hint: Option<(f64, f64)>) -> (f64, f64) {
        let ((u0, u1), (v0, v1)) = self.domain();
        if let Some(h) = hint {
            let (u, v, d) = self.newton(p, h.0, h.1);
            if d < 1e-4 * (1.0 + norm(p)) {
                return (u, v);
            }
        }
         
        let start = match self {
            Surface::Extrusion(c, d) => {
                let (a, b) = c.domain();
                let dd = dot(*d, *d).max(1e-300);
                let n = 64;
                let mut best = (f64::INFINITY, a, 0.0);
                for i in 0..=n {
                    let u = a + (b - a) * i as f64 / n as f64;
                    let q = c.eval(u);
                    let v = dot(sub(p, q), *d) / dd;
                    let e = dist(add(q, scale(*d, v)), p);
                    if e < best.0 {
                        best = (e, u, v);
                    }
                }
                (best.1, best.2)
            }
            Surface::Revolution(c, o, a) => {
                let (va, vb) = c.domain();
                let n = 64;
                let mut best = (f64::INFINITY, 0.0, va);
                let pl = sub(p, *o);
                let rp = sub(pl, scale(*a, dot(pl, *a)));
                for i in 0..=n {
                    let v = va + (vb - va) * i as f64 / n as f64;
                    let ql = sub(c.eval(v), *o);
                    let rq = sub(ql, scale(*a, dot(ql, *a)));
                    let ang = dot(cross(rq, rp), *a).atan2(dot(rq, rp));
                    let e = dist(rotate_about(c.eval(v), *o, *a, ang), p);
                    if e < best.0 {
                        best = (e, ang, v);
                    }
                }
                (best.1, best.2)
            }
            _ => {
                let (nu, nv) = match self {
                    Surface::BSpline(s) => {
                        let (a, b) = s.spans();
                        ((a * 4).clamp(8, 64), (b * 4).clamp(8, 64))
                    }
                    _ => (24, 24),
                };
                let mut best = (f64::INFINITY, u0, v0);
                for i in 0..=nu {
                    for j in 0..=nv {
                        let u = u0 + (u1 - u0) * i as f64 / nu as f64;
                        let v = v0 + (v1 - v0) * j as f64 / nv as f64;
                        let e = dist(self.eval(u, v), p);
                        if e < best.0 {
                            best = (e, u, v);
                        }
                    }
                }
                (best.1, best.2)
            }
        };
        let (u, v, _) = self.newton(p, start.0, start.1);
        (u, v)
    }

    
    fn newton(&self, p: V3, mut u: f64, mut v: f64) -> (f64, f64, f64) {
        let ((u0, u1), (v0, v1)) = self.domain();
        let pu = self.period_u().is_some();
        let pv = self.period_v().is_some();
        let hu = if u1.is_finite() && u0.is_finite() { (u1 - u0) * 1e-6 } else { 1e-6 * (1.0 + u.abs()) };
        let hv = if v1.is_finite() && v0.is_finite() { (v1 - v0) * 1e-6 } else { 1e-6 * (1.0 + v.abs()) };
        let clamp = |x: f64, a: f64, b: f64, periodic: bool| if periodic || !a.is_finite() || !b.is_finite() { x } else { x.clamp(a, b) };
        let mut d = dist(self.eval(u, v), p);
        for _ in 0..40 {
            let s = self.eval(u, v);
            let f = sub(s, p);
            let su = scale(sub(self.eval(u + hu, v), self.eval(u - hu, v)), 0.5 / hu);
            let sv = scale(sub(self.eval(u, v + hv), self.eval(u, v - hv)), 0.5 / hv);
            let (a, b, c) = (dot(su, su), dot(su, sv), dot(sv, sv));
            let (r1, r2) = (-dot(su, f), -dot(sv, f));
            let det = a * c - b * b;
            if det.abs() < 1e-300 {
                break;
            }
            let du = (r1 * c - r2 * b) / det;
            let dv = (a * r2 - b * r1) / det;
             
            let mut k = 1.0;
            let mut moved = false;
            for _ in 0..8 {
                let nu = clamp(u + k * du, u0, u1, pu);
                let nv = clamp(v + k * dv, v0, v1, pv);
                let nd = dist(self.eval(nu, nv), p);
                if nd <= d {
                    moved = (nu - u).abs() > 1e-14 * (1.0 + u.abs()) || (nv - v).abs() > 1e-14 * (1.0 + v.abs());
                    u = nu;
                    v = nv;
                    d = nd;
                    break;
                }
                k *= 0.5;
            }
            if !moved {
                break;
            }
        }
        (u, v, d)
    }
}


fn angle_or(y: f64, x: f64, prev: Option<f64>) -> f64 {
    if (x * x + y * y).sqrt() < 1e-9 {
        return prev.unwrap_or(0.0);
    }
    let a = y.atan2(x);
    if a < 0.0 {
        a + TAU
    } else {
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analytic_projection_round_trips() {
        let f = Frame::from_axes([1.0, 2.0, 3.0], Some([0.0, 1.0, 1.0]), Some([1.0, 0.0, 0.0]));
        let surfs = [Surface::Cylinder(f, 5.0), Surface::Cone(f, 5.0, 0.3), Surface::Sphere(f, 7.0), Surface::Torus(f, 20.0, 4.0)];
        for s in &surfs {
            for (u, v) in [(0.3, 0.2), (2.0, -0.7), (5.5, 1.1)] {
                let p = s.eval(u, v);
                let (pu, pv) = s.project(p, None);
                assert!(dist(s.eval(pu, pv), p) < 1e-9, "{s:?} {u} {v}");
            }
        }
    }

    #[test]
    fn circle_sampling_respects_tolerances() {
        let c = Curve::Circle { f: Frame::IDENTITY, r: 100.0 };
        let pts = c.sample(0.0, TAU, Tol { lin: 1.0, ang: 1f64.to_radians() });
        assert_eq!(pts.len(), 361);
        let pts = c.sample(0.0, TAU, Tol { lin: 1.0, ang: 1.0 });
         
        assert_eq!(pts.len(), 24);
    }
}
