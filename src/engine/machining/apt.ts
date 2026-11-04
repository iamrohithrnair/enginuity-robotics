 
 
 
 
 
 
 
 
 
 
 

export type V3 = [number, number, number];
 
export type AptCol = number[];

export const APT = { arcEnd: 0, move: 2, spindle: 5, speed: 7, arcVia: 9, marker: 100, toolChange: 101, io: 102 } as const;
export const MARKER = { pathStart: 0, approach: 1, retract: 2, action: 3, pathFinish: 4 } as const;

const col = (type: number, p: readonly number[] = [0, 0, 0], n: readonly number[] = [0, 0, 0]): AptCol => [type, p[0], p[1], p[2], n[0], n[1], n[2]];
const speedCol = (v: number): AptCol => [APT.speed, v, 0, 0, 0, 0, 0];
const markerCol = (v: number): AptCol => [APT.marker, v, 0, 0, 0, 0, 0];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: readonly number[]) => Math.sqrt(a[1] * a[1] + a[0] * a[0] + a[2] * a[2]);
const xyz = (c: AptCol): V3 => [c[1], c[2], c[3]];
const ijk = (c: AptCol): V3 => [c[4], c[5], c[6]];

 
function normalize(a: V3): V3 {
  const r = 1 / Math.sqrt(a[1] * a[1] + a[0] * a[0] + a[2] * a[2]);
  return [a[0] * r, a[1] * r, a[2] * r];
}

 
export function projectOnPlane(q: readonly number[], p: readonly number[], n: readonly number[]): V3 {
  const t = -(-(n[1] * p[1]) - p[0] * n[0] - p[2] * n[2] + n[1] * q[1] + q[0] * n[0] + q[2] * n[2]) / (n[1] * n[1] + n[0] * n[0] + n[2] * n[2]);
  return [q[0] + n[0] * t, q[1] + n[1] * t, q[2] + n[2] * t];
}

 
export function rotateAbout(v: readonly number[], axis: readonly number[], deg: number): V3 {
  const l = Math.sqrt(axis[1] * axis[1] + axis[0] * axis[0] + axis[2] * axis[2]);
  const k: V3 = [axis[0] / l, axis[1] / l, axis[2] / l];
  const a = (deg * Math.PI) / 180;
  const s = Math.sin(a);
  const c = Math.cos(a);
  const d = (1 - c) * (v[0] * k[0] + v[1] * k[1] + v[2] * k[2]);
  return [
    s * (-(v[1] * k[2]) + v[2] * k[1]) + v[0] * c + k[0] * d,
    s * (-(v[2] * k[0]) + v[0] * k[2]) + v[1] * c + k[1] * d,
    s * (-(v[0] * k[1]) + v[1] * k[0]) + v[2] * c + k[2] * d,
  ];
}

 

 
export type ApproachCol = [number, number, number, number];





export const APPROACH_KEYWORDS: [string, number][] = [
  ["Normal", 1],
  ["Tangent", 2],
  ["Side", 3],
  ["AbsXYZ", 104],
  ["NTS", 102],
  ["RotXYZ", 103],
  ["XYZ", 101],
  ["ArcN", 201],
  ["ArcS", 202],
  ["ArcRotN", 203],
  ["ArcRotS", 204],
  ["Overlap", 100],
];

 

 
interface ChainFrame {
   
  c: V3;
   
  n: V3;
   
  t: V3;
   
  s: V3;
   
  axis: V3;
}

 
function rotXYZ(f: ChainFrame, rx: number, ry: number, rz: number) {
   
   
   
  const rot = (a: V3, axis: V3, deg: number) => (deg ? rotateAbout(a, axis, deg) : a);
  let X = f.t;
  let Y = scale(f.s, -1);
  let Z = f.n;
  let T = f.axis;
  for (const [deg, which] of [
    [rx, 0],
    [ry, 1],
    [rz, 2],
  ] as const) {
    if (!deg) continue;
    const axis = which === 0 ? X : which === 1 ? Y : Z;
    X = rot(X, axis, deg);
    Y = rot(Y, axis, deg);
    Z = rot(Z, axis, deg);
    T = rot(T, axis, deg);
  }
  f.t = X;
  f.s = scale(Y, -1);
  f.n = Z;
  f.axis = T;
}

 
function axisOffset(code: number, d: number): V3 | null {
  switch (code) {
    case 10:
      return [d, 0, 0];
    case 20:
      return [0, d, 0];
    case 30:
      return [0, 0, d];
    case 40:
      return [d, d, 0];
    case 41:
      return [d, 0, d];
    case 42:
      return [0, d, d];
    case 43:
      return [d, d, d];
    case 44:
      return [d, d, -d];
    case 45:
      return [d, -d, d];
    case 46:
      return [d, -d, -d];
    case 47:
      return [d, -d, 0];
    case 48:
      return [d, 0, -d];
    case 49:
      return [0, d, -d];
  }
  return null;
}






