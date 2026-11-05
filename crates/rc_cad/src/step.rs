// Resolves STEP entity graphs into tessellatable faces.



use crate::geom::{Accuracy, Curve, Surface, Tol};
use crate::math::*;
use crate::nurbs::{expand_knots, BCurve, BSurf};
use crate::p21::{File, Val};
use crate::tess::{FaceIn, Rgba};
use std::collections::{BTreeMap, HashMap, HashSet};

pub struct Model {
    pub faces: Vec<FaceIn>,
    
    pub skipped: BTreeMap<String, usize>,
    pub bad_instances: usize,
    
    pub parts: Vec<String>,
}

struct Ctx<'a> {
    f: &'a File,
    
    angle: f64,
    edges: HashMap<u32, Option<Vec<V3>>>,
    skipped: BTreeMap<String, usize>,
    tol: Tol,
}

fn arg<'a>(a: &'a [Val], i: usize) -> Option<&'a Val> {
    a.get(i)
}

impl<'a> Ctx<'a> {
    fn skip(&mut self, what: &str) {
        *self.skipped.entry(what.to_string()).or_default() += 1;
    }

    fn point(&self, id: u32) -> Option<V3> {
        let (k, a) = self.f.simple(id)?;
        if k != "CARTESIAN_POINT" {
            return None;
        }
        let c = arg(a, 1)?.nums()?;
        Some([*c.first()?, *c.get(1).unwrap_or(&0.0), *c.get(2).unwrap_or(&0.0)])
    }

    fn direction(&self, id: u32) -> Option<V3> {
        let (k, a) = self.f.simple(id)?;
        if k != "DIRECTION" {
            return None;
        }
        let c = arg(a, 1)?.nums()?;
        Some([*c.first()?, *c.get(1).unwrap_or(&0.0), *c.get(2).unwrap_or(&0.0)])
    }

    fn vector(&self, id: u32) -> Option<V3> {
        let (k, a) = self.f.simple(id)?;
        match k {
            "VECTOR" => {
                let d = normalize(self.direction(arg(a, 1)?.rf()?)?)?;
                Some(scale(d, arg(a, 2)?.num()?))
            }
            "DIRECTION" => self.direction(id),
            _ => None,
        }
    }

    fn placement(&self, id: u32) -> Option<Frame> {
        let (k, a) = self.f.simple(id)?;
        match k {
            "AXIS2_PLACEMENT_3D" => {
                let o = self.point(arg(a, 1)?.rf()?)?;
                let z = arg(a, 2).and_then(|v| v.rf()).and_then(|r| self.direction(r));
                let x = arg(a, 3).and_then(|v| v.rf()).and_then(|r| self.direction(r));
                Some(Frame::from_axes(o, z, x))
            }
            "AXIS2_PLACEMENT_2D" => {
                let o = self.point(arg(a, 1)?.rf()?)?;
                let x = arg(a, 2).and_then(|v| v.rf()).and_then(|r| self.direction(r));
                Some(Frame::from_axes(o, Some([0.0, 0.0, 1.0]), x))
            }
            _ => None,
        }
    }

    fn axis1(&self, id: u32) -> Option<(V3, V3)> {
        let (k, a) = self.f.simple(id)?;
        if k != "AXIS1_PLACEMENT" {
            return None;
        }
        let o = self.point(arg(a, 1)?.rf()?)?;
        let d = arg(a, 2).and_then(|v| v.rf()).and_then(|r| self.direction(r)).unwrap_or([0.0, 0.0, 1.0]);
        Some((o, normalize(d)?))
    }

    fn points(&self, v: &Val) -> Option<Vec<V3>> {
        v.refs().into_iter().map(|r| self.point(r)).collect()
    }

    
    fn knots_for(kind: &str, p: usize, n: usize) -> Option<Vec<f64>> {
        match kind {
            "BEZIER" => {
                 
                if n < p + 1 || (n - 1) % p != 0 {
                    return None;
                }
                let segs = (n - 1) / p;
                let mut k = vec![0.0; p + 1];
                for s in 1..segs {
                    k.extend(std::iter::repeat(s as f64).take(p));
                }
                k.extend(std::iter::repeat(segs as f64).take(p + 1));
                Some(k)
            }
            "UNIFORM" => Some((0..n + p + 1).map(|i| i as f64 - p as f64).collect()),
            "QUASI_UNIFORM" => {
                let inner = n.checked_sub(p + 1)?;
                let mut k = vec![0.0; p + 1];
                for i in 1..=inner {
                    k.push(i as f64);
                }
                k.extend(std::iter::repeat((inner + 1) as f64).take(p + 1));
                Some(k)
            }
            _ => None,
        }
    }

