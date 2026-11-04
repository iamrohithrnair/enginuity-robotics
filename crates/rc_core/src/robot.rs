






use crate::math::*;
use std::f64::consts::PI;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum JointKind {
    Rotary,
    Linear,
}

#[derive(Clone, Debug)]
pub struct Joint {
    pub kind: JointKind,
    pub alpha: f64,
    pub a: f64,
    pub theta: f64,
    pub d: f64,
    
    pub lower: f64,
    pub upper: f64,
    
    
    pub pre: Option<Mat4>,
}

#[derive(Clone, Debug)]
pub struct RobotModel {
    pub base: Mat4,
    pub flange: Mat4,
    
    pub joints: Vec<Joint>,
    
    pub nq: usize,
    
    pub map: Vec<f64>,
    pub user_lower: Vec<f64>,
    pub user_upper: Vec<f64>,
    
    pub polygon: Vec<[f64; 2]>,
    pub mech: i32,
    
    pub nlinks: usize,
    
    pub params: Vec<f64>,
}





pub const FLAT_HEADER: usize = 35;


#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Family {
    Serial,
    Delta,
    PlanarDelta,
    Gripper,
    
    Cartesian,
}

impl RobotModel {
    pub fn from_flat(v: &[f64]) -> Option<RobotModel> {
        if v.len() < FLAT_HEADER {
            return None;
        }
        let ndh = v[0] as usize;
        let nq = v[1] as usize;
        if ndh == 0 || ndh > 16 || nq == 0 || nq > 16 {
            return None;
        }
        let mech = v[2] as i32;
        let mut base = [0.0; 16];
        base.copy_from_slice(&v[3..19]);
        let mut flange = [0.0; 16];
        flange.copy_from_slice(&v[19..35]);
        let mut o = FLAT_HEADER;
        let need = o + ndh * 7 + ndh * nq + 2 * nq + 1;
        if v.len() < need {
            return None;
        }
        let mut joints = Vec::with_capacity(ndh);
        for _ in 0..ndh {
            joints.push(Joint {
                kind: if v[o] > 0.5 { JointKind::Linear } else { JointKind::Rotary },
                alpha: v[o + 1],
                a: v[o + 2],
                theta: v[o + 3],
                d: v[o + 4],
                lower: v[o + 5],
                upper: v[o + 6],
                pre: None,
            });
            o += 7;
        }
        let map = v[o..o + ndh * nq].to_vec();
        o += ndh * nq;
        let user_lower = v[o..o + nq].to_vec();
        o += nq;
        let user_upper = v[o..o + nq].to_vec();
        o += nq;
        let np = v[o] as usize;
        o += 1;
        let mut polygon = Vec::new();
        for k in 0..np {
            if o + 2 * k + 1 < v.len() {
                polygon.push([v[o + 2 * k], v[o + 2 * k + 1]]);
            }
        }
        o += 2 * np;
        let mut nlinks = ndh + 1;
        let mut params = Vec::new();
        if o + 1 < v.len() {
            nlinks = (v[o] as usize).clamp(1, 64);
            let npar = v[o + 1] as usize;
            if o + 2 + npar <= v.len() {
                params = v[o + 2..o + 2 + npar].to_vec();
            }
        }
        Some(RobotModel { base, flange, joints, nq, map, user_lower, user_upper, polygon, mech, nlinks, params })
    }

    pub fn family(&self) -> Family {
        let has = self.params.len() >= crate::mechanism::PARAM_LEN;
        match self.mech {
            5 if has => Family::Delta,
            12 if has => Family::PlanarDelta,
            15 => Family::Gripper,
            21 | 22 if crate::mechanism::is_cartesian(self) => Family::Cartesian,
            _ => Family::Serial,
        }
    }

    pub fn dof(&self) -> usize {
        self.nq
    }

    
    pub fn internal(&self, q: &[f64]) -> Vec<f64> {
        (0..self.joints.len())
            .map(|j| (0..self.nq).map(|k| self.map[j * self.nq + k] * q.get(k).copied().unwrap_or(0.0)).sum())
            .collect()
    }

    fn square_invertible(&self) -> bool {
        self.joints.len() == self.nq
    }

    
    pub fn user_from_internal(&self, v: &[f64]) -> Option<Vec<f64>> {
        if !self.square_invertible() {
            return None;
        }
        let n = self.nq;
        let mut a: Vec<Vec<f64>> = (0..n).map(|j| self.map[j * n..j * n + n].to_vec()).collect();
        let mut b: Vec<f64> = v.to_vec();
        for col in 0..n {
            let piv = (col..n).max_by(|&x, &y| a[x][col].abs().total_cmp(&a[y][col].abs()))?;
            if a[piv][col].abs() < 1e-12 {
                return None;
            }
            a.swap(col, piv);
            b.swap(col, piv);
            for r in 0..n {
                if r != col {
                    let f = a[r][col] / a[col][col];
                    if f != 0.0 {
                        for c in col..n {
                            a[r][c] -= f * a[col][c];
                        }
                        b[r] -= f * b[col];
                    }
                }
            }
        }
        Some((0..n).map(|i| b[i] / a[i][i]).collect())
    }

