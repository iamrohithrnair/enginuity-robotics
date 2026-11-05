// Tests transformed mesh bounds and triangles for collisions.





use crate::math::Mat4;

#[derive(Clone, Copy, Debug)]
struct Aabb {
    min: [f64; 3],
    max: [f64; 3],
}

impl Aabb {
    fn empty() -> Self {
        Aabb { min: [f64::INFINITY; 3], max: [f64::NEG_INFINITY; 3] }
    }
    fn grow(&mut self, p: &[f64; 3]) {
        for k in 0..3 {
            self.min[k] = self.min[k].min(p[k]);
            self.max[k] = self.max[k].max(p[k]);
        }
    }
    fn merge(&mut self, o: &Aabb) {
        for k in 0..3 {
            self.min[k] = self.min[k].min(o.min[k]);
            self.max[k] = self.max[k].max(o.max[k]);
        }
    }
    fn inflate(&self, r: f64) -> Aabb {
        Aabb {
            min: [self.min[0] - r, self.min[1] - r, self.min[2] - r],
            max: [self.max[0] + r, self.max[1] + r, self.max[2] + r],
        }
    }
    fn overlaps(&self, o: &Aabb) -> bool {
        (0..3).all(|k| self.min[k] <= o.max[k] && o.min[k] <= self.max[k])
    }
    
    fn transformed(&self, m: &Mat4) -> Aabb {
        let mut out = Aabb::empty();
        for i in 0..8 {
            let p = [
                if i & 1 == 0 { self.min[0] } else { self.max[0] },
                if i & 2 == 0 { self.min[1] } else { self.max[1] },
                if i & 4 == 0 { self.min[2] } else { self.max[2] },
            ];
            out.grow(&xf(m, &p));
        }
        out
    }
}

fn xf(m: &Mat4, p: &[f64; 3]) -> [f64; 3] {
    [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ]
}

enum Node {
    Leaf { bb: Aabb, tris: Vec<u32> },
    Inner { bb: Aabb, left: Box<Node>, right: Box<Node> },
}

impl Node {
    fn bb(&self) -> &Aabb {
        match self {
            Node::Leaf { bb, .. } | Node::Inner { bb, .. } => bb,
        }
    }
}

pub struct Mesh {
    tris: Vec<[[f64; 3]; 3]>,
    root: Option<Node>,
}

impl Mesh {
    
    pub fn new(v: &[f32]) -> Mesh {
        let tris: Vec<[[f64; 3]; 3]> = v
            .chunks_exact(9)
            .map(|c| {
                [
                    [c[0] as f64, c[1] as f64, c[2] as f64],
                    [c[3] as f64, c[4] as f64, c[5] as f64],
                    [c[6] as f64, c[7] as f64, c[8] as f64],
                ]
            })
            .collect();
        let idx: Vec<u32> = (0..tris.len() as u32).collect();
        let root = if tris.is_empty() { None } else { Some(build(&tris, idx, 0)) };
        Mesh { tris, root }
    }

    pub fn triangle_count(&self) -> usize {
        self.tris.len()
    }
}

fn tri_box(t: &[[f64; 3]; 3]) -> Aabb {
    let mut b = Aabb::empty();
    for p in t {
        b.grow(p);
    }
    b
}

fn build(tris: &[[[f64; 3]; 3]], idx: Vec<u32>, depth: usize) -> Node {
    let mut bb = Aabb::empty();
    for &i in &idx {
        bb.merge(&tri_box(&tris[i as usize]));
    }
    if idx.len() <= 8 || depth > 40 {
        return Node::Leaf { bb, tris: idx };
    }
    let ext = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
    let axis = if ext[0] >= ext[1] && ext[0] >= ext[2] { 0 } else if ext[1] >= ext[2] { 1 } else { 2 };
    let mut keyed: Vec<(f64, u32)> = idx
        .iter()
        .map(|&i| {
            let t = &tris[i as usize];
            ((t[0][axis] + t[1][axis] + t[2][axis]) / 3.0, i)
        })
        .collect();
    keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mid = keyed.len() / 2;
    let left: Vec<u32> = keyed[..mid].iter().map(|k| k.1).collect();
    let right: Vec<u32> = keyed[mid..].iter().map(|k| k.1).collect();
    Node::Inner {
        bb,
        left: Box::new(build(tris, left, depth + 1)),
        right: Box::new(build(tris, right, depth + 1)),
    }
}