    fn bspline_curve(&self, id: u32) -> Option<BCurve> {
        let f = self.f;
        let (p, pts, knots, weights) = if let Some(a) = f.part(id, "B_SPLINE_CURVE_WITH_KNOTS").filter(|a| a.len() >= 9) {
             
            let p = arg(a, 1)?.num()? as usize;
            let pts = self.points(arg(a, 2)?)?;
            let m: Vec<usize> = arg(a, 6)?.nums()?.into_iter().map(|v| v as usize).collect();
            (p, pts, expand_knots(&arg(a, 7)?.nums()?, &m), None)
        } else if let Some(b) = f.part(id, "B_SPLINE_CURVE") {
             
            let p = arg(b, 0)?.num()? as usize;
            let pts = self.points(arg(b, 1)?)?;
            let knots = if let Some(k) = f.part(id, "B_SPLINE_CURVE_WITH_KNOTS") {
                let m: Vec<usize> = arg(k, 0)?.nums()?.into_iter().map(|v| v as usize).collect();
                expand_knots(&arg(k, 1)?.nums()?, &m)
            } else if f.has(id, "BEZIER_CURVE") {
                Self::knots_for("BEZIER", p, pts.len())?
            } else if f.has(id, "UNIFORM_CURVE") {
                Self::knots_for("UNIFORM", p, pts.len())?
            } else if f.has(id, "QUASI_UNIFORM_CURVE") {
                Self::knots_for("QUASI_UNIFORM", p, pts.len())?
            } else {
                return None;
            };
            let w = f.part(id, "RATIONAL_B_SPLINE_CURVE").and_then(|r| arg(r, 0)?.nums());
            (p, pts, knots, w)
        } else {
            let (k, a) = f.simple(id)?;
            let kind = k.strip_suffix("_CURVE")?;
            let p = arg(a, 1)?.num()? as usize;
            let pts = self.points(arg(a, 2)?)?;
            (p, pts.clone(), Self::knots_for(kind, p, pts.len())?, None)
        };
        BCurve::new(p, knots, &pts, weights.as_deref())
    }

    fn curve(&mut self, id: u32, depth: u32) -> Option<Curve> {
        if depth > 8 {
            return None;
        }
        let f = self.f;
        if f.has(id, "B_SPLINE_CURVE") || f.has(id, "B_SPLINE_CURVE_WITH_KNOTS") {
            return self.bspline_curve(id).map(Curve::BSpline);
        }
        let (k, a) = f.simple(id)?;
        match k {
            "LINE" => {
                let p = self.point(arg(a, 1)?.rf()?)?;
                let d = self.vector(arg(a, 2)?.rf()?)?;
                Some(Curve::Line { p, d })
            }
            "CIRCLE" => Some(Curve::Circle { f: self.placement(arg(a, 1)?.rf()?)?, r: arg(a, 2)?.num()? }),
            "ELLIPSE" => Some(Curve::Ellipse { f: self.placement(arg(a, 1)?.rf()?)?, a: arg(a, 2)?.num()?, b: arg(a, 3)?.num()? }),
            "POLYLINE" => Some(Curve::Poly(self.points(arg(a, 1)?)?)),
            "SURFACE_CURVE" | "SEAM_CURVE" | "INTERSECTION_CURVE" | "BOUNDED_SURFACE_CURVE" => self.curve(arg(a, 1)?.rf()?, depth + 1),
            "TRIMMED_CURVE" => self.curve(arg(a, 1)?.rf()?, depth + 1),
            "BEZIER_CURVE" | "UNIFORM_CURVE" | "QUASI_UNIFORM_CURVE" => self.bspline_curve(id).map(Curve::BSpline),
            _ => {
                self.skip(k);
                None
            }
        }
    }

    fn bspline_surface(&self, id: u32) -> Option<BSurf> {
        let f = self.f;
        let grid = |v: &Val| -> Option<Vec<Vec<V3>>> { v.list()?.iter().map(|row| self.points(row)).collect() };
        let wgrid = |v: &Val| -> Option<Vec<Vec<f64>>> { v.list()?.iter().map(|row| row.nums()).collect() };
        let (pu, pv, pts, ku, kv, w) = if let Some(a) = f.part(id, "B_SPLINE_SURFACE_WITH_KNOTS").filter(|a| a.len() >= 13) {
            let pu = arg(a, 1)?.num()? as usize;
            let pv = arg(a, 2)?.num()? as usize;
            let pts = grid(arg(a, 3)?)?;
            let mu: Vec<usize> = arg(a, 8)?.nums()?.into_iter().map(|v| v as usize).collect();
            let mv: Vec<usize> = arg(a, 9)?.nums()?.into_iter().map(|v| v as usize).collect();
            (pu, pv, pts, expand_knots(&arg(a, 10)?.nums()?, &mu), expand_knots(&arg(a, 11)?.nums()?, &mv), None)
        } else if let Some(b) = f.part(id, "B_SPLINE_SURFACE") {
            let pu = arg(b, 0)?.num()? as usize;
            let pv = arg(b, 1)?.num()? as usize;
            let pts = grid(arg(b, 2)?)?;
            let (nu, nv) = (pts.len(), pts.first()?.len());
            let (ku, kv) = if let Some(k) = f.part(id, "B_SPLINE_SURFACE_WITH_KNOTS") {
                let mu: Vec<usize> = arg(k, 0)?.nums()?.into_iter().map(|v| v as usize).collect();
                let mv: Vec<usize> = arg(k, 1)?.nums()?.into_iter().map(|v| v as usize).collect();
                (expand_knots(&arg(k, 2)?.nums()?, &mu), expand_knots(&arg(k, 3)?.nums()?, &mv))
            } else {
                let kind = ["BEZIER", "UNIFORM", "QUASI_UNIFORM"].into_iter().find(|k| f.has(id, &format!("{k}_SURFACE")))?;
                (Self::knots_for(kind, pu, nu)?, Self::knots_for(kind, pv, nv)?)
            };
            let w = f.part(id, "RATIONAL_B_SPLINE_SURFACE").and_then(|r| wgrid(arg(r, 0)?));
            (pu, pv, pts, ku, kv, w)
        } else {
            let (k, a) = f.simple(id)?;
            let kind = k.strip_suffix("_SURFACE")?;
            let pu = arg(a, 1)?.num()? as usize;
            let pv = arg(a, 2)?.num()? as usize;
            let pts = grid(arg(a, 3)?)?;
            let (nu, nv) = (pts.len(), pts.first()?.len());
            (pu, pv, pts.clone(), Self::knots_for(kind, pu, nu)?, Self::knots_for(kind, pv, nv)?, None)
        };
        BSurf::new(pu, pv, ku, kv, &pts, w.as_deref())
    }