function chainMove(f: ChainFrame, m: ApproachCol, retract: boolean): AptCol[] {
  const [code, v1, v2, v3] = m;
  if (code < 100) {
    const prev = f.axis;
    if (code === 1) f.c = add(f.c, scale(f.n, v1));
    else if (code === 2) f.c = add(f.c, scale(f.t, v1));
    else if (code === 3) f.c = add(f.c, scale(f.s, v1));
    else {
      const o = axisOffset(code, v1);
      if (o) f.c = add(f.c, o);
    }
    return [col(APT.move, f.c, prev)];
  }
  if (code < 200) {
    if (code === 101) f.c = add(f.c, [v1, v2, v3]);
    else if (code === 102) f.c = add(add(add(f.c, scale(f.n, v1)), scale(f.t, v2)), scale(f.s, v3));
    else if (code === 103) rotXYZ(f, v1, v2, v3);
    else if (code === 104) f.c = [v1, v2, v3];
    return [col(APT.move, f.c, f.axis)];
  }
  if (code < 201 || code > 204) return [];
   
  const r = v1 * 0.5;
  const ang = r >= 0 ? v2 : -v2;
  const aroundN = code === 201 || code === 203;  
  const radial = aroundN ? f.n : f.s;
  const axis: V3 = aroundN ? f.s : scale(f.n, -1);
  const centre = add(f.c, scale(radial, r));
  const start = scale(radial, -r);
  const end = add(centre, rotateAbout(start, axis, ang));
  const mid = add(centre, rotateAbout(start, axis, ang * 0.5));
  const oldC = f.c;
  const oldAxis = f.axis;
  let midAxis = oldAxis;
  if (code === 203 || code === 204) {
     
    f.t = rotateAbout(f.t, axis, ang);
    if (aroundN) f.n = rotateAbout(f.n, axis, ang);
    else f.s = rotateAbout(f.s, axis, ang);
    midAxis = rotateAbout(oldAxis, axis, ang * 0.5);
    f.axis = rotateAbout(oldAxis, axis, ang);
  }
  f.c = end;
  return retract ? [col(APT.arcVia, mid, midAxis), col(APT.arcEnd, end, f.axis)] : [col(APT.move, end, f.axis), col(APT.arcVia, mid, midAxis), col(APT.arcEnd, oldC, oldAxis)];
}

const isMove = (c: AptCol) => c[0] === APT.move || c[0] === APT.arcVia;

 
export const OVERLAP = 99;







function addOverlap(path: AptCol[], approachD: number, retractD: number): AptCol[] {
  let out = path.map((c) => c.slice());
  const linear = (c: AptCol) => c[0] === APT.move;
  const walk = (cols: AptCol[], from: AptCol, d: number): AptCol[] => {
    const res: AptCol[] = [];
    let acc = 0;
    let prev = from;
    for (const c of cols) {
      if (!linear(c)) continue;
      const seg = norm(sub(xyz(c), xyz(prev)));
      if (acc + seg <= d) {
        res.push(c.slice());
        acc += seg;
        prev = c;
        continue;
      }
      const t = seg > 0 ? (d - acc) / seg : 0;
      res.push([APT.move, prev[1] + (c[1] - prev[1]) * t, prev[2] + (c[2] - prev[2]) * t, prev[3] + (c[3] - prev[3]) * t, c[4], c[5], c[6]]);
      break;
    }
    return res;
  };
  if (retractD > 0) {
    const last = [...out].reverse().find(linear);
    if (last) out = [...out, ...walk(out, last, retractD)];
  }
  if (approachD > 0) {
    const first = out.find(linear);
    if (first) out = [...walk([...out].reverse(), first, approachD).reverse(), ...out];
  }
  return out;
}






