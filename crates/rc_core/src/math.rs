// Implements rigid transforms and pose interpolation for robot motion.



pub type Mat4 = [f64; 16];

pub const IDENTITY: Mat4 = [
    1.0, 0.0, 0.0, 0.0,  
    0.0, 1.0, 0.0, 0.0,  
    0.0, 0.0, 1.0, 0.0,  
    0.0, 0.0, 0.0, 1.0,
];

pub fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut r = [0.0; 16];
    for i in 0..4 {
        for j in 0..4 {
            let mut s = 0.0;
            for k in 0..4 {
                s += a[i * 4 + k] * b[k * 4 + j];
            }
            r[i * 4 + j] = s;
        }
    }
    r
}


pub fn inv(m: &Mat4) -> Mat4 {
    let mut r = IDENTITY;
    for i in 0..3 {
        for j in 0..3 {
            r[i * 4 + j] = m[j * 4 + i];
        }
    }
    for i in 0..3 {
        r[i * 4 + 3] = -(r[i * 4] * m[3] + r[i * 4 + 1] * m[7] + r[i * 4 + 2] * m[11]);
    }
    r
}

pub fn transl(x: f64, y: f64, z: f64) -> Mat4 {
    let mut m = IDENTITY;
    m[3] = x;
    m[7] = y;
    m[11] = z;
    m
}

pub fn rotx(a: f64) -> Mat4 {
    let (s, c) = a.sin_cos();
    [1.0, 0.0, 0.0, 0.0, 0.0, c, -s, 0.0, 0.0, s, c, 0.0, 0.0, 0.0, 0.0, 1.0]
}

pub fn roty(a: f64) -> Mat4 {
    let (s, c) = a.sin_cos();
    [c, 0.0, s, 0.0, 0.0, 1.0, 0.0, 0.0, -s, 0.0, c, 0.0, 0.0, 0.0, 0.0, 1.0]
}

pub fn rotz(a: f64) -> Mat4 {
    let (s, c) = a.sin_cos();
    [c, -s, 0.0, 0.0, s, c, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]
}

pub fn pos(m: &Mat4) -> [f64; 3] {
    [m[3], m[7], m[11]]
}


pub fn rot_error(a: &Mat4, b: &Mat4) -> [f64; 3] {
     
    let mut r = [[0.0f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            let mut s = 0.0;
            for k in 0..3 {
                s += b[i * 4 + k] * a[j * 4 + k];
            }
            r[i][j] = s;
        }
    }
    let tr = r[0][0] + r[1][1] + r[2][2];
    let cos_t = ((tr - 1.0) * 0.5).clamp(-1.0, 1.0);
    let theta = cos_t.acos();
    let v = [r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]];
    if theta < 1e-9 {
        return [v[0] * 0.5, v[1] * 0.5, v[2] * 0.5];
    }
    if (std::f64::consts::PI - theta) < 1e-6 {
         
        let xx = ((r[0][0] + 1.0) * 0.5).max(0.0).sqrt();
        let yy = ((r[1][1] + 1.0) * 0.5).max(0.0).sqrt();
        let zz = ((r[2][2] + 1.0) * 0.5).max(0.0).sqrt();
        let mut ax = [xx, yy, zz];
        if xx >= yy && xx >= zz {
            ax[1] = (r[0][1] + r[1][0]) / (4.0 * xx);
            ax[2] = (r[0][2] + r[2][0]) / (4.0 * xx);
        } else if yy >= zz {
            ax[0] = (r[0][1] + r[1][0]) / (4.0 * yy);
            ax[2] = (r[1][2] + r[2][1]) / (4.0 * yy);
        } else {
            ax[0] = (r[0][2] + r[2][0]) / (4.0 * zz);
            ax[1] = (r[1][2] + r[2][1]) / (4.0 * zz);
        }
        return [ax[0] * theta, ax[1] * theta, ax[2] * theta];
    }
    let k = theta / (2.0 * theta.sin());
    [v[0] * k, v[1] * k, v[2] * k]
}


pub fn pose_distance(a: &Mat4, b: &Mat4) -> (f64, f64) {
    let dp = [a[3] - b[3], a[7] - b[7], a[11] - b[11]];
    let e = rot_error(a, b);
    (
        (dp[0] * dp[0] + dp[1] * dp[1] + dp[2] * dp[2]).sqrt(),
        (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]).sqrt(),
    )
}


pub fn interpolate(a: &Mat4, b: &Mat4, t: f64) -> Mat4 {
    let e = rot_error(a, b);
    let ang = (e[0] * e[0] + e[1] * e[1] + e[2] * e[2]).sqrt();
    let mut r = *a;
    if ang > 1e-12 {
        let axis = [e[0] / ang, e[1] / ang, e[2] / ang];
        let rot = axis_angle(&axis, ang * t);
         
        for i in 0..3 {
            for j in 0..3 {
                let mut s = 0.0;
                for k in 0..3 {
                    s += rot[i * 4 + k] * a[k * 4 + j];
                }
                r[i * 4 + j] = s;
            }
        }
    }
    r[3] = a[3] + (b[3] - a[3]) * t;
    r[7] = a[7] + (b[7] - a[7]) * t;
    r[11] = a[11] + (b[11] - a[11]) * t;
    r
}

pub fn axis_angle(axis: &[f64; 3], angle: f64) -> Mat4 {
    let (s, c) = angle.sin_cos();
    let v = 1.0 - c;
    let (x, y, z) = (axis[0], axis[1], axis[2]);
    [
        x * x * v + c,
        x * y * v - z * s,
        x * z * v + y * s,
        0.0,
        x * y * v + z * s,
        y * y * v + c,
        y * z * v - x * s,
        0.0,
        x * z * v - y * s,
        y * z * v + x * s,
        z * z * v + c,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &Mat4, b: &Mat4, tol: f64) -> bool {
        a.iter().zip(b.iter()).all(|(x, y)| (x - y).abs() < tol)
    }

    #[test]
    fn inverse_roundtrip() {
        let m = mul(&mul(&transl(10.0, -20.0, 5.0), &rotz(0.7)), &rotx(-1.1));
        assert!(close(&mul(&m, &inv(&m)), &IDENTITY, 1e-12));
    }

    #[test]
    fn interpolation_endpoints() {
        let a = transl(0.0, 0.0, 0.0);
        let b = mul(&transl(100.0, 0.0, 0.0), &roty(1.0));
        assert!(close(&interpolate(&a, &b, 0.0), &a, 1e-12));
        assert!(close(&interpolate(&a, &b, 1.0), &b, 1e-9));
    }
}