    fn surface(&mut self, id: u32, depth: u32) -> Option<Surface> {
        if depth > 8 {
            return None;
        }
        let f = self.f;
        if f.has(id, "B_SPLINE_SURFACE") || f.has(id, "B_SPLINE_SURFACE_WITH_KNOTS") {
            return self.bspline_surface(id).map(Surface::BSpline);
        }
        let (k, a) = f.simple(id)?;
        match k {
            "PLANE" => Some(Surface::Plane(self.placement(arg(a, 1)?.rf()?)?)),
            "CYLINDRICAL_SURFACE" => Some(Surface::Cylinder(self.placement(arg(a, 1)?.rf()?)?, arg(a, 2)?.num()?)),
            "CONICAL_SURFACE" => Some(Surface::Cone(self.placement(arg(a, 1)?.rf()?)?, arg(a, 2)?.num()?, arg(a, 3)?.num()? * self.angle)),
            "SPHERICAL_SURFACE" => Some(Surface::Sphere(self.placement(arg(a, 1)?.rf()?)?, arg(a, 2)?.num()?)),
            "TOROIDAL_SURFACE" | "DEGENERATE_TOROIDAL_SURFACE" => Some(Surface::Torus(self.placement(arg(a, 1)?.rf()?)?, arg(a, 2)?.num()?, arg(a, 3)?.num()?)),
            "SURFACE_OF_LINEAR_EXTRUSION" => {
                let c = self.curve(arg(a, 1)?.rf()?, depth + 1)?;
                Some(Surface::Extrusion(c, self.vector(arg(a, 2)?.rf()?)?))
            }
            "SURFACE_OF_REVOLUTION" => {
                let c = self.curve(arg(a, 1)?.rf()?, depth + 1)?;
                let (o, d) = self.axis1(arg(a, 2)?.rf()?)?;
                Some(Surface::Revolution(c, o, d))
            }
            "RECTANGULAR_TRIMMED_SURFACE" => self.surface(arg(a, 1)?.rf()?, depth + 1),
            "BEZIER_SURFACE" | "UNIFORM_SURFACE" | "QUASI_UNIFORM_SURFACE" => self.bspline_surface(id).map(Surface::BSpline),
            _ => {
                self.skip(k);
                None
            }
        }
    }

    
    fn edge(&mut self, id: u32) -> Option<Vec<V3>> {
        if let Some(e) = self.edges.get(&id) {
            return e.clone();
        }
        let res = self.edge_uncached(id);
        self.edges.insert(id, res.clone());
        res
    }

    fn vertex(&self, id: u32) -> Option<V3> {
        let (k, a) = self.f.simple(id)?;
        if k != "VERTEX_POINT" {
            return None;
        }
        self.point(arg(a, 1)?.rf()?)
    }

