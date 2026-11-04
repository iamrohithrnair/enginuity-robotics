


use crate::math::V3;


fn find_span(n_ctrl: usize, p: usize, u: f64, k: &[f64]) -> usize {
    let n = n_ctrl - 1;
    if u >= k[n + 1] {
        return n;
    }
    if u <= k[p] {
        return p;
    }
    let (mut lo, mut hi) = (p, n + 1);
    let mut mid = (lo + hi) / 2;
    while u < k[mid] || u >= k[mid + 1] {
        if u < k[mid] {
            hi = mid;
        } else {
            lo = mid;
        }
        mid = (lo + hi) / 2;
    }
    mid
}


fn basis(span: usize, u: f64, p: usize, k: &[f64], out: &mut [f64]) {
    let mut left = [0.0f64; 32];
    let mut right = [0.0f64; 32];
    out[0] = 1.0;
    for j in 1..=p {
        left[j] = u - k[span + 1 - j];
        right[j] = k[span + j] - u;
        let mut saved = 0.0;
        for r in 0..j {
            let den = right[r + 1] + left[j - r];
            let temp = if den.abs() > 0.0 { out[r] / den } else { 0.0 };
            out[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        out[j] = saved;
    }
}

fn valid_knots(k: &[f64], n_ctrl: usize, p: usize) -> bool {
    p >= 1 && p < 31 && n_ctrl > p && k.len() == n_ctrl + p + 1 && k.iter().all(|v| v.is_finite()) && k.windows(2).all(|w| w[1] >= w[0]) && k[n_ctrl] > k[p]
}


pub fn expand_knots(knots: &[f64], mults: &[usize]) -> Vec<f64> {
    let mut out = Vec::new();
    for (k, m) in knots.iter().zip(mults) {
        for _ in 0..*m {
            out.push(*k);
        }
    }
    out
}

#[derive(Clone, Debug)]
pub struct BCurve {
    pub p: usize,
    pub k: Vec<f64>,
    
    pub cw: Vec<[f64; 4]>,
}

impl BCurve {
    pub fn new(p: usize, k: Vec<f64>, pts: &[V3], w: Option<&[f64]>) -> Option<BCurve> {
        if !valid_knots(&k, pts.len(), p) {
            return None;
        }
        let cw = pts
            .iter()
            .enumerate()
            .map(|(i, q)| {
                let wi = w.and_then(|w| w.get(i).copied()).filter(|v| *v > 0.0 && v.is_finite()).unwrap_or(1.0);
                [q[0] * wi, q[1] * wi, q[2] * wi, wi]
            })
            .collect();
        Some(BCurve { p, k, cw })
    }

    pub fn domain(&self) -> (f64, f64) {
        (self.k[self.p], self.k[self.cw.len()])
    }

    pub fn eval(&self, u: f64) -> V3 {
        let (a, b) = self.domain();
        let u = u.clamp(a, b);
        let span = find_span(self.cw.len(), self.p, u, &self.k);
        let mut n = [0.0f64; 32];
        basis(span, u, self.p, &self.k, &mut n);
        let mut s = [0.0f64; 4];
        for j in 0..=self.p {
            let c = &self.cw[span - self.p + j];
            for d in 0..4 {
                s[d] += n[j] * c[d];
            }
        }
        if s[3].abs() < 1e-300 {
            return [s[0], s[1], s[2]];
        }
        [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    }

    
    pub fn spans(&self) -> usize {
        let (a, b) = self.domain();
        self.k.windows(2).filter(|w| w[1] > w[0] && w[0] >= a && w[1] <= b).count().max(1)
    }
}

#[derive(Clone, Debug)]
pub struct BSurf {
    pub pu: usize,
    pub pv: usize,
    pub ku: Vec<f64>,
    pub kv: Vec<f64>,
    pub nu: usize,
    pub nv: usize,
    
    pub cw: Vec<[f64; 4]>,
}

impl BSurf {
    
    pub fn new(pu: usize, pv: usize, ku: Vec<f64>, kv: Vec<f64>, pts: &[Vec<V3>], w: Option<&[Vec<f64>]>) -> Option<BSurf> {
        let nu = pts.len();
        let nv = pts.first()?.len();
        if pts.iter().any(|r| r.len() != nv) || !valid_knots(&ku, nu, pu) || !valid_knots(&kv, nv, pv) {
            return None;
        }
        let mut cw = Vec::with_capacity(nu * nv);
        for i in 0..nu {
            for j in 0..nv {
                let q = pts[i][j];
                let wi = w.and_then(|w| w.get(i).and_then(|r| r.get(j)).copied()).filter(|v| *v > 0.0 && v.is_finite()).unwrap_or(1.0);
                cw.push([q[0] * wi, q[1] * wi, q[2] * wi, wi]);
            }
        }
        Some(BSurf { pu, pv, ku, kv, nu, nv, cw })
    }

    pub fn domain(&self) -> ((f64, f64), (f64, f64)) {
        ((self.ku[self.pu], self.ku[self.nu]), (self.kv[self.pv], self.kv[self.nv]))
    }

    pub fn eval(&self, u: f64, v: f64) -> V3 {
        let ((u0, u1), (v0, v1)) = self.domain();
        let u = u.clamp(u0, u1);
        let v = v.clamp(v0, v1);
        let su = find_span(self.nu, self.pu, u, &self.ku);
        let sv = find_span(self.nv, self.pv, v, &self.kv);
        let mut nu = [0.0f64; 32];
        let mut nv = [0.0f64; 32];
        basis(su, u, self.pu, &self.ku, &mut nu);
        basis(sv, v, self.pv, &self.kv, &mut nv);
        let mut s = [0.0f64; 4];
        for a in 0..=self.pu {
            let row = (su - self.pu + a) * self.nv;
            for b in 0..=self.pv {
                let c = &self.cw[row + sv - self.pv + b];
                let f = nu[a] * nv[b];
                for d in 0..4 {
                    s[d] += f * c[d];
                }
            }
        }
        if s[3].abs() < 1e-300 {
            return [s[0], s[1], s[2]];
        }
        [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    }

    pub fn spans(&self) -> (usize, usize) {
        let count = |k: &[f64], a: f64, b: f64| k.windows(2).filter(|w| w[1] > w[0] && w[0] >= a && w[1] <= b).count().max(1);
        let ((u0, u1), (v0, v1)) = self.domain();
        (count(&self.ku, u0, u1), count(&self.kv, v0, v1))
    }

    
    pub fn transform(&mut self, f: impl Fn(V3) -> V3) {
        for c in self.cw.iter_mut() {
            let w = c[3];
            let q = f([c[0] / w, c[1] / w, c[2] / w]);
            *c = [q[0] * w, q[1] * w, q[2] * w, w];
        }
    }
}

impl BCurve {
    pub fn transform(&mut self, f: impl Fn(V3) -> V3) {
        for c in self.cw.iter_mut() {
            let w = c[3];
            let q = f([c[0] / w, c[1] / w, c[2] / w]);
            *c = [q[0] * w, q[1] * w, q[2] * w, w];
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quarter_circle_rational() {
         
        let s = std::f64::consts::FRAC_1_SQRT_2;
        let c = BCurve::new(2, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0], &[[10.0, 0.0, 0.0], [10.0, 10.0, 0.0], [0.0, 10.0, 0.0]], Some(&[1.0, s, 1.0])).unwrap();
        for i in 0..=10 {
            let p = c.eval(i as f64 / 10.0);
            assert!(((p[0] * p[0] + p[1] * p[1]).sqrt() - 10.0).abs() < 1e-9);
        }
    }

    #[test]
    fn bilinear_patch() {
        let pts = vec![vec![[0.0, 0.0, 0.0], [0.0, 10.0, 0.0]], vec![[10.0, 0.0, 0.0], [10.0, 10.0, 5.0]]];
        let s = BSurf::new(1, 1, vec![0.0, 0.0, 1.0, 1.0], vec![0.0, 0.0, 1.0, 1.0], &pts, None).unwrap();
        let p = s.eval(0.5, 0.5);
        assert!((p[0] - 5.0).abs() < 1e-12 && (p[1] - 5.0).abs() < 1e-12 && (p[2] - 1.25).abs() < 1e-12);
    }
}