pub fn collide(a: &Mesh, pose_a: &Mat4, b: &Mesh, pose_b: &Mat4, clearance: f64) -> bool {
    let (Some(ra), Some(rb)) = (&a.root, &b.root) else { return false };
     
    let rel = crate::math::mul(&crate::math::inv(pose_a), pose_b);
    recurse(a, ra, b, rb, &rel, clearance)
}

fn recurse(a: &Mesh, na: &Node, b: &Mesh, nb: &Node, rel: &Mat4, clearance: f64) -> bool {
    let bb_b = nb.bb().transformed(rel);
    if !na.bb().inflate(clearance).overlaps(&bb_b) {
        return false;
    }
    match (na, nb) {
        (Node::Leaf { tris: ta, .. }, Node::Leaf { tris: tb, .. }) => {
            for &i in ta {
                let t1 = &a.tris[i as usize];
                let box1 = tri_box(t1).inflate(clearance);
                for &j in tb {
                    let tj = &b.tris[j as usize];
                    let t2 = [xf(rel, &tj[0]), xf(rel, &tj[1]), xf(rel, &tj[2])];
                    if !box1.overlaps(&tri_box(&t2)) {
                        continue;
                    }
                    if clearance > 0.0 {
                        if tri_tri_distance_below(t1, &t2, clearance) {
                            return true;
                        }
                    } else if tri_tri_intersect(t1, &t2) {
                        return true;
                    }
                }
            }
            false
        }
        (Node::Inner { left, right, .. }, Node::Leaf { .. }) => {
            recurse(a, left, b, nb, rel, clearance) || recurse(a, right, b, nb, rel, clearance)
        }
        (Node::Leaf { .. }, Node::Inner { left, right, .. }) => {
            recurse(a, na, b, left, rel, clearance) || recurse(a, na, b, right, rel, clearance)
        }
        (Node::Inner { left: la, right: ra, bb: bba }, Node::Inner { left: lb, right: rb, bb: bbb }) => {
             
            let va = vol(bba);
            let vb = vol(bbb);
            if va >= vb {
                recurse(a, la, b, nb, rel, clearance) || recurse(a, ra, b, nb, rel, clearance)
            } else {
                recurse(a, na, b, lb, rel, clearance) || recurse(a, na, b, rb, rel, clearance)
            }
        }
    }
}

fn vol(b: &Aabb) -> f64 {
    (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2])
}