    pub(crate) fn row_transform(j: &Joint, v: f64) -> Mat4 {
        let pre = mul(&rotx(j.alpha), &transl(j.a, 0.0, 0.0));
        let pre = match &j.pre {
            Some(p) => mul(p, &pre),
            None => pre,
        };
        match j.kind {
            JointKind::Rotary => mul(&pre, &mul(&rotz(j.theta + v.to_radians()), &transl(0.0, 0.0, j.d))),
            JointKind::Linear => mul(&pre, &mul(&rotz(j.theta), &transl(0.0, 0.0, j.d + v))),
        }
    }

    
    pub fn serial_frames(&self, q: &[f64]) -> Vec<Mat4> {
        let v = self.internal(q);
        let mut out = Vec::with_capacity(self.joints.len() + 1);
        let mut t = self.base;
        out.push(t);
        for (i, j) in self.joints.iter().enumerate() {
            t = mul(&t, &Self::row_transform(j, v[i]));
            out.push(t);
        }
        out
    }

    
    
    
    pub fn link_frames(&self, q: &[f64]) -> Vec<Mat4> {
        use crate::mechanism as mech;
        let (mut frames, flange) = match self.family() {
            Family::Delta => mech::Delta::of(self).frames(self, q),
            Family::PlanarDelta => mech::PlanarDelta::of(self).frames(self, q),
            Family::Gripper => mech::gripper_frames(self, q),
            Family::Cartesian => mech::cartesian_frames(self, q),
            Family::Serial => {
                let mut f = self.serial_frames(q);
                let flange = mul(f.last().unwrap(), &self.flange);
                let n0 = f.len();
                if self.nlinks > n0 {
                    let extra = mech::passive_frames(self, &f);
                    let last = *f.last().unwrap();
                    f.resize(self.nlinks, last);
                    for (i, t) in extra {
                        if i >= n0 && i < self.nlinks {
                            f[i] = t;
                        }
                    }
                }
                (f, flange)
            }
        };
        frames.push(flange);
        frames
    }

    pub fn fk(&self, q: &[f64]) -> Mat4 {
        *self.link_frames(q).last().unwrap()
    }

