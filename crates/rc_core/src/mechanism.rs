







use crate::math::*;
use crate::robot::RobotModel;
use std::f64::consts::PI;


pub const PARAM_LEN: usize = 160;


pub fn cell(m: &RobotModel, col: usize, row: usize) -> f64 {
    let i = match col {
        10..=14 => (col - 10) * 20 + row,
        53..=55 => 100 + (col - 53) * 20 + row,
        _ => return 0.0,
    };
    if row >= 20 {
        return 0.0;
    }
    m.params.get(i).copied().unwrap_or(0.0)
}

pub fn transform_point(m: &Mat4, p: &[f64; 3]) -> [f64; 3] {
    [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ]
}

fn rot_only(m: &Mat4) -> Mat4 {
    let mut r = *m;
    r[3] = 0.0;
    r[7] = 0.0;
    r[11] = 0.0;
    r
}

fn at(m: &Mat4, p: [f64; 3]) -> Mat4 {
    let mut r = *m;
    r[3] = p[0];
    r[7] = p[1];
    r[11] = p[2];
    r
}

fn col(m: &Mat4, c: usize) -> [f64; 3] {
    [m[c], m[4 + c], m[8 + c]]
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: [f64; 3], s: f64) -> [f64; 3] {
    [a[0] * s, a[1] * s, a[2] * s]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn unit(a: [f64; 3]) -> [f64; 3] {
    let n = dot(a, a).sqrt();
    if n < 1e-15 {
        a
    } else {
        scale(a, 1.0 / n)
    }
}


fn from_axes(x: [f64; 3], y: [f64; 3], z: [f64; 3], p: [f64; 3]) -> Mat4 {
    [x[0], y[0], z[0], p[0], x[1], y[1], z[1], p[1], x[2], y[2], z[2], p[2], 0.0, 0.0, 0.0, 1.0]
}

 












pub fn passive_frames(m: &RobotModel, serial: &[Mat4]) -> Vec<(usize, Mat4)> {
    let mut out = Vec::new();
    if serial.len() < 4 {
        return out;
    }
    let (f1, f2, f3) = (&serial[1], &serial[2], &serial[3]);
    let c = |col: usize, row: usize| cell(m, col, row);
    if c(53, 0) >= 1.0 {
        let a = [c(53, 2), 0.0, c(53, 3)];
        let b1 = transform_point(&inv(f1), &transform_point(f2, &[c(53, 4), c(53, 5), 0.0]));
        let r = roty(-(b1[2] - a[2]).atan2(b1[0] - a[0]));
        out.push((c(53, 0) as usize - 1, mul(f1, &mul(&transl(a[0], a[1], a[2]), &r))));
        out.push((c(53, 1) as usize - 1, mul(f1, &mul(&transl(b1[0], b1[1], b1[2]), &r))));
    }
    if c(54, 0) >= 1.0 {
        let (l2, l1) = (c(54, 2), c(54, 3));
        let b = transform_point(&inv(f2), &transform_point(f3, &[c(54, 4), c(54, 5), 0.0]));
        let d = (b[0] * b[0] + b[1] * b[1]).sqrt().max(1e-12);
        let (ex, ey) = (b[0] / d, b[1] / d);
        let a = (l1 * l1 - l2 * l2 + d * d) / (2.0 * d);
        let h2 = l1 * l1 - a * a;
         
        let (cx, cy) = if h2 < 0.0 { (l1 * ex, l1 * ey) } else { (a * ex + h2.sqrt() * ey, a * ey - h2.sqrt() * ex) };
        out.push((c(54, 0) as usize - 1, mul(f2, &rotz(cy.atan2(cx)))));
        out.push((c(54, 1) as usize - 1, mul(f2, &mul(&transl(b[0], b[1], b[2]), &rotz((cy - b[1]).atan2(cx - b[0]))))));
    }
    if c(55, 0) >= 1.0 {
        let rear = at(&rot_only(f2), transform_point(f1, &[c(55, 3), 0.0, c(55, 4)]));
        let plate = at(&rot_only(f1), pos(f3));
        let front = at(&mul(&rot_only(f3), &rotx(PI / 2.0)), transform_point(&plate, &[c(55, 5), 0.0, c(55, 6)]));
        out.push((c(55, 0) as usize - 1, rear));
        out.push((c(55, 1) as usize - 1, plate));
        out.push((c(55, 2) as usize - 1, front));
    }
    out
}

 









pub struct Delta {
    r_base: f64,
    r_plat: f64,
    rf: f64,
    re: f64,
    w: f64,
    mirror: bool,
    theta0: [f64; 3],
    offset: [f64; 3],
    plat_rx: f64,
    keep_h6_rot: bool,
    theta4: f64,
    rx5: f64,
    theta5: f64,
    k45: f64,
}

const ARM_DEG: [f64; 3] = [0.0, -120.0, 120.0];

impl Delta {
    
    
    pub fn rotary_offset(&self) -> f64 {
        self.theta4
    }

    pub fn of(m: &RobotModel) -> Delta {
        let c = |col: usize, row: usize| cell(m, col, row);
        let s3 = 2.0 * 3f64.sqrt();
        Delta {
            r_base: c(10, 5) / s3,
            r_plat: c(10, 6) / s3,
            rf: c(10, 7),
            re: c(10, 8),
            w: c(10, 9),
            mirror: c(10, 10) != 0.0,
            theta0: [c(10, 2), c(11, 2), c(12, 2)],
            offset: [c(12, 5), c(12, 6), c(12, 7)],
            plat_rx: c(13, 8),
            keep_h6_rot: c(10, 13) == 0.0,
            theta4: c(13, 2),
            rx5: c(14, 8),
            theta5: c(14, 2),
            k45: c(10, 12),
        }
    }

    fn order(&self) -> [usize; 3] {
        if self.mirror {
            [0, 2, 1]
        } else {
            [0, 1, 2]
        }
    }

    fn sense(&self) -> f64 {
        if self.mirror {
            -1.0
        } else {
            1.0
        }
    }

    fn shoulder(&self, m: &RobotModel, i: usize) -> Mat4 {
        mul(&mul(&m.base, &rotz(ARM_DEG[i].to_radians())), &transl(self.r_base, 0.0, 0.0))
    }

    
    
    fn platform(&self, m: &RobotModel, elbows: &[[f64; 3]; 3]) -> Option<[f64; 3]> {
        let mut centres = [[0.0; 3]; 3];
        for i in 0..3 {
            let b = mul(&m.base, &rotz(ARM_DEG[i].to_radians()));
            centres[i] = sub(elbows[i], scale(col(&b, 0), self.r_plat));
        }
        let (c0, c1, c2) = (centres[0], centres[1], centres[2]);
        let ex = unit(sub(c1, c0));
        let i_ = dot(ex, sub(c2, c0));
        let ey = unit(sub(sub(c2, c0), scale(ex, i_)));
        let ez = cross(ex, ey);
        let d = dot(sub(c1, c0), sub(c1, c0)).sqrt();
        let j = dot(ey, sub(c2, c0));
        if d < 1e-12 || j.abs() < 1e-12 {
            return None;
        }
        let x = d / 2.0;
        let y = (i_ * i_ + j * j) / (2.0 * j) - i_ * x / j;
        let z2 = self.re * self.re - x * x - y * y;
        if z2 < -1e-6 {
            return None;
        }
        let z = z2.max(0.0).sqrt();
        let base = add(c0, add(scale(ex, x), scale(ey, y)));
        let (p1, p2) = (add(base, scale(ez, z)), add(base, scale(ez, -z)));
        let zax = col(&m.base, 2);
        Some(if dot(p1, zax) < dot(p2, zax) { p1 } else { p2 })
    }

    
    pub fn frames(&self, m: &RobotModel, q: &[f64]) -> (Vec<Mat4>, Mat4) {
        let qv = |k: usize| q.get(k).copied().unwrap_or(0.0);
        let mut frames = vec![m.base];
        let mut elbows = [[0.0; 3]; 3];
        let order = self.order();
        for i in 0..3 {
            let th = self.sense() * (qv(order[i]) + self.theta0[i]);
            let t = mul(&mul(&self.shoulder(m, i), &roty(th.to_radians())), &transl(self.rf, 0.0, 0.0));
            elbows[i] = pos(&t);
            frames.push(t);
        }
        let p = self.platform(m, &elbows).unwrap_or_else(|| pos(&m.base));
        for i in 0..3 {
            let b = mul(&m.base, &rotz(ARM_DEG[i].to_radians()));
            let axis = col(&b, 1);
            let joint = add(p, scale(col(&b, 0), self.r_plat));
            for sg in [1.0, -1.0] {
                let lower = add(joint, scale(axis, sg * self.w / 2.0));
                let upper = add(elbows[i], scale(axis, sg * self.w / 2.0));
                let x = unit(sub(upper, lower));
                let z = unit(cross(x, axis));
                frames.push(from_axes(x, cross(z, x), z, lower));
            }
        }
        let rb = rot_only(&m.base);
        let core = at(&mul(&rb, &rotx(self.plat_rx)), add(p, transform_point(&rb, &self.offset)));
        frames.push(if self.keep_h6_rot { mul(&core, &rot_only(&m.flange)) } else { core });
        let mut last = core;
        if m.nq >= 4 {
            last = mul(&last, &rotz((qv(3) + self.theta4).to_radians()));
            frames.push(last);
        }
        if m.nq >= 5 {
            last = mul(&last, &mul(&rotx(self.rx5), &rotz((qv(4) + self.k45 * qv(3) + self.theta5).to_radians())));
            frames.push(last);
        }
        let fk = mul(&last, &m.flange);
        if self.keep_h6_rot && frames.len() > 11 {
            let n = frames.len();
            frames[n - 1] = fk;
        }
        while frames.len() < m.nlinks {
            frames.push(fk);
        }
        frames.truncate(m.nlinks.max(1));
        (frames, fk)
    }

    
    
    
    pub fn ik(&self, m: &RobotModel, target: &Mat4) -> Option<Vec<f64>> {
        let w = mul(target, &inv(&m.flange));
        let rb = rot_only(&m.base);
        let r_core = mul(&rb, &rotx(self.plat_rx));
        let rel = mul(&inv(&r_core), &rot_only(&w));
        let mut q = vec![0.0; m.nq];
        if m.nq == 4 {
            q[3] = crate::robot::wrap180(rel[4].atan2(rel[0]).to_degrees() - self.theta4);
        } else if m.nq >= 5 {
             
             
            let th4 = rel[2].atan2(-rel[6]).to_degrees();
            let th5 = rel[8].atan2(rel[9]).to_degrees();
            let q4 = (th4 - self.theta4).rem_euclid(360.0);
            q[3] = crate::robot::wrap180(q4);
            q[4] = crate::robot::wrap180(th5 - self.theta5 - self.k45 * q4);
        }
        let p = sub(pos(&w), transform_point(&rb, &self.offset));
        let order = self.order();
        for i in 0..3 {
            let sh = self.shoulder(m, i);
            let b = mul(&m.base, &rotz(ARM_DEG[i].to_radians()));
            let joint = add(p, scale(col(&b, 0), self.r_plat));
            let jl = transform_point(&inv(&sh), &joint);
            let (jx, jz) = (jl[0], jl[2]);
            let k = (self.re * self.re - self.rf * self.rf - dot(jl, jl)) / (2.0 * self.rf);
            let rho = (jx * jx + jz * jz).sqrt();
            if rho < 1e-12 || k.abs() > rho + 1e-9 {
                return None;
            }
             
             
            let phi0 = jx.atan2(jz);
            let th = (phi0 + PI - (k / rho).clamp(-1.0, 1.0).asin()).to_degrees();
            q[order[i]] = self.sense() * crate::robot::wrap180(th) - self.theta0[i];
        }
        Some(q)
    }
}

 




pub struct PlanarDelta {
    r_base: f64,
    rf: f64,
    re: f64,
    offset: [f64; 3],
    plat_rx: f64,
}

impl PlanarDelta {
    pub fn of(m: &RobotModel) -> PlanarDelta {
        let c = |col: usize, row: usize| cell(m, col, row);
        PlanarDelta { r_base: c(10, 5), rf: c(10, 7), re: c(10, 8), offset: [c(11, 5), c(11, 6), c(11, 7)], plat_rx: c(12, 8) }
    }

    fn arms(&self, m: &RobotModel, q1: f64, q2: f64) -> [Mat4; 2] {
        [
            mul(&mul(&mul(&m.base, &transl(self.r_base, 0.0, 0.0)), &roty(q1.to_radians())), &transl(self.rf, 0.0, 0.0)),
            mul(&mul(&mul(&m.base, &transl(-self.r_base, 0.0, 0.0)), &roty(-q2.to_radians())), &transl(-self.rf, 0.0, 0.0)),
        ]
    }

    pub fn frames(&self, m: &RobotModel, q: &[f64]) -> (Vec<Mat4>, Mat4) {
        let qv = |k: usize| q.get(k).copied().unwrap_or(0.0);
        let arms = self.arms(m, qv(0), qv(1));
        let hb = inv(&m.base);
         
        let e1 = transform_point(&hb, &pos(&arms[0]));
        let e2 = transform_point(&hb, &pos(&arms[1]));
        let (dx, dz) = (e2[0] - e1[0], e2[2] - e1[2]);
        let d = (dx * dx + dz * dz).sqrt().max(1e-12);
        let h = (self.re * self.re - d * d / 4.0).max(0.0).sqrt();
        let (mx, mz) = ((e1[0] + e2[0]) / 2.0, (e1[2] + e2[2]) / 2.0);
        let (nx, nz) = (-dz / d, dx / d);
        let (p1, p2) = ([mx + nx * h, 0.0, mz + nz * h], [mx - nx * h, 0.0, mz - nz * h]);
        let pl = if p1[2] < p2[2] { p1 } else { p2 };
        let p = transform_point(&m.base, &pl);
        let mut frames = vec![m.base, arms[0], arms[1]];
        for e in [pos(&arms[0]), pos(&arms[1])] {
            let x = unit(sub(p, e));
            let y = col(&m.base, 1);
            frames.push(from_axes(x, y, cross(x, y), e));
        }
        let rb = rot_only(&m.base);
        frames.push(at(&rb, p));
        let core = mul(&at(&mul(&rb, &rotx(self.plat_rx)), add(p, transform_point(&rb, &self.offset))), &rotz(qv(2).to_radians()));
        let fk = mul(&core, &m.flange);
        frames.push(fk);
        while frames.len() < m.nlinks {
            frames.push(fk);
        }
        frames.truncate(m.nlinks.max(1));
        (frames, fk)
    }

    pub fn ik(&self, m: &RobotModel, target: &Mat4) -> Option<Vec<f64>> {
        let w = mul(target, &inv(&m.flange));
        let rb = rot_only(&m.base);
        let rel = mul(&inv(&mul(&rb, &rotx(self.plat_rx))), &rot_only(&w));
        let q3 = crate::robot::wrap180(rel[4].atan2(rel[0]).to_degrees());
        let pl = transform_point(&inv(&m.base), &sub(pos(&w), transform_point(&rb, &self.offset)));
        let mut q = vec![0.0; m.nq.max(3)];
        for (i, sx) in [(0usize, 1.0f64), (1, -1.0)] {
             
            let jx = sx * (pl[0] - sx * self.r_base);
            let jz = pl[2];
            let k = (self.re * self.re - self.rf * self.rf - jx * jx - jz * jz) / (2.0 * self.rf);
            let rho = (jx * jx + jz * jz).sqrt();
            if rho < 1e-12 || k.abs() > rho + 1e-9 {
                return None;
            }
            let th = (jx.atan2(jz) + PI - (k / rho).clamp(-1.0, 1.0).asin()).to_degrees();
            q[i] = crate::robot::wrap180(th);
        }
        q[2] = q3;
        Some(q)
    }
}

 





pub fn gripper_frames(m: &RobotModel, q: &[f64]) -> (Vec<Mat4>, Mat4) {
    let serial = m.serial_frames(q);
    let finger = serial.get(1).copied().unwrap_or(m.base);
    let mut frames = vec![IDENTITY, finger, mul(&rotz(PI), &finger)];
    while frames.len() < m.nlinks {
        frames.push(m.base);
    }
    frames.truncate(m.nlinks.max(1));
    (frames, m.flange)
}

 






pub fn is_cartesian(m: &RobotModel) -> bool {
    use crate::robot::JointKind::{Linear, Rotary};
    let kinds: Vec<_> = m.joints.iter().map(|j| j.kind).collect();
    match m.mech {
        21 => kinds == [Linear, Linear, Linear, Rotary],
        22 => kinds == [Linear, Linear, Linear, Rotary, Rotary, Rotary],
        _ => false,
    }
}

fn cartesian_turn(m: &RobotModel, j: usize, v: f64) -> Mat4 {
    if m.mech == 22 {
        let a = m.joints[j].theta + v.to_radians();
        match j {
            3 => rotx(a),
            4 => roty(a),
            _ => rotz(a),
        }
    } else {
        RobotModel::row_transform(&m.joints[j], v)
    }
}


pub fn cartesian_frames(m: &RobotModel, q: &[f64]) -> (Vec<Mat4>, Mat4) {
    let v = m.internal(q);
    let mut p = [0.0f64; 3];
    let mut frames = vec![m.base];
    let mut t = m.base;
    for j in 0..3 {
        p[j] = m.joints[j].d + v[j];
        t = mul(&m.base, &transl(p[0], p[1], p[2]));
        frames.push(t);
    }
    for j in 3..m.joints.len() {
        t = mul(&t, &cartesian_turn(m, j, v[j]));
        frames.push(t);
    }
    let flange = mul(&t, &m.flange);
    while frames.len() < m.nlinks {
        frames.push(t);
    }
    frames.truncate(m.nlinks.max(1));
    (frames, flange)
}



pub fn cartesian_ik(m: &RobotModel, target: &Mat4) -> Vec<Vec<f64>> {
    let w = mul(&inv(&m.base), &mul(target, &inv(&m.flange)));
    let mut turns: Vec<Vec<f64>> = Vec::new();
    if m.mech == 22 {
        let deg = |x: f64| x.to_degrees();
        let sb = w[2].clamp(-1.0, 1.0);
        if (1.0 - sb.abs()) < 1e-12 {
             
            let b = sb.asin();
            let a = (w[4] * sb).atan2(w[5]);
            turns.push(vec![deg(a), deg(b), 0.0]);
        } else {
            let b = sb.asin();
            let a = (-w[6]).atan2(w[10]);
            let c = (-w[1]).atan2(w[0]);
            turns.push(vec![deg(a), deg(b), deg(c)]);
            turns.push(vec![deg(a) + 180.0, 180.0 - deg(b), deg(c) + 180.0]);
        }
        for t in turns.iter_mut() {
            for (k, x) in t.iter_mut().enumerate() {
                *x = crate::robot::wrap180(*x - m.joints[3 + k].theta.to_degrees());
            }
        }
    } else {
        let j = &m.joints[3];
        let r = mul(&rotx(-j.alpha), &w);
        let phi = r[4].atan2(r[0]).to_degrees();
        turns.push(vec![crate::robot::wrap180(phi - j.theta.to_degrees())]);
    }
    let mut out = Vec::new();
    for t in turns {
        let mut tail = IDENTITY;
        for (k, x) in t.iter().enumerate() {
            tail = mul(&tail, &cartesian_turn(m, 3 + k, *x));
        }
        let mut v: Vec<f64> = (0..3).map(|j| [w[3] - tail[3], w[7] - tail[7], w[11] - tail[11]][j] - m.joints[j].d).collect();
        v.extend(t);
        out.push(v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::robot::{Joint, JointKind};

    fn model(mech: i32, rows: &[(JointKind, f64, f64, f64, f64)]) -> RobotModel {
        let n = rows.len();
        let mut map = vec![0.0; n * n];
        for i in 0..n {
            map[i * n + i] = 1.0;
        }
        RobotModel {
            base: IDENTITY,
            flange: IDENTITY,
            joints: rows
                .iter()
                .map(|r| Joint { kind: r.0, alpha: r.1.to_radians(), a: r.2, theta: r.3.to_radians(), d: r.4, lower: -1e9, upper: 1e9, pre: None })
                .collect(),
            nq: n,
            map,
            user_lower: vec![-170.0; n],
            user_upper: vec![170.0; n],
            polygon: vec![],
            mech,
            nlinks: n + 1,
            params: vec![],
        }
    }

    fn near(a: &Mat4, b: &[f64]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-6)
    }

     
    #[test]
    fn agv_type_21_moves_along_base_xyz() {
        use JointKind::*;
        let m = model(21, &[(Linear, 0.0, 0.0, 0.0, 100.0), (Linear, 0.0, 0.0, 0.0, 200.0), (Linear, 0.0, 0.0, 0.0, 300.0), (Rotary, 20.0, 0.0, 10.0, 0.0)]);
        let q = [-20.0, 20.0, 10.0, 0.0];
        let rdk = [0.984807753, -0.173648178, 0.0, 80.0, 0.163175911, 0.925416578, -0.342020143, 220.0, 0.059391175, 0.336824089, 0.939692621, 310.0, 0.0, 0.0, 0.0, 1.0];
        assert!(near(&m.fk(&q), &rdk));
        let f = m.link_frames(&q);
        assert_eq!(f.len(), 6);
        assert!(near(&f[1], &transl(80.0, 0.0, 0.0)) && near(&f[3], &transl(80.0, 220.0, 310.0)));
        let back = m.ik_closest(&m.fk(&q), &[0.0; 4]).unwrap();
        assert!(back.iter().zip(&q).all(|(a, b)| (a - b).abs() < 1e-6), "{back:?}");
         
        assert!(m.ik_closest(&mul(&m.fk(&q), &roty(0.3)), &[0.0; 4]).is_none());
    }

    #[test]
    fn six_axis_type_22_is_xyz_then_rx_ry_rz() {
        use JointKind::*;
        let m = model(22, &[(Linear, 0.0, 0.0, 0.0, 0.0), (Linear, 0.0, 0.0, 0.0, 0.0), (Linear, 0.0, 0.0, 0.0, 0.0), (Rotary, 0.0, 0.0, 0.0, 0.0), (Rotary, 0.0, 0.0, 0.0, 0.0), (Rotary, 0.0, 0.0, 0.0, 0.0)]);
        let q = [-20.0, 20.0, 10.0, 0.0, 40.0, 30.0];
        let rdk = [0.663413948, -0.383022222, 0.64278761, -20.0, 0.5, 0.866025404, 0.0, 20.0, -0.556670399, 0.321393805, 0.766044443, 10.0, 0.0, 0.0, 0.0, 1.0];
        assert!(near(&m.fk(&q), &rdk));
        let q2 = [5.0, -7.0, 9.0, 25.0, -35.0, 60.0];
        let t = m.fk(&q2);
        assert!(near(&t, &mul(&transl(5.0, -7.0, 9.0), &mul(&rotx(25f64.to_radians()), &mul(&roty(-35f64.to_radians()), &rotz(60f64.to_radians()))))));
        let back = m.ik_closest(&t, &[0.0; 6]).unwrap();
        assert!(back.iter().zip(&q2).all(|(a, b)| (a - b).abs() < 1e-6), "{back:?}");
         
        assert_eq!(m.ik_all(&t).len(), 2);
    }
}
