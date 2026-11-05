// Resolves inverse-kinematics branches for supported robot families.





















use crate::math::*;
use crate::robot::{wrap180, Family, Joint, JointKind, RobotModel};





#[derive(Clone, Debug, PartialEq)]
pub struct IkRow {
    pub q: Vec<f64>,
    pub primary: bool,
    pub extras: Vec<f64>,
}


#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Solver {
    Scara,
    Analytic,
    Delta,
    Iterative,
    Gripper,
}

fn dot(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn sub(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn x_axis(m: &Mat4) -> [f64; 3] {
    [m[0], m[4], m[8]]
}

fn y_axis(m: &Mat4) -> [f64; 3] {
    [m[1], m[5], m[9]]
}

fn z_axis(m: &Mat4) -> [f64; 3] {
    [m[2], m[6], m[10]]
}

impl RobotModel {
    
    
    
    pub(crate) fn reduced6(&self) -> Option<RobotModel> {
        let free = |j: &Joint| Joint { lower: -1e9, upper: 1e9, ..j.clone() };
        let (joints, flange) = match (self.mech, self.joints.len(), self.nq) {
            (3, 7, 7) => {
                let held = Self::row_transform(&self.joints[2], 0.0);
                let mut rows: Vec<Joint> = self.joints.iter().enumerate().filter(|(i, _)| *i != 2).map(|(_, j)| free(j)).collect();
                rows[2].pre = Some(match rows[2].pre {
                    Some(p) => mul(&held, &p),
                    None => held,
                });
                (rows, self.flange)
            }
            (4, 5, 5) => {
                let mut rows: Vec<Joint> = self.joints.iter().map(free).collect();
                rows.push(Joint { kind: JointKind::Rotary, alpha: 0.0, a: 0.0, theta: 0.0, d: 0.0, lower: -1e9, upper: 1e9, pre: Some(self.flange) });
                (rows, IDENTITY)
            }
            _ => return None,
        };
        if joints.iter().any(|j| j.kind != JointKind::Rotary) {
            return None;
        }
        let mut map = vec![0.0; 36];
        for i in 0..6 {
            map[i * 7] = 1.0;
        }
        Some(RobotModel {
            base: self.base,
            flange,
            joints,
            nq: 6,
            map,
            user_lower: vec![-1e9; 6],
            user_upper: vec![1e9; 6],
            polygon: vec![],
            mech: 1,
            nlinks: 7,
            params: vec![],
        })
    }

    
    
    pub(crate) fn from_reduced(&self, r: &[f64]) -> Option<(Vec<f64>, f64)> {
        let (v, extra) = match self.nq {
            7 => ([&r[..2], &[0.0], &r[2..6]].concat(), 0.0),
            5 => (r[..5].to_vec(), wrap180(r[5]).abs()),
            _ => return None,
        };
        let mut q = self.user_from_internal(&v)?;
        for k in 0..self.nq {
            if self.turnable(k) {
                q[k] = wrap180(q[k]);
            }
        }
        Some((q, extra))
    }

    
    pub(crate) fn scara_axes(&self) -> Option<(usize, usize, usize)> {
        if self.mech != 2 || self.joints.len() != 4 || self.nq != 4 {
            return None;
        }
        let rot: Vec<usize> = (0..4).filter(|&j| self.joints[j].kind == JointKind::Rotary).collect();
        let lin: Vec<usize> = (0..4).filter(|&j| self.joints[j].kind == JointKind::Linear).collect();
        (rot.len() == 3 && lin.len() == 1 && rot[2] == 3).then(|| (rot[0], rot[1], lin[0]))
    }

    
    
    pub(crate) fn scara_branches(&self, target: &Mat4) -> Vec<Vec<f64>> {
        let Some((s, e, l)) = self.scara_axes() else { return vec![] };
        let p = self.pure();
        let frame4 = |v: &[f64; 4]| p.serial_frames(v)[4];
        let f0 = p.serial_frames(&[0.0; 4]);
        let u = z_axis(&f0[s + 1]);
        if [e, l, 3].iter().any(|&j| {
            let c = cross(&u, &z_axis(&f0[j + 1]));
            dot(&c, &c) > 1e-12
        }) {
            return vec![];
        }
         
        let w = mul(target, &inv(&self.flange));
        let pw = pos(&w);
        let os = pos(&f0[s + 1]);
        let flat = |x: [f64; 3]| {
            let d = dot(&x, &u);
            [x[0] - d * u[0], x[1] - d * u[1], x[2] - d * u[2]]
        };
        let mut v = [0.0f64; 4];
        v[l] = (dot(&pw, &u) - dot(&pos(&f0[4]), &u)) / dot(&u, &z_axis(&f0[l + 1]));
         
        let reach2 = |ve: f64| {
            let mut x = [0.0; 4];
            x[e] = ve;
            let d = flat(sub(&pos(&frame4(&x)), &os));
            dot(&d, &d)
        };
        let (fa, fb, fc) = (reach2(0.0), reach2(90.0), reach2(-90.0));
        let a = 0.5 * (fb + fc);
        let (b, c) = (fa - a, 0.5 * (fb - fc));
        let amp = (b * b + c * c).sqrt();
        let t = flat(sub(&pw, &os));
        if amp < 1e-9 {
            return vec![];
        }
        let rhs = (dot(&t, &t) - a) / amp;
        if rhs.abs() > 1.0 + 1e-9 {
            return vec![];
        }
        let (base, acs) = (c.atan2(b), rhs.clamp(-1.0, 1.0).acos());
        let mut out: Vec<Vec<f64>> = Vec::new();
        for x in [base + acs, base - acs] {
            let mut vv = v;
            vv[e] = x.to_degrees();
            let cur = flat(sub(&pos(&frame4(&vv)), &os));
            let n = dot(&cur, &cur).sqrt();
            if n < 1e-9 {
                return vec![];
            }
            let e1 = [cur[0] / n, cur[1] / n, cur[2] / n];
            let e2 = cross(&u, &e1);
            vv[s] = dot(&t, &e2).atan2(dot(&t, &e1)).to_degrees();
            let r0 = frame4(&vv);
            let xw = x_axis(&w);
            vv[3] = dot(&xw, &y_axis(&r0)).atan2(dot(&xw, &x_axis(&r0))).to_degrees();
            let r4 = frame4(&vv);
             
             
            if dot(&x_axis(&w), &z_axis(&r4)) < -0.2 - 1e-12 {
                return vec![];
            }
            let dp = sub(&pos(&r4), &pw);
            if dot(&dp, &dp) > 1e-6 {
                continue;
            }
            let Some(q) = self.user_from_internal(&vv) else { continue };
            let q: Vec<f64> = q.iter().enumerate().map(|(k, &x)| if self.joints[k].kind == JointKind::Rotary { wrap180(x) } else { x }).collect();
            if !out.iter().any(|o| o.iter().zip(&q).all(|(a, b)| (a - b).abs() < 1e-9)) {
                out.push(q);
            }
        }
        out.sort_by_key(|q| if wrap180(q[e]) > 0.0 { 0 } else { 1 });
        out
    }

    
    
    
    fn scara_rows(&self, target: &Mat4, seed: &[f64]) -> Vec<IkRow> {
        let Some((_, e, _)) = self.scara_axes() else { return vec![] };
        let near = |q: &Vec<f64>| -> Vec<f64> {
            q.iter()
                .enumerate()
                .map(|(k, &x)| if self.joints[k].kind == JointKind::Rotary { x + 360.0 * ((seed[k] - x) / 360.0).round() } else { x })
                .collect()
        };
        let prims: Vec<Vec<f64>> = self.scara_branches(target).iter().map(near).collect();
        let ok = |q: &Vec<f64>| self.within_limits(q, 1e-6);
        let mut rows: Vec<(Vec<f64>, f64)> =
            prims.iter().filter(|q| ok(q)).map(|q| (q.clone(), if wrap180(q[e]) > 0.0 { 1.0 } else { 2.0 })).collect();
        for p in &prims {
            for m in [360.0, -360.0] {
                let mut c = p.clone();
                c[3] += m;
                if ok(&c) {
                    rows.push((c, 10.0));
                }
            }
        }
        let flip = self.config(seed)[2];
        rows.into_iter()
            .map(|(q, flag)| {
                let cost = linf(&q, seed) + if self.config(&q)[2] != flip { 180.0 } else { 0.0 };
                IkRow { primary: flag < 5.0, extras: vec![flag, cost], q }
            })
            .collect()
    }

    
    
    fn analytic_rows(&self, target: &Mat4, seed: &[f64]) -> Vec<(Vec<f64>, bool, f64)> {
        let mut rows: Vec<(Vec<f64>, bool, f64)> = self.primaries_ext(target).into_iter().map(|(q, x)| (q, true, x)).collect();
        for k in 0..self.nq {
            if !self.turnable(k) {
                continue;
            }
            let lo = self.user_lower[k].min(self.user_upper[k]) - 1e-6;
            let hi = self.user_upper[k].max(self.user_lower[k]) + 1e-6;
            let g = (seed[k] / 360.0).round();
            let mut turns: Vec<f64> = Vec::new();
            for m in [-1.0, 1.0, g + 1.0, g, g - 1.0] {
                if m != 0.0 && !turns.contains(&m) {
                    turns.push(m);
                }
            }
            for i in 0..rows.len() {
                for &m in &turns {
                    let mut c = rows[i].0.clone();
                    c[k] += 360.0 * m;
                    if c[k] >= lo && c[k] <= hi {
                        let extra = rows[i].2;
                        rows.push((c, false, extra));
                    }
                }
            }
        }
        rows.retain(|r| self.within_limits(&r.0, 1e-6));
        rows
    }

    
    
    
    
    fn delta_rows(&self, target: &Mat4, seed: &[f64]) -> Vec<Vec<f64>> {
        let Some(p) = self.ik_primaries(target).into_iter().next() else { return vec![] };
        let Some(a) = self.rotary_axis() else {
            return if self.within_limits(&p, 1e-6) { vec![p] } else { vec![] };
        };
        let off = if self.family() == Family::Delta { crate::mechanism::Delta::of(self).rotary_offset() } else { 0.0 };
        let base = wrap180(p[a] + off) + 360.0 * (seed[a] / 360.0).round() - off;
        let base = self.turned(&p, a, base - p[a]);
        let mut out: Vec<Vec<f64>> = [0.0, 1.0, 2.0, 3.0, 4.0, -1.0, -2.0, -3.0, -4.0]
            .iter()
            .map(|m| self.turned(&base, a, 360.0 * m))
            .filter(|c| self.user_ok(c))
            .collect();
        if let Some(best) = self.ik_closest(target, seed) {
            if let Some(i) = out.iter().position(|c| linf(c, &best) < 1e-9) {
                out.swap(0, i);
            }
        }
        out
    }

    
    pub fn solver(&self) -> Solver {
        match self.family() {
            Family::Delta | Family::PlanarDelta => Solver::Delta,
            Family::Gripper => Solver::Gripper,
            Family::Cartesian => Solver::Analytic,
            Family::Serial if self.scara_axes().is_some() => Solver::Scara,
            Family::Serial if matches!(self.mech, 8 | -1 | -3 | -6 | -8 | 23 | -23) || (self.mech == 0 && self.nq == 7) => Solver::Iterative,
            Family::Serial => Solver::Analytic,
        }
    }

    
    
    pub fn ik_rows(&self, target: &Mat4, seed: &[f64]) -> Vec<IkRow> {
        let seed: Vec<f64> = (0..self.nq).map(|k| seed.get(k).copied().unwrap_or(0.0)).collect();
        let mut rows = match self.solver() {
            Solver::Gripper => return vec![],
            Solver::Scara => self.scara_rows(target, &seed),
            Solver::Delta => {
                let pad = if self.mech == 5 { 5usize.saturating_sub(self.nq) } else { 0 };
                return self.delta_rows(target, &seed).into_iter().enumerate().map(|(i, q)| IkRow { q, primary: i == 0, extras: vec![0.0; pad] }).collect();
            }
            Solver::Iterative => {
                let pad = match (self.mech, self.nq) {
                    (8, _) => 2,
                    (23, _) => 0,
                    (_, 7) => 5,
                    _ => 6,
                };
                return self.ik_iterative(target, &seed).into_iter().map(|q| IkRow { q, primary: true, extras: vec![0.0; pad] }).collect();
            }
            Solver::Analytic => {
                let mut rows = self.analytic_rows(target, &seed);
                if rows.is_empty() {
                     
                    if let Some(q) = self.ik_numeric(target, &seed, 200).filter(|q| self.within_limits(q, 1e-6)) {
                        rows.push((q, true, 0.0));
                    }
                }
                rows
            }
            .into_iter()
                .map(|(q, primary, extra)| {
                    let flag = if primary { 10.0 } else { 0.0 };
                    let cost = linf(&q, &seed).max(extra);
                    let extras = match (self.mech, self.nq) {
                        (4, 5) => {
                             
                             
                            let mut v6 = self.virtual_j6(target, &q);
                            if v6.abs() > 180.0 - 1e-6 {
                                v6 = if wrap180(q[3]) < 0.0 && q[4] < 0.0 { -180.0 } else { 180.0 };
                            }
                            vec![v6, flag, cost]
                        }
                        (3, 7) | (9, _) => vec![],
                        _ => vec![flag, cost],
                    };
                    IkRow { q, primary, extras }
                })
                .collect(),
        };
        if let Some(best) = self.best_row(&rows, target, &seed) {
            rows.swap(0, best);
        }
        rows
    }

    
    
    
    fn best_row(&self, rows: &[IkRow], target: &Mat4, seed: &[f64]) -> Option<usize> {
        let _ = target;
        let skip = if self.mech == 3 && self.nq == 7 { 2 } else { usize::MAX };
        let cost = |r: &IkRow| -> f64 {
            let d = r.q.iter().zip(seed).enumerate().filter(|(k, _)| *k != skip).map(|(_, (a, b))| (a - b).abs()).fold(0.0, f64::max);
            match self.solver() {
                Solver::Scara => r.extras[1],
                _ if self.mech == 4 && self.nq == 5 => d.max(r.extras[0].abs()),
                _ => d,
            }
        };
        let mut best: Option<(usize, f64)> = None;
        for (i, r) in rows.iter().enumerate() {
            let c = cost(r);
            if best.map_or(true, |(_, b)| c < b - 1e-9) {
                best = Some((i, c));
            }
        }
        best.map(|(i, _)| i)
    }

    
    
    fn virtual_j6(&self, target: &Mat4, q: &[f64]) -> f64 {
        let f = self.fk(q);
        let xf = x_axis(&f);
        let xt = x_axis(target);
        let zf = z_axis(&f);
        wrap180(dot(&cross(&xf, &xt), &zf).atan2(dot(&xf, &xt)).to_degrees())
    }

    
    
    
    
    
    
    pub(crate) fn ik_iterative(&self, target: &Mat4, seed: &[f64]) -> Option<Vec<f64>> {
        if self.nq == 7 {
            if let Some(q) = self.ik_numeric(target, seed, 200).filter(|q| self.within_limits(q, 1e-6)) {
                return Some(q);
            }
        }
        let rows: Vec<IkRow> = self.analytic_rows(target, seed).into_iter().map(|(q, primary, _)| IkRow { q, primary, extras: vec![] }).collect();
        self.best_row(&rows, target, seed).map(|i| rows[i].q.clone())
    }
}

fn linf(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(x, y)| (x - y).abs()).fold(0.0, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    
    fn irb910sc() -> RobotModel {
        let row = |kind, alpha: f64, a, d, lo, hi| Joint { kind, alpha: alpha.to_radians(), a, theta: 0.0, d, lower: lo, upper: hi, pre: None };
        let mut map = vec![0.0; 16];
        for i in 0..4 {
            map[i * 5] = 1.0;
        }
        RobotModel {
            base: IDENTITY,
            flange: IDENTITY,
            joints: vec![
                row(JointKind::Rotary, 0.0, 0.0, 0.0, -140.0, 140.0),
                row(JointKind::Rotary, 0.0, 400.0, 0.0, -150.0, 150.0),
                row(JointKind::Linear, 0.0, 250.0, 220.2, -180.0, 0.0),
                row(JointKind::Rotary, 180.0, 0.0, 0.0, -400.0, 400.0),
            ],
            nq: 4,
            map,
            user_lower: vec![-140.0, -150.0, -180.0, -400.0],
            user_upper: vec![140.0, 150.0, 0.0, 400.0],
            polygon: vec![],
            mech: 2,
            nlinks: 5,
            params: vec![],
        }
    }

     
     
    #[test]
    fn scara_solveik_all_matches_reference() {
        let m = irb910sc();
        let q = [-104.15737640202241, 91.62635067792914, -90.73307177033433, -239.34368474953206];
        let current = [-97.14407266254595, 49.278010793226386, -137.28506625437973, 35.033966679441995];
        let rdk: [[f64; 6]; 5] = [
            [-104.15737640202241, 91.62635067792914, -90.73307177033433, 120.65631525046798, 1.0, 85.62234857102598],
            [-39.24217867473097, -91.62635067792914, -90.73307177033433, 2.3188116219011228, 2.0, 320.90436147115554],
            [-104.15737640202241, 91.62635067792914, -90.73307177033433, -239.34368474953203, 10.0, 274.37765142897405],
            [-39.24217867473097, -91.62635067792914, -90.73307177033433, 362.31881162190115, 10.0, 507.28484494245913],
            [-39.24217867473097, -91.62635067792914, -90.73307177033433, -357.68118837809885, 10.0, 572.7151550575409],
        ];
        let rows = m.ik_rows(&m.fk(&q), &current);
        assert_eq!(rows.len(), rdk.len());
        for (r, want) in rows.iter().zip(&rdk) {
            let got: Vec<f64> = r.q.iter().chain(&r.extras).copied().collect();
            assert!(got.iter().zip(want).all(|(a, b)| (a - b).abs() < 1e-6), "{got:?} vs {want:?}");
        }
         
        assert_eq!(m.ik_closest(&m.fk(&q), &current).unwrap(), rows[0].q);
    }

     
    #[test]
    fn scara_lean_limit() {
        let m = irb910sc();
        let q = [65.26900958577437, 62.513541886347824, -41.34059234708798, -195.4139559914506];
        let pose = m.fk(&q);
        let ok = |deg: f64| m.ik_closest(&mul(&pose, &roty(deg.to_radians())), &q).is_some();
        assert!(ok(11.41) && !ok(11.56));
         
        assert!(ok(-40.0) && m.ik_closest(&mul(&pose, &rotx(40f64.to_radians())), &q).is_some());
        assert_eq!(m.ik_closest(&mul(&pose, &roty(-30f64.to_radians())), &q).unwrap()[..3], m.ik_closest(&pose, &q).unwrap()[..3]);
    }
}
