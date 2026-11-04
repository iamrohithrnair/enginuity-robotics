

pub type V3 = [f64; 3];

#[inline]
pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
#[inline]
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline]
pub fn scale(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
#[inline]
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
#[inline]
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline]
pub fn norm(a: V3) -> f64 {
    dot(a, a).sqrt()
}
#[inline]
pub fn dist(a: V3, b: V3) -> f64 {
    norm(sub(a, b))
}
pub fn normalize(a: V3) -> Option<V3> {
    let n = norm(a);
    if n > 1e-12 && n.is_finite() {
        Some(scale(a, 1.0 / n))
    } else {
        None
    }
}
#[inline]
pub fn lerp(a: V3, b: V3, t: f64) -> V3 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}


pub fn perpendicular(z: V3) -> V3 {
    let a = if z[0].abs() < 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] };
    normalize(cross(cross(z, a), z)).unwrap_or([1.0, 0.0, 0.0])
}


#[derive(Clone, Copy, Debug)]
pub struct Frame {
    pub o: V3,
    pub x: V3,
    pub y: V3,
    pub z: V3,
}

impl Frame {
    pub const IDENTITY: Frame = Frame { o: [0.0; 3], x: [1.0, 0.0, 0.0], y: [0.0, 1.0, 0.0], z: [0.0, 0.0, 1.0] };

    
    
    pub fn from_axes(o: V3, z: Option<V3>, x: Option<V3>) -> Frame {
        let z = z.and_then(normalize).unwrap_or([0.0, 0.0, 1.0]);
        let x = x
            .and_then(|x| normalize(sub(x, scale(z, dot(x, z)))))
            .unwrap_or_else(|| perpendicular(z));
        let y = cross(z, x);
        Frame { o, x, y, z }
    }

    #[inline]
    pub fn to_world(&self, p: V3) -> V3 {
        [
            self.o[0] + self.x[0] * p[0] + self.y[0] * p[1] + self.z[0] * p[2],
            self.o[1] + self.x[1] * p[0] + self.y[1] * p[1] + self.z[1] * p[2],
            self.o[2] + self.x[2] * p[0] + self.y[2] * p[1] + self.z[2] * p[2],
        ]
    }
    #[inline]
    pub fn to_local(&self, p: V3) -> V3 {
        let d = sub(p, self.o);
        [dot(d, self.x), dot(d, self.y), dot(d, self.z)]
    }
}


#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Xform {
    pub m: [[f64; 4]; 3],
}

impl Xform {
    pub const IDENTITY: Xform = Xform { m: [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]] };

    pub fn from_frame(f: &Frame) -> Xform {
        Xform {
            m: [
                [f.x[0], f.y[0], f.z[0], f.o[0]],
                [f.x[1], f.y[1], f.z[1], f.o[1]],
                [f.x[2], f.y[2], f.z[2], f.o[2]],
            ],
        }
    }

    pub fn uniform_scale(s: f64) -> Xform {
        Xform { m: [[s, 0.0, 0.0, 0.0], [0.0, s, 0.0, 0.0], [0.0, 0.0, s, 0.0]] }
    }

    #[inline]
    pub fn apply(&self, p: V3) -> V3 {
        let m = &self.m;
        [
            m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
            m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
            m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
        ]
    }

    
    pub fn mul(&self, o: &Xform) -> Xform {
        let a = &self.m;
        let b = &o.m;
        let mut m = [[0.0; 4]; 3];
        for r in 0..3 {
            for c in 0..4 {
                let mut v = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
                if c == 3 {
                    v += a[r][3];
                }
                m[r][c] = v;
            }
        }
        Xform { m }
    }

    
    pub fn inverse_rigid(&self) -> Xform {
        let a = &self.m;
        let mut m = [[0.0; 4]; 3];
        for r in 0..3 {
            for c in 0..3 {
                m[r][c] = a[c][r];
            }
        }
        for r in 0..3 {
            m[r][3] = -(m[r][0] * a[0][3] + m[r][1] * a[1][3] + m[r][2] * a[2][3]);
        }
        Xform { m }
    }

    
    pub fn det(&self) -> f64 {
        let a = &self.m;
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
            + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    }
}