export function addApproachRetract(path0: AptCol[], approach0: ApproachCol[], retract0: ApproachCol[], rapid: number, point: boolean): AptCol[] {
   
  const approachOverlap = approach0.find((m) => m[0] === OVERLAP)?.[1] ?? 0;
  const retractOverlap = retract0.find((m) => m[0] === OVERLAP)?.[1] ?? 0;
  const approach = approach0.filter((m) => m[0] !== OVERLAP);
  const retract = retract0.filter((m) => m[0] !== OVERLAP);
  const path = approachOverlap > 0 || retractOverlap > 0 ? addOverlap(path0, approachOverlap, retractOverlap) : path0;
  const moves = path.map((c, i) => (isMove(c) ? i : -1)).filter((i) => i >= 0);
  if (moves.length < 2) return path.map((c) => c.slice());
  const first = moves[0];
  let last = moves[moves.length - 1];
   
  if (path[last][0] === APT.arcVia && last + 1 < path.length && path[last + 1][0] === APT.arcEnd) last += 1;

   
   
  const p0 = xyz(path[first]);
  let q: V3 = p0;
  let d = 0;
  for (let u = 1; u < moves.length; u++) {
    q = projectOnPlane(xyz(path[moves[u]]), p0, ijk(path[first]));
    d = norm(sub(q, p0));
    if (d > 0.1) break;
  }
  if (d < 0.1) q = [q[0] + 1, q[1], q[2]];
   
  const pe = xyz(path[last]);
  let qe: V3 = pe;
  let de = 0;
  for (let u = moves.length - 2; u >= 0; u--) {
    qe = projectOnPlane(xyz(path[moves[u]]), pe, ijk(path[last]));
    de = norm(sub(qe, pe));
    if (de > 0.1) break;
  }
  if (de < 0.1) qe = [qe[0] + 1, qe[1], qe[2]];

  const n0 = normalize(ijk(path[first]));
  const v0 = normalize(sub(p0, q));
  const s0 = normalize([v0[1] * n0[2] - v0[2] * n0[1], v0[2] * n0[0] - v0[0] * n0[2], v0[0] * n0[1] - v0[1] * n0[0]]);
  const n1 = normalize(ijk(path[last]));
  const w1 = normalize(sub(pe, qe));
  const s1 = normalize([w1[1] * n1[2] - w1[2] * n1[1], w1[2] * n1[0] - w1[0] * n1[2], w1[0] * n1[1] - w1[1] * n1[0]]);

   
   
  let ahead: AptCol[] = [];
  const fa: ChainFrame = { c: p0, n: n0, t: v0, s: s0, axis: n0 };
  approach.forEach((m, k) => {
    const cols = chainMove(fa, m, false);
    if (!point && k === approach.length - 1) cols.splice(Math.min(1, cols.length), 0, markerCol(MARKER.approach));
    ahead = [...cols, ...ahead];
  });
  if (!point && !approach.length) ahead.push(markerCol(MARKER.approach));
  ahead.push(path[first].slice());

   
  const behind: AptCol[] = [markerCol(MARKER.pathFinish), path[last].slice()];
  const fr: ChainFrame = { c: pe, n: n1, t: w1, s: s1, axis: n1 };
  for (const m of retract) behind.push(...chainMove(fr, m, true));

  const pre = path.slice(0, first).map((c) => c.slice());
  const body = [markerCol(MARKER.pathStart), ...path.slice(first, last + 1).map((c) => c.slice())];
  const post = path.slice(last + 1).map((c) => c.slice());
  const fast = rapid >= 1 ? [speedCol(-1)] : [];
  return [...pre, ...fast, ...ahead, ...body, ...fast, ...behind, ...(point ? [] : [markerCol(MARKER.retract)]), ...post];
}

 

 
export interface WeldSettings {
  OffsetNormalMM: number;
  OffsetSideMM: number;
  CutStartMM: number;
  CutEndMM: number;
  FlareStartMM: number;
  FlareStartDeg: number;
  FlareEndMM: number;
  FlareEndDeg: number;
}

 
export function weldIsDefault(w: WeldSettings): boolean {
  return !w.CutStartMM && !w.CutEndMM && w.FlareStartDeg === 30 && !w.FlareStartMM && w.FlareEndDeg === 30 && !w.FlareEndMM && !w.OffsetSideMM && !w.OffsetNormalMM;
}