fn sub(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn cross(a: &[f64; 3], b: &[f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn dot(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}



pub fn tri_tri_intersect(t1: &[[f64; 3]; 3], t2: &[[f64; 3]; 3]) -> bool {
    let e1 = [sub(&t1[1], &t1[0]), sub(&t1[2], &t1[1]), sub(&t1[0], &t1[2])];
    let e2 = [sub(&t2[1], &t2[0]), sub(&t2[2], &t2[1]), sub(&t2[0], &t2[2])];
    let n1 = cross(&e1[0], &e1[1]);
    let n2 = cross(&e2[0], &e2[1]);
    let mut axes: Vec<[f64; 3]> = vec![n1, n2];
    for a in &e1 {
        for b in &e2 {
            axes.push(cross(a, b));
        }
    }
    let n1n = dot(&n1, &n1).sqrt();
    let coplanar = n1n > 0.0 && dot(&cross(&n1, &n2), &cross(&n1, &n2)).sqrt() < 1e-12 * n1n * dot(&n2, &n2).sqrt().max(1e-30);
    if coplanar {
        for e in &e1 {
            axes.push(cross(&n1, e));
        }
        for e in &e2 {
            axes.push(cross(&n1, e));
        }
    }
    for ax in axes {
        let len2 = dot(&ax, &ax);
        if len2 < 1e-24 {
            continue;
        }
        let (mut a0, mut a1) = (f64::INFINITY, f64::NEG_INFINITY);
        for p in t1 {
            let d = dot(&ax, p);
            a0 = a0.min(d);
            a1 = a1.max(d);
        }
        let (mut b0, mut b1) = (f64::INFINITY, f64::NEG_INFINITY);
        for p in t2 {
            let d = dot(&ax, p);
            b0 = b0.min(d);
            b1 = b1.max(d);
        }
        let eps = 1e-9 * len2.sqrt();
        if a1 < b0 - eps || b1 < a0 - eps {
            return false;
        }
    }
    true
}



fn tri_tri_distance_below(t1: &[[f64; 3]; 3], t2: &[[f64; 3]; 3], r: f64) -> bool {
    if tri_tri_intersect(t1, t2) {
        return true;
    }
    let close = |p: &[f64; 3], t: &[[f64; 3]; 3]| point_tri_distance(p, t) < r;
    t1.iter().any(|p| close(p, t2)) || t2.iter().any(|p| close(p, t1))
}

fn point_tri_distance(p: &[f64; 3], t: &[[f64; 3]; 3]) -> f64 {
     
    let (a, b, c) = (&t[0], &t[1], &t[2]);
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ap = sub(p, a);
    let d1 = dot(&ab, &ap);
    let d2 = dot(&ac, &ap);
    let q: [f64; 3];
    if d1 <= 0.0 && d2 <= 0.0 {
        q = *a;
    } else {
        let bp = sub(p, b);
        let d3 = dot(&ab, &bp);
        let d4 = dot(&ac, &bp);
        if d3 >= 0.0 && d4 <= d3 {
            q = *b;
        } else {
            let vc = d1 * d4 - d3 * d2;
            if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
                let v = d1 / (d1 - d3);
                q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
            } else {
                let cp = sub(p, c);
                let d5 = dot(&ab, &cp);
                let d6 = dot(&ac, &cp);
                if d6 >= 0.0 && d5 <= d6 {
                    q = *c;
                } else {
                    let vb = d5 * d2 - d1 * d6;
                    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
                        let w = d2 / (d2 - d6);
                        q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
                    } else {
                        let va = d3 * d6 - d5 * d4;
                        if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
                            let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                            q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
                        } else {
                            let denom = 1.0 / (va + vb + vc);
                            let v = vb * denom;
                            let w = vc * denom;
                            q = [
                                a[0] + ab[0] * v + ac[0] * w,
                                a[1] + ab[1] * v + ac[1] * w,
                                a[2] + ab[2] * v + ac[2] * w,
                            ];
                        }
                    }
                }
            }
        }
    }
    let d = sub(p, &q);
    dot(&d, &d).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::{transl, IDENTITY};

    fn cube(size: f32) -> Vec<f32> {
        let s = size / 2.0;
        let v = [
            [-s, -s, -s],
            [s, -s, -s],
            [s, s, -s],
            [-s, s, -s],
            [-s, -s, s],
            [s, -s, s],
            [s, s, s],
            [-s, s, s],
        ];
        let f = [
            [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
            [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0],
        ];
        f.iter().flat_map(|t| t.iter().flat_map(|&i| v[i].to_vec())).collect()
    }

    #[test]
    fn overlapping_cubes_collide() {
        let a = Mesh::new(&cube(100.0));
        let b = Mesh::new(&cube(100.0));
        assert!(collide(&a, &IDENTITY, &b, &transl(60.0, 0.0, 0.0), 0.0));
        assert!(!collide(&a, &IDENTITY, &b, &transl(150.0, 0.0, 0.0), 0.0));
    }

    #[test]
    fn clearance_detects_near_miss() {
        let a = Mesh::new(&cube(100.0));
        let b = Mesh::new(&cube(100.0));
        assert!(!collide(&a, &IDENTITY, &b, &transl(105.0, 0.0, 0.0), 0.0));
        assert!(collide(&a, &IDENTITY, &b, &transl(105.0, 0.0, 0.0), 10.0));
    }
}