    fn inside_polygon(&self, q2: f64, q3: f64) -> bool {
        let p = &self.polygon;
        if p.len() < 3 {
            return true;
        }
        let mut inside = false;
        let mut j = p.len() - 1;
        for i in 0..p.len() {
            let (xi, yi) = (p[i][0], p[i][1]);
            let (xj, yj) = (p[j][0], p[j][1]);
            if ((yi > q3) != (yj > q3)) && (q2 < (xj - xi) * (q3 - yi) / (yj - yi + 1e-300) + xi) {
                inside = !inside;
            }
            j = i;
        }
        inside || self.polygon_distance(q2, q3).0 < 1e-6
    }

    
    fn polygon_distance(&self, q2: f64, q3: f64) -> (f64, [f64; 2]) {
        let p = &self.polygon;
        let mut best = (f64::INFINITY, [q2, q3]);
        for i in 0..p.len() {
            let a = p[i];
            let b = p[(i + 1) % p.len()];
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let l2 = dx * dx + dy * dy;
            let t = if l2 > 0.0 { (((q2 - a[0]) * dx + (q3 - a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
            let c = [a[0] + t * dx, a[1] + t * dy];
            let d = ((q2 - c[0]).powi(2) + (q3 - c[1]).powi(2)).sqrt();
            if d < best.0 {
                best = (d, c);
            }
        }
        best
    }

    
    
    
    
    
    
    
    fn internal_limits(&self) -> bool {
        self.mech == 1
    }

    
    
    
    fn polygon_row(&self, j: usize) -> bool {
        !self.polygon.is_empty() && self.nq >= 3 && (j == 1 || j == 2)
    }

    pub fn within_limits(&self, q: &[f64], tol: f64) -> bool {
        let ok = if self.internal_limits() {
            let v = self.internal(q);
            self.joints.iter().zip(&v).enumerate().all(|(j, (jt, x))| {
                self.polygon_row(j) || (*x >= jt.lower.min(jt.upper) - tol && *x <= jt.upper.max(jt.lower) + tol)
            })
        } else {
            (0..self.nq).all(|k| {
                let x = q.get(k).copied().unwrap_or(0.0);
                x >= self.user_lower[k].min(self.user_upper[k]) - tol && x <= self.user_upper[k].max(self.user_lower[k]) + tol
            })
        };
        ok && (self.polygon.is_empty() || q.len() < 3 || self.inside_polygon(q[1], q[2]))
    }

    
    
    
    pub fn clamp(&self, q: &[f64]) -> Vec<f64> {
        let mut q: Vec<f64> = (0..self.nq).map(|k| q.get(k).copied().unwrap_or(0.0)).map(|x| if x.is_finite() { x } else { 0.0 }).collect();
        let user = |q: &mut Vec<f64>| {
            for k in 0..self.nq {
                q[k] = q[k].clamp(self.user_lower[k].min(self.user_upper[k]), self.user_upper[k].max(self.user_lower[k]));
            }
        };
        if self.internal_limits() {
            let v: Vec<f64> = self
                .internal(&q)
                .iter()
                .zip(&self.joints)
                .enumerate()
                .map(|(j, (x, jt))| if self.polygon_row(j) { *x } else { x.clamp(jt.lower.min(jt.upper), jt.upper.max(jt.lower)) })
                .collect();
            match self.user_from_internal(&v) {
                Some(u) => q = u,
                None => user(&mut q),
            }
        } else {
            user(&mut q);
        }
        if !self.polygon.is_empty() && self.nq >= 3 && !self.inside_polygon(q[1], q[2]) {
            let (_, c) = self.polygon_distance(q[1], q[2]);
            q[1] = c[0];
            q[2] = c[1];
        }
        q
    }

    fn numeric_jacobian(&self, q: &[f64], scale_rot: f64) -> (Mat4, Vec<[f64; 6]>) {
        let t0 = self.fk(q);
        let mut cols = Vec::with_capacity(q.len());
        let h: f64 = 1e-6;
        for i in 0..q.len() {
            let mut qp = q.to_vec();
            let rotary = (0..self.joints.len()).any(|j| self.map[j * self.nq + i] != 0.0 && self.joints[j].kind == JointKind::Rotary);
            let step = if rotary { h.to_degrees() } else { h * 1000.0 };
            qp[i] += step;
            let t1 = self.fk(&qp);
            let r = rot_error(&t0, &t1);
            cols.push([
                (t1[3] - t0[3]) / step,
                (t1[7] - t0[7]) / step,
                (t1[11] - t0[11]) / step,
                r[0] * scale_rot / step,
                r[1] * scale_rot / step,
                r[2] * scale_rot / step,
            ]);
        }
        (t0, cols)
    }

    
    pub fn ik_numeric(&self, target: &Mat4, seed: &[f64], max_iter: usize) -> Option<Vec<f64>> {
        let n = self.dof();
        let scale_rot = 300.0;
        let mut q = seed.to_vec();
        q.resize(n, 0.0);
        let mut lambda = 1.0;
        let err_of = |t: &Mat4| {
            let r = rot_error(t, target);
            [target[3] - t[3], target[7] - t[7], target[11] - t[11], r[0] * scale_rot, r[1] * scale_rot, r[2] * scale_rot]
        };
        for _ in 0..max_iter {
            let (t, cols) = self.numeric_jacobian(&q, scale_rot);
            let e = err_of(&t);
            let err = e.iter().map(|x| x * x).sum::<f64>().sqrt();
            if err < 1e-7 {
                return Some(q);
            }
            let mut a = [[0.0f64; 6]; 6];
            for r_ in 0..6 {
                for c in 0..6 {
                    a[r_][c] = cols.iter().map(|col| col[r_] * col[c]).sum::<f64>();
                }
                a[r_][r_] += lambda * lambda;
            }
            let y = solve6(a, e)?;
            let dq: Vec<f64> = cols.iter().map(|col| (0..6).map(|k| col[k] * y[k]).sum()).collect();
            let trial: Vec<f64> = q.iter().zip(&dq).map(|(a, b)| a + b).collect();
            let et = err_of(&self.fk(&trial));
            if et.iter().map(|x| x * x).sum::<f64>().sqrt() < err {
                q = trial;
                lambda = (lambda * 0.5).max(1e-6);
            } else {
                lambda = (lambda * 4.0).min(1e6);
            }
        }
        let (dp, dr) = pose_distance(&self.fk(&q), target);
        (dp < 1e-4 && dr < 1e-7).then_some(q)
    }

    
    pub(crate) fn pure(&self) -> RobotModel {
        let n = self.joints.len();
        let mut map = vec![0.0; n * n];
        for i in 0..n {
            map[i * n + i] = 1.0;
        }
        RobotModel {
            base: self.base,
            flange: self.flange,
            joints: self.joints.iter().map(|j| Joint { lower: -1e9, upper: 1e9, ..j.clone() }).collect(),
            nq: n,
            map,
            user_lower: vec![-1e9; n],
            user_upper: vec![1e9; n],
            polygon: vec![],
            mech: self.mech,
            nlinks: self.joints.len() + 1,
            params: vec![],
        }
    }

    
    fn spherical_wrist_offset(&self) -> Option<[f64; 3]> {
        if self.joints.len() != 6 || self.joints.iter().any(|j| j.kind != JointKind::Rotary) {
            return None;
        }
        let probes: [[f64; 6]; 3] = [[10.0, -20.0, 15.0, 0.0, 0.0, 0.0], [10.0, -20.0, 15.0, 70.0, -40.0, 25.0], [10.0, -20.0, 15.0, -120.0, 65.0, -150.0]];
        let mut local: Option<[f64; 3]> = None;
        let w0 = pos(&self.link_frames(&probes[0])[4]);
        for p in probes.iter() {
            let frames = self.link_frames(p);
            let w = pos(&frames[4]);
            if (0..3).any(|k| (w[k] - w0[k]).abs() > 1e-6) {
                return None;
            }
            for f in [frames[5], frames[6]] {
                let d = [w[0] - f[3], w[1] - f[7], w[2] - f[11]];
                let z = [f[2], f[6], f[10]];
                let c = [d[1] * z[2] - d[2] * z[1], d[2] * z[0] - d[0] * z[2], d[0] * z[1] - d[1] * z[0]];
                if (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt() > 1e-6 {
                    return None;
                }
            }
            let fi = inv(&frames[7]);
            let l = transform_point(&fi, &w);
            match local {
                None => local = Some(l),
                Some(prev) if (0..3).any(|k| (l[k] - prev[k]).abs() > 1e-6) => return None,
                _ => {}
            }
        }
        local
    }

    
    fn ik_spherical_internal(&self, target: &Mat4) -> Vec<Vec<f64>> {
        let pure = self.pure();
        let Some(wl) = pure.spherical_wrist_offset() else { return vec![] };
        let mut out = Vec::new();
        let wc = transform_point(target, &wl);
        let j = &pure.joints;
        let pre1 = mul(&pure.base, &mul(&rotx(j[0].alpha), &transl(j[0].a, 0.0, 0.0)));
        let p1 = transform_point(&inv(&pre1), &wc);
        let lateral = |q2: f64, q3: f64| -> [f64; 3] {
            let frames = pure.link_frames(&[0.0, q2, q3, 0.0, 0.0, 0.0]);
            transform_point(&inv(&pre1), &pos(&frames[4]))
        };
        let rot_back = |p: [f64; 3], ang: f64| -> [f64; 3] {
            let (s, c) = ang.sin_cos();
            [c * p[0] + s * p[1], -s * p[0] + c * p[1], p[2]]
        };
        let l0 = rot_back(lateral(0.0, 0.0), j[0].theta);
        let l1 = rot_back(lateral(37.0, -23.0), j[0].theta);
        if (l0[1] - l1[1]).abs() > 1e-6 {
            return out;
        }
        let e = l0[1];
        let r = (p1[0] * p1[0] + p1[1] * p1[1]).sqrt();
        if r < e.abs() - 1e-9 {
            return out;
        }
        let phi = p1[1].atan2(p1[0]);
        let asn = (e / r.max(1e-12)).clamp(-1.0, 1.0).asin();
        for t1 in [phi - asn, phi - (PI - asn)] {
            let v1 = (t1 - j[0].theta).to_degrees();
            let o2 = pos(&pure.link_frames(&[v1, 0.0, 0.0, 0.0, 0.0, 0.0])[2]);
            let dist2 = sq_dist(&wc, &o2);
            let f = |v3: f64| -> f64 {
                let fr = pure.link_frames(&[v1, 0.0, v3, 0.0, 0.0, 0.0]);
                sq_dist(&pos(&fr[4]), &pos(&fr[2]))
            };
            let (fa, fb, fc) = (f(0.0), f(90.0), f(-90.0));
            let a_ = 0.5 * (fb + fc);
            let b_ = fa - a_;
            let c_ = 0.5 * (fb - fc);
            let amp = (b_ * b_ + c_ * c_).sqrt();
            if amp < 1e-9 {
                continue;
            }
            let rhs = (dist2 - a_) / amp;
            if rhs.abs() > 1.0 + 1e-9 {
                continue;
            }
            let base_ang = c_.atan2(b_);
            let acs = rhs.clamp(-1.0, 1.0).acos();
            for x in [base_ang + acs, base_ang - acs] {
                let v3 = x.to_degrees();
                let fr = pure.link_frames(&[v1, 0.0, v3, 0.0, 0.0, 0.0]);
                let fi = inv(&fr[2]);
                let w_now = transform_point(&fi, &pos(&fr[4]));
                let w_tgt = transform_point(&fi, &wc);
                let v2 = (w_tgt[1].atan2(w_tgt[0]) - w_now[1].atan2(w_now[0])).to_degrees();
                for sol in pure.solve_wrist(target, [v1, v2, v3]) {
                    out.push(sol);
                }
            }
        }
        out
    }

    
    fn solve_wrist(&self, target: &Mat4, q123: [f64; 3]) -> Vec<Vec<f64>> {
        let mut out: Vec<Vec<f64>> = Vec::new();
         
        let vs = self.wrist_singular_v5(q123);
        let mut found: [Option<Vec<f64>>; 2] = [None, None];
        for (b, sign) in [1.0f64, -1.0].into_iter().enumerate() {
            let mut best: Option<(f64, Vec<f64>)> = None;
            for q4 in [-150.0, -90.0, -30.0, 30.0, 90.0, 150.0] {
                let seed = vec![q123[0], q123[1], q123[2], q4, vs + 45.0 * sign, 0.0];
                if let Some(q) = self.ik_wrist_only(target, &seed) {
                    let d5 = wrap180(q[4] - vs);
                    if d5.signum() == sign || d5.abs() < 1e-9 {
                        let cost = wrap180(q[3]).abs();
                        if best.as_ref().map_or(true, |(c, _)| cost < *c) {
                            best = Some((cost, q));
                        }
                    }
                }
            }
            found[b] = best.map(|(_, q)| q);
        }
         
         
         
        for b in 0..2 {
            if found[b].is_none() {
                if let Some(o) = found[1 - b].as_ref().filter(|o| self.wrist_singular_sign(o).is_none()) {
                    let twin = vec![o[0], o[1], o[2], wrap180(o[3] + 180.0), 2.0 * vs - o[4], wrap180(o[5] + 180.0)];
                    let (dp, dr) = pose_distance(&self.fk(&twin), target);
                    if dp < 1e-6 && dr < 1e-9 {
                        found[b] = Some(twin);
                    }
                }
            }
        }
        for mut q in found.into_iter().flatten() {
             
             
            if let Some(s) = self.wrist_singular_sign(&q) {
                q[5] -= s * q[3];
                q[3] = 0.0;
            }
            if !out.iter().any(|o| o.iter().zip(&q).all(|(a, b)| (wrap180(a - b)).abs() < 1e-6)) {
                out.push(q);
            }
        }
        out
    }

    
    
    fn wrist_singular_v5(&self, q123: [f64; 3]) -> f64 {
        let th0 = self.joints[4].theta.to_degrees();
        [0.0, 90.0, 180.0, -90.0]
            .into_iter()
            .map(|c| wrap180(c - th0))
            .find(|&v| self.wrist_singular_sign(&[q123[0], q123[1], q123[2], 30.0, v, 0.0]).is_some())
            .unwrap_or(wrap180(-th0))
    }

    
    
    pub(crate) fn wrist_singular_sign(&self, q: &[f64]) -> Option<f64> {
        if self.dof() != 6 || q.len() < 6 || self.joints.len() != 6 {
            return None;
        }
        let t = self.fk(q);
        [-1.0, 1.0].into_iter().find(|s| {
            let mut c = q.to_vec();
            c[3] += 10.0;
            c[5] += s * 10.0;
            let (dp, dr) = pose_distance(&self.fk(&c), &t);
            dp < 1e-6 && dr < 1e-9
        })
    }

    
    
    
    
    fn turn_into_limits(&self, q: Vec<f64>) -> Vec<f64> {
        if self.within_limits(&q, 1e-6) {
            return q;
        }
        for k in (0..self.nq).filter(|&k| self.turnable(k)) {
            for m in [360.0, -360.0, 720.0, -720.0] {
                let mut c = q.clone();
                c[k] += m;
                if self.within_limits(&c, 1e-6) {
                    return c;
                }
            }
        }
        q
    }

    fn ik_wrist_only(&self, target: &Mat4, seed: &[f64]) -> Option<Vec<f64>> {
        let mut q = seed.to_vec();
        let mut lambda = 0.1;
        for _ in 0..80 {
            let t = self.fk(&q);
            let r = rot_error(&t, target);
            let err = (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]).sqrt();
            if err < 1e-12 {
                break;
            }
            let h = 1e-6f64;
            let mut cols = [[0.0f64; 3]; 3];
            for k in 0..3 {
                let mut qp = q.clone();
                qp[3 + k] += h.to_degrees();
                let r1 = rot_error(&t, &self.fk(&qp));
                cols[k] = [r1[0] / h, r1[1] / h, r1[2] / h];
            }
            let mut a = [[0.0f64; 3]; 3];
            let mut b = [0.0f64; 3];
            for i in 0..3 {
                for j in 0..3 {
                    a[i][j] = (0..3).map(|k| cols[i][k] * cols[j][k]).sum::<f64>();
                }
                a[i][i] += lambda;
                b[i] = (0..3).map(|k| cols[i][k] * r[k]).sum::<f64>();
            }
            let dq = solve3(a, b)?;
            let mut trial = q.clone();
            for k in 0..3 {
                trial[3 + k] += dq[k].to_degrees();
            }
            let rt = rot_error(&self.fk(&trial), target);
            if (rt[0] * rt[0] + rt[1] * rt[1] + rt[2] * rt[2]).sqrt() < err {
                q = trial;
                lambda = (lambda * 0.3).max(1e-13);
            } else {
                lambda *= 10.0;
            }
        }
        self.ik_numeric(target, &q, 30)
    }

    
    pub(crate) fn turnable(&self, k: usize) -> bool {
        let mut any = false;
        for j in 0..self.joints.len() {
            let g = self.map[j * self.nq + k];
            if g != 0.0 {
                any = true;
                if self.joints[j].kind != JointKind::Rotary || (g - g.round()).abs() > 1e-9 {
                    return false;
                }
            }
        }
        any
    }

    
    
    pub fn ik_primaries(&self, target: &Mat4) -> Vec<Vec<f64>> {
        match self.family() {
            Family::Delta => return crate::mechanism::Delta::of(self).ik(self, target).into_iter().collect(),
            Family::PlanarDelta => return crate::mechanism::PlanarDelta::of(self).ik(self, target).into_iter().collect(),
             
            Family::Gripper => return vec![],
            Family::Cartesian => {
                return crate::mechanism::cartesian_ik(self, target)
                    .iter()
                    .filter_map(|v| self.user_from_internal(v))
                    .filter(|q| {
                        let (dp, dr) = pose_distance(&self.fk(q), target);
                        dp < 1e-3 && dr < 1e-6
                    })
                    .collect()
            }
            Family::Serial => {}
        }
        if self.scara_axes().is_some() {
            return self.scara_branches(target);
        }
        if self.reduced6().is_some() {
            return self.primaries_ext(target).into_iter().map(|(q, _)| q).collect();
        }
        let mut prim: Vec<Vec<f64>> = Vec::new();
        let internal = if self.mech != 9 { self.ik_spherical_internal(target) } else { vec![] };
        if !internal.is_empty() && self.square_invertible() {
            for v in internal {
                if let Some(mut q) = self.user_from_internal(&v) {
                     
                     
                     
                    for k in 0..self.nq {
                        if self.turnable(k) {
                            q[k] = wrap180(q[k]);
                            let (lo, hi) = (self.user_lower[k].min(self.user_upper[k]), self.user_upper[k].max(self.user_lower[k]));
                            if q[k] < lo - 1e-6 || q[k] > hi + 1e-6 {
                                if let Some(t) = [360.0, -360.0, 720.0, -720.0].iter().map(|m| q[k] + m).find(|t| *t >= lo - 1e-6 && *t <= hi + 1e-6) {
                                    q[k] = t;
                                }
                            }
                        }
                    }
                    let q = self.turn_into_limits(q);
                    let (dp, dr) = pose_distance(&self.fk(&q), target);
                    if dp < 1e-3 && dr < 1e-6 && !prim.iter().any(|p| p.iter().zip(&q).all(|(a, b)| (a - b).abs() < 1e-6)) {
                        prim.push(q);
                    }
                }
            }
        }
        if prim.is_empty() {
             
             
             
             
             
             
            let n = self.dof();
            let mut seeds: Vec<Vec<f64>> = Vec::new();
            let mut upper: Vec<Vec<f64>> = Vec::new();
            if n == 6 {
                for j1 in [-135.0, -45.0, 45.0, 135.0] {
                    for j2 in [-135.0, -45.0, 45.0, 135.0] {
                        for j3 in [-90.0, 90.0] {
                            for j4 in [-90.0, 90.0] {
                                for j5 in [-90.0, 90.0] {
                                    (if j2 < 0.0 { &mut seeds } else { &mut upper }).push(vec![j1, j2, j3, j4, j5, 0.0]);
                                }
                            }
                        }
                    }
                }
            } else {
                let pattern = [-0.75, -0.25, 0.25, 0.75];
                for a in pattern {
                    for b in pattern {
                        for c in [-0.5, 0.5] {
                            seeds.push(
                                (0..n)
                                    .map(|i| {
                                        let (lo, hi) = (self.user_lower[i], self.user_upper[i]);
                                        0.5 * (lo + hi) + [a, b, c][i % 3] * 0.5 * (hi - lo)
                                    })
                                    .collect(),
                            );
                        }
                    }
                }
            }
            let same = |a: &[f64], b: &[f64]| {
                a.iter().zip(b).enumerate().all(|(k, (x, y))| {
                    let d = (x - y).abs();
                    d < 0.01 || (self.turnable(k) && ((d % 360.0) < 0.01 || (360.0 - d % 360.0) < 0.01))
                })
            };
            for (batch, grid) in [seeds, upper].iter().enumerate() {
                if batch > 0 && (prim.is_empty() || prim.len() >= 8) {
                    break;
                }
                for s in grid {
                    if let Some(mut q) = self.ik_numeric(target, s, 200) {
                        for k in 0..self.nq {
                            if self.turnable(k) {
                                q[k] = wrap180(q[k]);
                            }
                        }
                        if !prim.iter().any(|p| same(p, &q)) {
                            prim.push(q);
                        }
                    }
                }
            }
        }
        let mut keyed: Vec<(i32, Vec<f64>)> = prim
            .into_iter()
            .map(|q| {
                let c = self.config(&q);
                ((c[0] as i32) * 4 + (c[1] as i32) * 2 + c[2] as i32, q)
            })
            .collect();
        keyed.sort_by_key(|(k, _)| *k);
        keyed.into_iter().map(|(_, q)| q).collect()
    }

    
    pub(crate) fn primaries_ext(&self, target: &Mat4) -> Vec<(Vec<f64>, f64)> {
        let Some(red) = self.reduced6() else {
            return self.ik_primaries(target).into_iter().map(|q| (q, 0.0)).collect();
        };
        let mut keyed: Vec<(i32, Vec<f64>, f64)> = red
            .ik_primaries(target)
            .iter()
            .filter_map(|r| self.from_reduced(r))
            .map(|(q, x)| {
                let c = self.config(&q);
                ((c[0] as i32) * 4 + (c[1] as i32) * 2 + c[2] as i32, q, x)
            })
            .collect();
        keyed.sort_by_key(|k| k.0);
        keyed.into_iter().map(|(_, q, x)| (q, x)).collect()
    }

    
    pub fn ik_all(&self, target: &Mat4) -> Vec<(Vec<f64>, bool)> {
        self.ik_all_seeded(target, &[])
    }

    
    
    pub fn ik_all_seeded(&self, target: &Mat4, seed: &[f64]) -> Vec<(Vec<f64>, bool)> {
        self.ik_rows(target, seed).into_iter().map(|r| (r.q, r.primary)).collect()
    }

    
    
    pub(crate) fn turn_variants(&self, q: &[f64]) -> Vec<Vec<f64>> {
        if let Some(axis) = self.rotary_axis() {
             
            let mut out = Vec::new();
            for m in [0.0, 360.0, -360.0, 720.0, -720.0, 1080.0, -1080.0, 1440.0, -1440.0] {
                let c = self.turned(q, axis, m);
                if m == 0.0 || self.user_ok(&c) {
                    out.push(c);
                }
            }
            return out;
        }
        let turns: &[f64] = &[0.0, 360.0, -360.0, 720.0, -720.0];
        let mut acc: Vec<Vec<f64>> = vec![q.to_vec()];
        for k in 0..self.nq {
            if !self.turnable(k) {
                continue;
            }
            let mut next = Vec::new();
            for base in &acc {
                for &m in turns {
                    let mut c = base.clone();
                    c[k] += m;
                    let lo = self.user_lower[k].min(self.user_upper[k]) - 1e-6;
                    let hi = self.user_upper[k].max(self.user_lower[k]) + 1e-6;
                    if m == 0.0 || (c[k] >= lo && c[k] <= hi) {
                        next.push(c);
                    }
                }
            }
            acc = next;
        }
        acc
    }

    
    pub(crate) fn rotary_axis(&self) -> Option<usize> {
        match self.family() {
            Family::Delta if self.nq >= 4 => Some(3),
            Family::PlanarDelta if self.nq >= 3 => Some(2),
            _ => None,
        }
    }

    
    
    pub(crate) fn turned(&self, q: &[f64], k: usize, m: f64) -> Vec<f64> {
        let mut c = q.to_vec();
        c[k] += m;
        c
    }

    pub(crate) fn user_ok(&self, q: &[f64]) -> bool {
        q.iter().enumerate().all(|(k, v)| {
            let (lo, hi) = (self.user_lower[k].min(self.user_upper[k]), self.user_upper[k].max(self.user_lower[k]));
            *v >= lo - 1e-6 && *v <= hi + 1e-6
        })
    }

    
    
    
    fn nearest_turns(&self, q: &[f64], seed: &[f64]) -> Vec<f64> {
        let axes: Vec<usize> = match self.rotary_axis() {
            Some(a) => vec![a],
            None if self.family() == Family::Serial => (0..self.nq).filter(|&k| self.turnable(k)).collect(),
            None => vec![],
        };
        let mut c = q.to_vec();
        for k in axes {
            let Some(s) = seed.get(k) else { continue };
            let m0 = ((s - c[k]) / 360.0).round();
            let mut best: Option<(f64, Vec<f64>)> = None;
            for dm in [-1.0, 0.0, 1.0] {
                let t = self.turned(&c, k, (m0 + dm) * 360.0);
                if self.user_ok(&t) && best.as_ref().map_or(true, |(d, _)| (t[k] - s).abs() < *d) {
                    best = Some(((t[k] - s).abs(), t));
                }
            }
            if let Some((_, t)) = best {
                c = t;
            }
        }
        c
    }

    
    
    fn singular_from_seed(&self, q: Vec<f64>, seed: &[f64]) -> Vec<f64> {
        if let (Some(s), Some(&j4)) = (self.wrist_singular_sign(&q), seed.get(3)) {
            let mut c = q.clone();
            c[5] += s * (j4 - c[3]);
            c[3] = j4;
            if self.within_limits(&c, 1e-6) {
                return c;
            }
        }
        q
    }

    
    pub fn ik_closest(&self, target: &Mat4, seed: &[f64]) -> Option<Vec<f64>> {
        use crate::families::Solver;
        match self.solver() {
            Solver::Scara | Solver::Analytic => return self.ik_rows(target, seed).into_iter().next().map(|r| self.singular_from_seed(r.q, seed)),
            Solver::Iterative => return self.ik_iterative(target, seed),
            Solver::Gripper => return None,
            Solver::Delta => {}
        }
        let mut best: Option<(Vec<f64>, Vec<f64>)> = None;
        for (p, extra) in self.primaries_ext(target) {
            let mut cands = self.turn_variants(&p);
            cands.push(self.nearest_turns(&p, seed));
            for c in cands {
                if !self.within_limits(&c, 1e-6) {
                    continue;
                }
                 
                 
                let mut d: Vec<f64> = c.iter().zip(seed).map(|(a, b)| (a - b).abs()).collect();
                d.push(extra);
                d.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
                let better = |prev: &Vec<f64>| {
                    for (x, y) in d.iter().zip(prev) {
                        if *x < *y - 1e-9 {
                            return true;
                        }
                        if *x > *y + 1e-9 {
                            return false;
                        }
                    }
                    false
                };
                if best.as_ref().map_or(true, |(bd, _)| better(bd)) {
                    best = Some((d, c));
                }
            }
        }
        best.map(|(_, q)| q)
    }

    
    
    
    
    
    
    
    
    
    
    
    
    pub fn config(&self, q: &[f64]) -> [f64; 4] {
        let nj = self.joints.len();
        let b = |x: bool| x as i32 as f64;
        let qa = |k: usize| q.get(k).copied().unwrap_or(0.0);
        let n = self.nq;
        if self.family() != Family::Serial || (n == 7 && !matches!(self.mech, 3 | -3)) {
            return [0.0; 4];
        }
        if self.mech == 2 {
            let elbow = (0..nj).filter(|&j| self.joints[j].kind == JointKind::Rotary).nth(1);
            return [0.0, 0.0, b(elbow.is_some_and(|j| qa(j) > 0.0)), 0.0];
        }
        if nj < 5 && self.mech != 9 {
            return [0.0, 0.0, b(qa(1) > 0.0), 0.0];
        }
        let mut qr = q.to_vec();
        if n == 7 {
            qr[2] = 0.0;
        }
        let f = self.serial_frames(&qr);
        let f1 = mul(&f[1], &rotz(-self.joints[0].theta));
        let rear = b(transform_point(&inv(&f1), &pos(&f[n.min(5).min(nj)]))[0] < 0.0);
        let v = self.internal(q);
        let th = |j: usize| self.joints[j].theta.to_degrees() + v[j];
        let thr = |j: usize| -(self.joints[j].d.atan2(self.joints[j].a)).to_degrees();
        let elbow = |j: usize| {
            let t = wrap180(th(j));
            t <= thr(j + 1) || t > 90.0
        };
        let lower = match self.mech {
            6 | -6 => qa(2) < 0.0,
            3 => transform_point(&inv(&f[3]), &pos(&f[6]))[0] < 0.0,
            -3 => elbow(3),
             
             
             
             
             
            1 | -1 | 4 | -4 => {
                let t = self.joints[2].theta + (v[2] * PI) / 180.0;
                let t = if t <= PI / 2.0 { t } else { t - 2.0 * PI };
                (t * 180.0) / PI < (self.joints[3].a.atan2(self.joints[3].d) * 180.0) / PI - 90.0
            }
            _ => elbow(2),
        };
        let flip = match self.mech {
            _ if n == 7 => th(5) < 0.0,
            9 => false,
            6 | -6 => qa(4) < 0.0,
            8 | -8 => th(4) < 0.0,
            _ => wrap180(th(4)) < 0.0,
        };
        [rear, b(lower), b(flip), 0.0]
    }
}

pub fn wrap180(a: f64) -> f64 {
    let mut x = (a + 180.0).rem_euclid(360.0) - 180.0;
    if x <= -180.0 {
        x += 360.0;
    }
    x
}

fn transform_point(m: &Mat4, p: &[f64; 3]) -> [f64; 3] {
    [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ]
}

fn sq_dist(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

fn solve6(mut a: [[f64; 6]; 6], mut b: [f64; 6]) -> Option<[f64; 6]> {
    for col in 0..6 {
        let piv = (col..6).max_by(|&x, &y| a[x][col].abs().total_cmp(&a[y][col].abs()))?;
        if a[piv][col].abs() < 1e-15 {
            return None;
        }
        a.swap(col, piv);
        b.swap(col, piv);
        for r in 0..6 {
            if r != col {
                let f = a[r][col] / a[col][col];
                for c in col..6 {
                    a[r][c] -= f * a[col][c];
                }
                b[r] -= f * b[col];
            }
        }
    }
    let mut x = [0.0; 6];
    for i in 0..6 {
        x[i] = b[i] / a[i][i];
    }
    Some(x)
}

fn solve3(mut a: [[f64; 3]; 3], mut b: [f64; 3]) -> Option<[f64; 3]> {
    for col in 0..3 {
        let piv = (col..3).max_by(|&x, &y| a[x][col].abs().total_cmp(&a[y][col].abs()))?;
        if a[piv][col].abs() < 1e-18 {
            return None;
        }
        a.swap(col, piv);
        b.swap(col, piv);
        for r in 0..3 {
            if r != col {
                let f = a[r][col] / a[col][col];
                for c in col..3 {
                    a[r][c] -= f * a[col][c];
                }
                b[r] -= f * b[col];
            }
        }
    }
    Some([b[0] / a[0][0], b[1] / a[1][1], b[2] / a[2][2]])
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn irb120() -> RobotModel {
        let h = PI / 2.0;
        let rows = [
            (0.0, 0.0, 0.0, 290.0, -165.0, 165.0),
            (-h, 0.0, -h, 0.0, -110.0, 110.0),
            (0.0, 270.0, 0.0, 0.0, -90.0, 70.0),
            (-h, 70.0, 0.0, 302.0, -160.0, 160.0),
            (h, 0.0, 0.0, 0.0, -120.0, 120.0),
            (-h, 0.0, PI, 72.0, -400.0, 400.0),
        ];
        let mut map = vec![0.0; 36];
        for i in 0..6 {
            map[i * 6 + i] = 1.0;
        }
        RobotModel {
            base: IDENTITY,
            flange: IDENTITY,
            joints: rows.iter().map(|r| Joint { kind: JointKind::Rotary, alpha: r.0, a: r.1, theta: r.2, d: r.3, lower: r.4, upper: r.5, pre: None }).collect(),
            nq: 6,
            map,
            user_lower: rows.iter().map(|r| r.4).collect(),
            user_upper: rows.iter().map(|r| r.5).collect(),
            polygon: vec![],
            mech: 1,
            nlinks: 7,
            params: vec![],
        }
    }

    #[test]
    fn fk_matches_reference_probe() {
        let t = irb120().fk(&[10.0, -20.0, 30.0, -40.0, 50.0, -60.0]);
        let expect = [-0.167, -0.776, 0.609, 257.738, -0.913, -0.111, -0.393, 9.446, 0.372, -0.621, -0.69, 510.566];
        for (i, e) in expect.iter().enumerate() {
            assert!((t[i] - e).abs() < 1e-3, "element {i}: {} vs {}", t[i], e);
        }
    }

    #[test]
    fn ik_recovers_joints() {
        let m = irb120();
        let q = [10.0, -20.0, 30.0, -40.0, 50.0, -60.0];
        let sol = m.ik_closest(&m.fk(&q), &q).expect("solution");
        for i in 0..6 {
            assert!((sol[i] - q[i]).abs() < 1e-4, "joint {i}: {} vs {}", sol[i], q[i]);
        }
    }

    #[test]
    fn ik_all_matches_reference_count_for_probe_pose() {
         
        let m = irb120();
        let all = m.ik_all(&m.fk(&[10.0, -20.0, 30.0, -40.0, 50.0, -60.0]));
        assert_eq!(all.len(), 4, "{:?}", all);
    }

    #[test]
    fn ik_all_abb_reference_pose_has_ten_rows() {
         
        let m = irb120();
        let all = m.ik_all(&m.fk(&[30.0, 40.0, -50.0, 100.0, -60.0, 200.0]));
        assert_eq!(all.len(), 10, "{:?}", all);
    }

    #[test]
    fn unreachable_has_no_solution() {
        assert!(irb120().ik_all(&transl(5000.0, 0.0, 0.0)).is_empty());
    }

    #[test]
    fn clamp_matches_observed_limit_behaviour() {
        let m = irb120();
        assert_eq!(m.clamp(&[0.0, 0.0, 0.0, 0.0, 0.0, 9999.0]), vec![0.0, 0.0, 0.0, 0.0, 0.0, 400.0]);
        assert_eq!(m.clamp(&[200.0; 6]), vec![165.0, 110.0, 70.0, 160.0, 120.0, 200.0]);
        assert_eq!(m.clamp(&[1.0, 2.0, 3.0]), vec![1.0, 2.0, 3.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn wrist_singularity_matches_reference() {
         
        let m = irb120();
        let t = m.fk(&[10.0, 20.0, -10.0, 0.0, 0.0, 0.0]);
        let close = |a: &[f64], b: &[f64]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6);
        for (approx, want) in [
            ([10.0, 20.0, -10.0, 0.0, 0.0, 0.0], [10.0, 20.0, -10.0, 0.0, 0.0, 0.0]),
            ([10.0, 20.0, -10.0, 30.0, 5.0, -30.0], [10.0, 20.0, -10.0, 30.0, 0.0, -30.0]),
            ([10.0, 20.0, -10.0, -50.0, -3.0, 40.0], [10.0, 20.0, -10.0, -50.0, 0.0, 50.0]),
        ] {
            let got = m.ik_closest(&t, &approx).unwrap();
            assert!(close(&got, &want), "{approx:?} -> {got:?}");
        }
        let rows = m.ik_all(&t);
        assert!(!rows.is_empty() && rows.iter().all(|(q, _)| q[4].abs() > 1e-6 || q[3].abs() < 1e-6), "{rows:?}");
         
        let near = [10.0, 20.0, -10.0, 40.0, 0.001, -40.0];
        let got = m.ik_closest(&m.fk(&near), &near).unwrap();
        assert!(got.iter().zip(&near).all(|(x, y)| (x - y).abs() < 1e-5), "{got:?}");
    }

    #[test]
    fn enforced_limits_follow_the_mechanism_type() {
         
        let mut m = irb120();
        m.map[2 * 6 + 2] = -1.0;
        (m.joints[2].lower, m.joints[2].upper, m.user_lower[2], m.user_upper[2]) = (-175.0, 240.0, -175.0, 240.0);
        let q = |j3: f64| [0.0, 0.0, j3, 0.0, 0.0, 0.0];
        assert!(!m.within_limits(&q(220.0), 1e-6) && m.within_limits(&q(-200.0), 1e-6));
        assert_eq!(m.clamp(&q(220.0))[2], 175.0);
         
        m.mech = 8;
        assert!(m.within_limits(&q(220.0), 1e-6) && !m.within_limits(&q(-200.0), 1e-6));
        assert_eq!(m.clamp(&q(-200.0))[2], -175.0);
    }

    #[test]
    fn config_flags_for_home() {
        assert_eq!(irb120().config(&[0.0, 0.0, 0.0, 0.0, 30.0, 0.0]), [0.0, 0.0, 0.0, 0.0]);
        assert_eq!(irb120().config(&[0.0, 0.0, 0.0, 0.0, -30.0, 0.0])[2], 1.0);
    }

    
    
    #[test]
    fn config_lower_without_wrap_below_minus_180() {
        let r = irb120();
        let th3 = |q2: f64| r.joints[2].theta.to_degrees() + r.internal(&[0.0, 0.0, q2, 0.0, 30.0, 0.0])[2];
        let slope = th3(1.0) - th3(0.0);
        let j3 = |t: f64| (t - th3(0.0)) / slope;
        let lower = |t: f64| r.config(&[0.0, 0.0, j3(t), 0.0, 30.0, 0.0])[1];
        assert_eq!(lower(-104.0), 1.0);
        assert_eq!(lower(-284.0), 1.0);
        assert_eq!(lower(76.0), 0.0);
        assert_eq!(lower(120.0), 1.0);
    }
}
