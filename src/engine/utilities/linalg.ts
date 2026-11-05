// Provides vector algebra, eigensolvers and least-squares plane fitting.
 
 
 

export type Vec3 = [number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

 
export function symEigen(m: number[][]): { values: number[]; vectors: number[][] } {
  const n = m.length;
  const a = m.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): number => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return { values: a.map((r, i) => r[i]), vectors: v };
}






export function lstsq(rows: number[][], b: number[], rcond = 1e-12): { x: number[]; rank: number } {
  const n = rows[0]?.length ?? 0;
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const atb = new Array<number>(n).fill(0);
  rows.forEach((r, k) => {
    for (let i = 0; i < n; i++) {
      atb[i] += r[i] * b[k];
      for (let j = 0; j < n; j++) ata[i][j] += r[i] * r[j];
    }
  });
  const { values, vectors } = symEigen(ata);
   
  const smax = Math.sqrt(Math.max(0, ...values));
  const x = new Array<number>(n).fill(0);
  let rank = 0;
  values.forEach((lambda, k) => {
    const sigma = Math.sqrt(Math.max(0, lambda));
    if (sigma <= rcond * smax || sigma === 0) return;
    rank++;
    let proj = 0;
    for (let i = 0; i < n; i++) proj += vectors[i][k] * atb[i];
    for (let i = 0; i < n; i++) x[i] += (vectors[i][k] * proj) / lambda;
  });
  return { x, rank };
}

 
export function fitPlane(points: Vec3[]): { centroid: Vec3; normal: Vec3 } {
  const c = scale(points.reduce<Vec3>((s, p) => add(s, p), [0, 0, 0]), 1 / points.length);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of points) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  const { values, vectors } = symEigen(cov);
  let k = 0;
  for (let i = 1; i < 3; i++) if (values[i] < values[k]) k = i;
  return { centroid: c, normal: unit([vectors[0][k], vectors[1][k], vectors[2][k]]) };
}