    fn edge_uncached(&mut self, id: u32) -> Option<Vec<V3>> {
        let (k, a) = self.f.simple(id)?;
        if k != "EDGE_CURVE" {
            return None;
        }
        let (vs, ve) = (arg(a, 1)?.rf()?, arg(a, 2)?.rf()?);
        let p0 = self.vertex(vs)?;
        let p1 = self.vertex(ve)?;
        let same = arg(a, 4).and_then(|v| v.boolean()).unwrap_or(true);
        let c = self.curve(arg(a, 3)?.rf()?, 0)?;
        let closed = vs == ve || dist(p0, p1) < 1e-9 * (1.0 + norm(p0));
        let (t0, t1) = match c.period() {
            Some(per) => {
                let t0 = c.param_of(p0);
                let mut t1 = c.param_of(p1);
                if same {
                    while t1 <= t0 + 1e-12 {
                        t1 += per;
                    }
                    if !closed && t1 - t0 > per - 1e-12 {
                        t1 -= per;
                    }
                } else {
                    while t1 >= t0 - 1e-12 {
                        t1 -= per;
                    }
                    if !closed && t0 - t1 > per - 1e-12 {
                        t1 += per;
                    }
                }
                (t0, t1)
            }
            None => {
                 
                if closed && (vs == ve || c.closed()) {
                    let (d0, d1) = c.domain();
                    if same {
                        (d0, d1)
                    } else {
                        (d1, d0)
                    }
                } else {
                    (c.param_of(p0), c.param_of(p1))
                }
            }
        };
        let mut pts = c.sample(t0, t1, self.tol);
        if pts.len() < 2 {
            return None;
        }
        let n = pts.len();
        pts[0] = p0;
        pts[n - 1] = p1;
        Some(pts)
    }

    
    fn loop_points(&mut self, id: u32) -> Option<Vec<V3>> {
        let (k, a) = self.f.simple(id)?;
        match k {
            "EDGE_LOOP" => {
                let mut out: Vec<V3> = Vec::new();
                for oe in arg(a, 1)?.refs() {
                    let (k2, b) = self.f.simple(oe)?;
                    let (edge, orient) = match k2 {
                        "ORIENTED_EDGE" => (arg(b, 3)?.rf()?, arg(b, 4).and_then(|v| v.boolean()).unwrap_or(true)),
                        "EDGE_CURVE" => (oe, true),
                        _ => return None,
                    };
                    let mut pts = self.edge(edge)?;
                    if !orient {
                        pts.reverse();
                    }
                    if let Some(last) = out.last() {
                        if dist(*last, pts[0]) < 1e-12 * (1.0 + norm(*last)) || dist(*last, pts[0]) < 1e-9 {
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
            "POLY_LOOP" => self.points(arg(a, 1)?),
            "VERTEX_LOOP" => Some(vec![]),
            _ => None,
        }
    }

    
    fn face(&mut self, id: u32, flip: bool, depth: u32) -> Option<(Surface, Vec<Vec<V3>>, bool)> {
        let (k, a) = self.f.simple(id)?;
        match k {
            "ORIENTED_FACE" if depth < 4 => {
                let o = arg(a, 3).and_then(|v| v.boolean()).unwrap_or(true);
                self.face(arg(a, 2)?.rf()?, flip ^ !o, depth + 1)
            }
            "ADVANCED_FACE" | "FACE_SURFACE" | "FACE" => {
                let mut loops = Vec::new();
                for b in arg(a, 1)?.refs() {
                    let (bk, ba) = self.f.simple(b)?;
                    if bk != "FACE_BOUND" && bk != "FACE_OUTER_BOUND" {
                        continue;
                    }
                    let orient = arg(ba, 2).and_then(|v| v.boolean()).unwrap_or(true);
                    let mut pts = self.loop_points(arg(ba, 1)?.rf()?)?;
                    if !orient {
                        pts.reverse();
                    }
                    if pts.len() >= 2 {
                        loops.push(pts);
                    }
                }
                let same = arg(a, 3).and_then(|v| v.boolean()).unwrap_or(true);
                let surf = match arg(a, 2).and_then(|v| v.rf()) {
                    Some(s) => self.surface(s, 0)?,
                    None => planar_surface(loops.first()?)?,
                };
                 
                let sense = if k == "FACE" { true } else { same };
                Some((surf, loops, sense ^ flip))
            }
            _ => {
                self.skip(k);
                None
            }
        }
    }
}


fn planar_surface(pts: &[V3]) -> Option<Surface> {
    let mut n = [0.0; 3];
    let mut c = [0.0; 3];
    for i in 0..pts.len() {
        let (p, q) = (pts[i], pts[(i + 1) % pts.len()]);
        n[0] += (p[1] - q[1]) * (p[2] + q[2]);
        n[1] += (p[2] - q[2]) * (p[0] + q[0]);
        n[2] += (p[0] - q[0]) * (p[1] + q[1]);
        c = add(c, p);
    }
    let c = scale(c, 1.0 / pts.len().max(1) as f64);
    let n = normalize(n)?;
    Some(Surface::Plane(Frame::from_axes(c, Some(n), None)))
}

 



pub fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn named_color(name: &str) -> Option<[f32; 3]> {
    Some(match name.to_ascii_lowercase().as_str() {
        "red" => [1.0, 0.0, 0.0],
        "green" => [0.0, 1.0, 0.0],
        "blue" => [0.0, 0.0, 1.0],
        "yellow" => [1.0, 1.0, 0.0],
        "magenta" => [1.0, 0.0, 1.0],
        "cyan" => [0.0, 1.0, 1.0],
        "black" => [0.0, 0.0, 0.0],
        "white" => [1.0, 1.0, 1.0],
        _ => return None,
    })
}



fn style_color(f: &File, id: u32, depth: u32, rgb: &mut Option<[f32; 3]>, alpha: &mut Option<f32>, fill: bool) {
    if depth > 12 {
        return;
    }
    let Some(r) = f.get(id) else { return };
    for (name, args) in &r.parts {
        match name.as_str() {
            "CURVE_STYLE" | "POINT_STYLE" | "TEXT_STYLE" => return,
            "COLOUR_RGB" => {
                if rgb.is_none() || fill {
                    let c: Vec<f32> = args.iter().skip(1).filter_map(|v| v.num()).map(|v| v as f32).collect();
                    if c.len() == 3 {
                        *rgb = Some([c[0], c[1], c[2]]);
                    }
                }
                return;
            }
            "DRAUGHTING_PRE_DEFINED_COLOUR" | "PRE_DEFINED_COLOUR" => {
                if let Some(Val::Str(n)) = args.first() {
                    if rgb.is_none() || fill {
                        *rgb = named_color(n);
                    }
                }
                return;
            }
            "SURFACE_STYLE_TRANSPARENT" => {
                if let Some(t) = args.first().and_then(|v| v.num()) {
                    *alpha = Some((1.0 - t as f32).clamp(0.0, 1.0));
                }
                return;
            }
            _ => {}
        }
        let is_fill = fill || name == "SURFACE_STYLE_FILL_AREA" || name == "FILL_AREA_STYLE_COLOUR";
        for v in args {
            visit_refs(v, &mut |r| style_color(f, r, depth + 1, rgb, alpha, is_fill && rgb.is_none()));
        }
    }
}

fn visit_refs(v: &Val, cb: &mut dyn FnMut(u32)) {
    match v {
        Val::Ref(r) => cb(*r),
        Val::List(l) | Val::Typed(_, l) => l.iter().for_each(|x| visit_refs(x, cb)),
        _ => {}
    }
}


fn colors(f: &File) -> HashMap<u32, Rgba> {
    let mut out = HashMap::new();
    for (id, r) in &f.recs {
        let Some((k, a)) = r.parts.first().map(|p| (p.0.as_str(), &p.1)) else { continue };
        if k != "STYLED_ITEM" && k != "OVER_RIDING_STYLED_ITEM" {
            continue;
        }
        let _ = id;
        let Some(item) = a.get(2).and_then(|v| v.rf()) else { continue };
        let mut rgb = None;
        let mut alpha = None;
        if let Some(styles) = a.get(1) {
            visit_refs(styles, &mut |s| style_color(f, s, 0, &mut rgb, &mut alpha, false));
        }
        if let Some(c) = rgb {
            let v = [srgb_to_linear(c[0]), srgb_to_linear(c[1]), srgb_to_linear(c[2]), alpha.unwrap_or(1.0)];
            let e = out.entry(item).or_insert(v);
            if k == "OVER_RIDING_STYLED_ITEM" {
                *e = v;
            }
        }
    }
    out
}


fn unit_factor(f: &File, id: u32, depth: u32) -> Option<f64> {
    if depth > 6 {
        return None;
    }
    if let Some(si) = f.part(id, "SI_UNIT") {
        let prefix = si.first().and_then(|v| v.enm()).unwrap_or("");
        let name = si.get(1).and_then(|v| v.enm()).unwrap_or("");
        let p = match prefix {
            "EXA" => 1e18,
            "PETA" => 1e15,
            "TERA" => 1e12,
            "GIGA" => 1e9,
            "MEGA" => 1e6,
            "KILO" => 1e3,
            "HECTO" => 1e2,
            "DECA" => 1e1,
            "DECI" => 1e-1,
            "CENTI" => 1e-2,
            "MILLI" => 1e-3,
            "MICRO" => 1e-6,
            "NANO" => 1e-9,
            "PICO" => 1e-12,
            _ => 1.0,
        };
        return Some(match name {
            "METRE" => p * 1000.0,
            "RADIAN" => p,
            _ => p,
        });
    }
    if let Some(cb) = f.part(id, "CONVERSION_BASED_UNIT") {
        let m = cb.get(1)?.rf()?;
        let (_, ma) = f.simple(m)?;
        let v = ma.first()?.num()?;
        let u = unit_factor(f, ma.get(1)?.rf()?, depth + 1)?;
        return Some(v * u);
    }
    None
}


fn context_units(f: &File, ctx: u32) -> (Option<f64>, Option<f64>) {
    let Some(units) = f.part(ctx, "GLOBAL_UNIT_ASSIGNED_CONTEXT") else { return (None, None) };
    let mut len = None;
    let mut ang = None;
    for u in units.first().map(|v| v.refs()).unwrap_or_default() {
        if f.has(u, "LENGTH_UNIT") {
            len = len.or(unit_factor(f, u, 0));
        } else if f.has(u, "PLANE_ANGLE_UNIT") {
            ang = ang.or(unit_factor(f, u, 0));
        }
    }
    (len, ang)
}


fn representation(f: &File, id: u32) -> Option<(Vec<u32>, Option<u32>)> {
    let r = f.get(id)?;
    for (name, a) in &r.parts {
         
        if name.ends_with("REPRESENTATION") && !name.contains("_PRESENTATION") && !name.starts_with("PRESENTATION") && a.len() >= 3 {
            if let Some(items) = a[1].list() {
                return Some((items.iter().filter_map(|v| v.rf()).collect(), a[2].rf()));
            }
        }
    }
    None
}

struct Uf {
    p: HashMap<u32, u32>,
}
impl Uf {
    fn find(&mut self, x: u32) -> u32 {
        let mut r = x;
        while let Some(&q) = self.p.get(&r) {
            if q == r {
                break;
            }
            r = q;
        }
         
        let mut y = x;
        while let Some(&q) = self.p.get(&y) {
            if q == r {
                break;
            }
            self.p.insert(y, r);
            y = q;
        }
        r
    }
    fn union(&mut self, a: u32, b: u32) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.p.insert(ra.max(rb), ra.min(rb));
        }
    }
}


pub fn load(bytes: &[u8], acc: Accuracy) -> Result<Model, String> {
    let (f, bad) = crate::p21::parse(bytes)?;
    let colors = colors(&f);

     
    let mut reps: Vec<u32> = f.recs.keys().copied().filter(|id| representation(&f, *id).is_some()).collect();
    reps.sort_unstable();
    let mut uf = Uf { p: reps.iter().map(|r| (*r, *r)).collect() };
    struct Link {
        child: u32,
        parent: u32,
        item_child: u32,
        item_parent: u32,
    }
    let mut links_raw: Vec<(u32, u32, u32, u32, u32)> = Vec::new();  
    for (id, r) in &f.recs {
        let rr = r.parts.iter().find(|p| p.0 == "REPRESENTATION_RELATIONSHIP" || p.0 == "SHAPE_REPRESENTATION_RELATIONSHIP");
        let Some((_, a)) = rr else { continue };
        let (Some(r1), Some(r2)) = (a.get(2).and_then(|v| v.rf()), a.get(3).and_then(|v| v.rf())) else { continue };
        let tr = r.parts.iter().find(|p| p.0 == "REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION").and_then(|p| p.1.first()).and_then(|v| v.rf());
        match tr {
            Some(t) => {
                if let Some((k, ta)) = f.simple(t) {
                    if k == "ITEM_DEFINED_TRANSFORMATION" {
                        if let (Some(i1), Some(i2)) = (ta.get(2).and_then(|v| v.rf()), ta.get(3).and_then(|v| v.rf())) {
                            links_raw.push((*id, r1, r2, i1, i2));
                        }
                    }
                }
            }
            None => {
                if uf.p.contains_key(&r1) && uf.p.contains_key(&r2) {
                    uf.union(r1, r2);
                }
            }
        }
    }
     
    let mut rr_child: HashMap<u32, u32> = HashMap::new();
    {
        let mut pd_reps: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut pds_def: HashMap<u32, u32> = HashMap::new();
        for (id, r) in &f.recs {
            if let Some(a) = r.parts.iter().find(|p| p.0 == "PRODUCT_DEFINITION_SHAPE").map(|p| &p.1) {
                if let Some(d) = a.get(2).and_then(|v| v.rf()) {
                    pds_def.insert(*id, d);
                }
            }
        }
        for r in f.recs.values() {
            if let Some(a) = r.parts.iter().find(|p| p.0 == "SHAPE_DEFINITION_REPRESENTATION").map(|p| &p.1) {
                if let (Some(pds), Some(rep)) = (a.first().and_then(|v| v.rf()), a.get(1).and_then(|v| v.rf())) {
                    if let Some(pd) = pds_def.get(&pds) {
                        pd_reps.entry(*pd).or_default().push(rep);
                    }
                }
            }
        }
        for r in f.recs.values() {
            if let Some(a) = r.parts.iter().find(|p| p.0 == "CONTEXT_DEPENDENT_SHAPE_REPRESENTATION").map(|p| &p.1) {
                let (Some(rr), Some(pds)) = (a.first().and_then(|v| v.rf()), a.get(1).and_then(|v| v.rf())) else { continue };
                let Some(nauo) = pds_def.get(&pds) else { continue };
                let Some(na) = f.part(*nauo, "NEXT_ASSEMBLY_USAGE_OCCURRENCE").or_else(|| f.part(*nauo, "PRODUCT_DEFINITION_USAGE")) else { continue };
                let Some(related) = na.get(4).and_then(|v| v.rf()) else { continue };
                if let Some(rs) = pd_reps.get(&related) {
                    for rep in rs.clone() {
                        rr_child.insert(rr, rep);
                    }
                }
            }
        }
    }
    let mut links: Vec<Link> = Vec::new();
    for (rr, r1, r2, i1, i2) in links_raw {
        if !uf.p.contains_key(&r1) || !uf.p.contains_key(&r2) {
            continue;
        }
        let child_is_2 = rr_child.get(&rr).map(|c| uf.find(*c) == uf.find(r2) && uf.find(*c) != uf.find(r1)).unwrap_or(false);
        let l = if child_is_2 { Link { child: r2, parent: r1, item_child: i2, item_parent: i1 } } else { Link { child: r1, parent: r2, item_child: i1, item_parent: i2 } };
        links.push(l);
    }

     
    let mut groups: BTreeMap<u32, (Vec<u32>, Option<f64>, Option<f64>)> = BTreeMap::new();
    for r in &reps {
        let g = uf.find(*r);
        let (items, ctx) = representation(&f, *r).unwrap();
        let e = groups.entry(g).or_insert((Vec::new(), None, None));
        e.0.extend(items);
        if let Some(c) = ctx {
            let (l, a) = context_units(&f, c);
            e.1 = e.1.or(l);
            e.2 = e.2.or(a);
        }
    }
    let global_len = groups.values().find_map(|g| g.1).unwrap_or(1.0);
    let global_ang = groups.values().find_map(|g| g.2).unwrap_or(1.0);
    let unit_of = |g: u32, groups: &BTreeMap<u32, (Vec<u32>, Option<f64>, Option<f64>)>| groups.get(&g).and_then(|e| e.1).unwrap_or(global_len);

    let mut ctx = Ctx { f: &f, angle: global_ang, edges: HashMap::new(), skipped: BTreeMap::new(), tol: acc.edge };
    let frame_mm = |ctx: &Ctx, item: u32, unit: f64| -> Xform {
        match ctx.placement(item) {
            Some(fr) => Xform::from_frame(&Frame { o: scale(fr.o, unit), ..fr }),
            None => Xform::IDENTITY,
        }
    };

     
     
    let mut group_names: HashMap<u32, String> = HashMap::new();
    for r in f.recs.values() {
        let Some(a) = r.parts.iter().find(|p| p.0 == "SHAPE_DEFINITION_REPRESENTATION").map(|p| &p.1) else { continue };
        let (Some(pds), Some(rep)) = (a.first().and_then(|v| v.rf()), a.get(1).and_then(|v| v.rf())) else { continue };
        if !uf.p.contains_key(&rep) {
            continue;
        }
        let Some(pd) = f.part(pds, "PRODUCT_DEFINITION_SHAPE").and_then(|a| a.get(2)).and_then(|v| v.rf()) else { continue };
        if let Some(name) = product_name(&f, pd) {
            let g = uf.find(rep);
            group_names.entry(g).or_insert(name);
        }
    }
    let mut parts: Vec<String> = Vec::new();

     
    let mut instances: Vec<(u32, Xform, f64, u32)> = Vec::new();
    let child_groups: HashSet<u32> = links.iter().map(|l| uf.find(l.child)).collect();
    let mut visited: HashSet<u32> = HashSet::new();
    let mut stack: Vec<(u32, Xform, u32)> = groups.keys().copied().filter(|g| !child_groups.contains(g)).map(|g| (g, Xform::IDENTITY, 0)).collect();
    let link_list: Vec<(u32, u32, u32, u32)> = links.iter().map(|l| (uf.find(l.child), uf.find(l.parent), l.item_child, l.item_parent)).collect();
    while let Some((g, t, depth)) = stack.pop() {
        visited.insert(g);
        let unit = unit_of(g, &groups);
         
        let mut part_here: Option<u32> = None;
        if let Some((items, _, _)) = groups.get(&g) {
            for it in items.clone() {
                if f.has(it, "MAPPED_ITEM") && depth < 32 {
                    let a = f.part(it, "MAPPED_ITEM").unwrap();
                    let (Some(map), Some(target)) = (a.get(1).and_then(|v| v.rf()), a.get(2).and_then(|v| v.rf())) else { continue };
                    let Some(ma) = f.part(map, "REPRESENTATION_MAP") else { continue };
                    let (Some(origin), Some(rep)) = (ma.first().and_then(|v| v.rf()), ma.get(1).and_then(|v| v.rf())) else { continue };
                    if !uf.p.contains_key(&rep) {
                        continue;
                    }
                    let cg = uf.find(rep);
                    let cu = unit_of(cg, &groups);
                    let m = frame_mm(&ctx, target, unit).mul(&frame_mm(&ctx, origin, cu).inverse_rigid());
                    stack.push((cg, t.mul(&m), depth + 1));
                } else {
                     
                    let p = if is_geometry(&f, it) {
                        *part_here.get_or_insert_with(|| {
                            parts.push(group_names.get(&g).cloned().unwrap_or_default());
                            (parts.len() - 1) as u32
                        })
                    } else {
                        0
                    };
                    instances.push((it, t.mul(&Xform::uniform_scale(unit)), unit, p));
                }
            }
        }
        if depth < 32 {
            for (c, p, ic, ip) in &link_list {
                if *p == g {
                    let cu = unit_of(*c, &groups);
                    let m = frame_mm(&ctx, *ip, unit).mul(&frame_mm(&ctx, *ic, cu).inverse_rigid());
                    stack.push((*c, t.mul(&m), depth + 1));
                }
            }
        }
    }
    for (g, (items, _, _)) in &groups {
        if !visited.contains(g) {
            let unit = unit_of(*g, &groups);
            parts.push(group_names.get(g).cloned().unwrap_or_default());
            let p = (parts.len() - 1) as u32;
            for it in items {
                instances.push((*it, Xform::uniform_scale(unit), unit, p));
            }
        }
    }
     
    if instances.iter().all(|(it, _, _, _)| !is_geometry(&f, *it)) {
        let mut ids: Vec<u32> = f.recs.keys().copied().filter(|id| is_geometry(&f, *id)).collect();
        ids.sort_unstable();
        parts = vec![String::new()];
        instances = ids.into_iter().map(|id| (id, Xform::uniform_scale(global_len), global_len, 0)).collect();
    }

     
    let mut faces: Vec<FaceIn> = Vec::new();
    for (item, xf, unit, part) in instances {
        let mut fl: Vec<(u32, Option<Rgba>, bool)> = Vec::new();
        collect_faces(&f, item, colors.get(&item).copied(), false, &colors, &mut fl, 0);
        if fl.is_empty() {
            continue;
        }
         
        let local = acc.in_units(unit);
        if (ctx.tol.lin - local.edge.lin).abs() > 1e-15 {
            ctx.edges.clear();
            ctx.tol = local.edge;
        }
        for (fid, color, flip) in fl {
            match ctx.face(fid, flip, 0) {
                Some((surface, loops, sense)) => {
                    let key = ((fid as u64) << 32) ^ (unit.to_bits() >> 32) ^ ((sense as u64) << 31);
                    faces.push(FaceIn { key: Some(key), surface, loops, uv_loops: vec![], sense, color, xform: xf, tol: local.face, part })
                }
                None => ctx.skip("face"),
            }
        }
    }
    Ok(Model { faces, skipped: ctx.skipped, bad_instances: bad, parts })
}


fn product_name(f: &File, pd: u32) -> Option<String> {
    let formation = f.part(pd, "PRODUCT_DEFINITION")?.get(2)?.rf()?;
    let fa = f.part(formation, "PRODUCT_DEFINITION_FORMATION").or_else(|| f.part(formation, "PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE"))?;
    let product = fa.get(2)?.rf()?;
    let pa = f.part(product, "PRODUCT")?;
    let text = |v: Option<&Val>| match v {
        Some(Val::Str(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    };
    text(pa.get(1)).or_else(|| text(pa.first()))
}

fn is_geometry(f: &File, id: u32) -> bool {
    matches!(f.kind(id), "MANIFOLD_SOLID_BREP" | "BREP_WITH_VOIDS" | "FACETED_BREP" | "SHELL_BASED_SURFACE_MODEL" | "FACE_BASED_SURFACE_MODEL")
}


fn collect_faces(f: &File, id: u32, inherited: Option<Rgba>, flip: bool, colors: &HashMap<u32, Rgba>, out: &mut Vec<(u32, Option<Rgba>, bool)>, depth: u32) {
    if depth > 8 {
        return;
    }
    let Some((k, a)) = f.simple(id) else { return };
    let color = colors.get(&id).copied().or(inherited);
    match k {
        "MANIFOLD_SOLID_BREP" | "FACETED_BREP" => {
            if let Some(s) = a.get(1).and_then(|v| v.rf()) {
                collect_faces(f, s, color, flip, colors, out, depth + 1);
            }
        }
        "BREP_WITH_VOIDS" => {
            if let Some(s) = a.get(1).and_then(|v| v.rf()) {
                collect_faces(f, s, color, flip, colors, out, depth + 1);
            }
            for s in a.get(2).map(|v| v.refs()).unwrap_or_default() {
                collect_faces(f, s, color, flip, colors, out, depth + 1);
            }
        }
        "SHELL_BASED_SURFACE_MODEL" | "FACE_BASED_SURFACE_MODEL" => {
            for s in a.get(1).map(|v| v.refs()).unwrap_or_default() {
                collect_faces(f, s, color, flip, colors, out, depth + 1);
            }
        }
        "CLOSED_SHELL" | "OPEN_SHELL" | "CONNECTED_FACE_SET" => {
            for fc in a.get(1).map(|v| v.refs()).unwrap_or_default() {
                let c = colors.get(&fc).copied().or(color);
                out.push((fc, c, flip));
            }
        }
        "ORIENTED_CLOSED_SHELL" | "ORIENTED_OPEN_SHELL" => {
            let o = a.get(3).and_then(|v| v.boolean()).unwrap_or(true);
            if let Some(s) = a.get(2).and_then(|v| v.rf()) {
                collect_faces(f, s, color, flip ^ !o, colors, out, depth + 1);
            }
        }
        "ADVANCED_FACE" | "FACE_SURFACE" | "FACE" | "ORIENTED_FACE" => out.push((id, color, flip)),
        _ => {}
    }
}