const f32 = Math.fround;

 
function curveTangents(p: number[][]): V3[] {
  const n = p.length;
  const t: V3[] = [];
  let cur: V3 = [1, 0, 0];
  const dir = (a: number[], b: number[]) => {
    const dx = f32(b[0] - a[0]);
    const dy = f32(b[1] - a[1]);
    const dz = f32(b[2] - a[2]);
    return { dx, dy, dz, l: f32(Math.sqrt(f32(f32(f32(dy * dy) + f32(dx * dx)) + f32(dz * dz)))) };
  };
  for (let k = 0; k + 1 < n; k++) {
    let d = dir(p[k], p[k + 1]);
    if (!(d.l >= 1e-6) && k === 0) {
      for (let j = 2; j < n; j++) {
        d = dir(p[0], p[j]);
        if (d.l > 0.001) break;
      }
    }
    if (d.l >= 1e-6 || (k === 0 && d.l > 0.001)) {
      const r = f32(1 / d.l);
      cur = [f32(d.dx * r), f32(d.dy * r), f32(d.dz * r)];
    }
    t.push(cur);
  }
  if (n) t.push(cur);
  return t;
}









export function weldCurve(rows0: number[][], reversed: boolean, w: WeldSettings): number[][] {
  let rows = (reversed ? rows0.slice().reverse() : rows0).map((r) => r.slice());
  let t = curveTangents(rows);
  if (w.OffsetNormalMM) rows = rows.map((r) => [f32(r[0] + r[3] * w.OffsetNormalMM), f32(r[1] + r[4] * w.OffsetNormalMM), f32(r[2] + r[5] * w.OffsetNormalMM), r[3], r[4], r[5]]);
  if (w.OffsetSideMM) {
    rows = rows.map((r, k) => {
      const [tx, ty, tz] = t[k];
      let sx = f32(f32(ty * -r[5]) + f32(tz * r[4]));
      let sy = f32(f32(tz * -r[3]) + f32(tx * r[5]));
      let sz = f32(-f32(r[4] * tx) + f32(ty * r[3]));
      const l2 = f32(f32(f32(sy * sy) + f32(sx * sx)) + f32(sz * sz));
      if (l2 >= 1e-6) {
        const l = f32(Math.sqrt(l2));
        sx = f32(sx / l);
        sy = f32(sy / l);
        sz = f32(sz / l);
      } else sx = sy = sz = 0;
      return [f32(r[0] + sx * w.OffsetSideMM), f32(r[1] + sy * w.OffsetSideMM), f32(r[2] + sz * w.OffsetSideMM), r[3], r[4], r[5]];
    });
  }
  const cut = (d: number, end: boolean) => {
    if (!d || rows.length < 2) return;
    if (d < 0) {
      const k = end ? rows.length - 1 : 0;
      const s = end ? -1 : 1;
      rows[k] = [f32(rows[k][0] + s * t[k][0] * d), f32(rows[k][1] + s * t[k][1] * d), f32(rows[k][2] + s * t[k][2] * d), rows[k][3], rows[k][4], rows[k][5]];
      return;
    }
    const seq = end ? rows.slice().reverse() : rows.slice();
    let total = 0;
    for (let k = 1; k < seq.length; k++) total += Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1], seq[k][2] - seq[k - 1][2]);
    const dd = Math.min(d, total - 0.1);
    let acc = 0;
    for (let k = 1; k < seq.length; k++) {
      const seg = Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1], seq[k][2] - seq[k - 1][2]);
      if (acc + seg >= dd - 0.001) {
        const u = seg > 0 ? Math.max(0, dd - acc) / seg : 0;
        const a = seq[k - 1];
        const b = seq[k];
        const nn = [a[3] + (b[3] - a[3]) * u, a[4] + (b[4] - a[4]) * u, a[5] + (b[5] - a[5]) * u];
        const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
        const head = [f32(a[0] + (b[0] - a[0]) * u), f32(a[1] + (b[1] - a[1]) * u), f32(a[2] + (b[2] - a[2]) * u), f32(nn[0] / nl), f32(nn[1] / nl), f32(nn[2] / nl)];
        const kept = Math.abs(acc + seg - dd) <= 0.001 ? seq.slice(k) : [head, ...seq.slice(k)];
        rows = end ? kept.reverse() : kept;
        t = curveTangents(rows);
        return;
      }
      acc += seg;
    }
  };
  cut(w.CutStartMM, false);
  cut(w.CutEndMM, true);
  const flare = (mm: number, deg: number, end: boolean) => {
    if (!deg || !(mm > 0) || rows.length < 2) return;
    const seq = end ? rows.slice().reverse() : rows.slice();
    const tg = curveTangents(seq);
    let acc = 0;
    for (let k = 0; k < seq.length; k++) {
      if (k > 0) acc += Math.hypot(seq[k][0] - seq[k - 1][0], seq[k][1] - seq[k - 1][1], seq[k][2] - seq[k - 1][2]);
      if (acc > mm) break;
      const n: V3 = [seq[k][3], seq[k][4], seq[k][5]];
      const side: V3 = [n[1] * tg[k][2] - n[2] * tg[k][1], n[2] * tg[k][0] - n[0] * tg[k][2], n[0] * tg[k][1] - n[1] * tg[k][0]];
      const r = rotateAbout(n, side, deg * (1 - acc / mm));
      seq[k] = [seq[k][0], seq[k][1], seq[k][2], f32(r[0]), f32(r[1]), f32(r[2])];
    }
    rows = end ? seq.reverse() : seq;
  };
  flare(w.FlareStartMM, w.FlareStartDeg, false);
  flare(w.FlareEndMM, w.FlareEndDeg, true);
  return rows;
}

 

 
export interface CurveIn {
  rows: number[][];
   
  reversed: boolean;
}







export function curveApt(curves0: CurveIn[], o: { approachRetractAll: boolean; joinTol: number; speedOp: number; rapid: number; approach: ApproachCol[]; retract: ApproachCol[]; weld?: WeldSettings }): AptCol[] {
  const out: AptCol[] = [];
  let section: AptCol[] = [];
   
  const curves = o.weld && !weldIsDefault(o.weld) ? curves0.map((c) => ({ rows: weldCurve(c.rows, c.reversed, o.weld!), reversed: false })) : curves0;
  curves.forEach((c, k) => {
    const rows = c.reversed ? c.rows.slice().reverse() : c.rows;
    rows.forEach((r, i) => {
      section.push(col(APT.move, r, [r[3], r[4], r[5]]));
      if (i === 0) section.push(speedCol(o.speedOp));
    });
    if (!o.approachRetractAll) return;
    const next = curves[k + 1];
    let join = false;
    if (next && rows.length && next.rows.length) {
      const a = rows[rows.length - 1];
      const b = next.reversed ? next.rows[next.rows.length - 1] : next.rows[0];
       
      const f = Math.fround;
      const dx = f(b[0] - a[0]);
      const dy = f(b[1] - a[1]);
      const dz = f(b[2] - a[2]);
      const gap = f(Math.sqrt(f(f(f(dy * dy) + f(dx * dx)) + f(dz * dz))));
      join = !(o.joinTol < gap);
    }
    if (!join) {
      out.push(...addApproachRetract(section, o.approach, o.retract, o.rapid, false));
      section = [];
    }
  });
  if (!o.approachRetractAll) out.push(...addApproachRetract(section, o.approach, o.retract, o.rapid, false));
  return out;
}

 
export interface PointIn {
  row: number[];
   
  flip: boolean;
}







export function pointApt(points: PointIn[], d: number, speedOp: number): AptCol[] {
  const out: AptCol[] = [];
  let lastCol: AptCol | null = null;
  points.forEach(({ row, flip }, k) => {
    const n: V3 = flip ? [-row[3], -row[4], -row[5]] : [row[3], row[4], row[5]];
    const p: V3 = [row[0], row[1], row[2]];
    if (d <= 0) {
      lastCol = col(APT.move, p, n);
      out.push(lastCol, markerCol(MARKER.approach), markerCol(MARKER.action), markerCol(MARKER.retract));
      return;
    }
    const a: V3 = [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];
    if (k > 0) out.push(speedCol(-1));
    out.push(col(APT.move, a, n), speedCol(speedOp), markerCol(MARKER.approach), col(APT.move, p, n), markerCol(MARKER.action));
    lastCol = col(APT.move, a, n);
    out.push(lastCol, markerCol(MARKER.retract));
  });
  if (lastCol) out.push((lastCol as AptCol).slice());
  return out;
}
