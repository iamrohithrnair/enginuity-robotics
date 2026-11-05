// Generates rounded boxes, tubes and extruded polygon triangle meshes.
 
 
 

type P2 = [number, number];
type P3 = [number, number, number];





export function roundedBoxMesh(sx: number, sy: number, sz: number, radius: number, segments = 6): Float32Array {
  const half: P3 = [sx / 2, sy / 2, sz / 2];
  const r = Math.max(0, Math.min(radius, half[0], half[1], half[2]));
  const n = Math.max(1, Math.round(segments));
   
  const stops = (h: number) => {
    const s: number[] = [];
    for (let i = 0; i <= n; i++) s.push(-h + (r * i) / n);
    for (let i = 0; i <= n; i++) s.push(h - r + (r * i) / n);
    return s.filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-9);
  };
  const axes = half.map(stops);
  const inner = half.map((h) => h - r);
   
  const round = (p: P3): P3 => {
    const c = p.map((v, k) => Math.max(-inner[k], Math.min(inner[k], v))) as P3;
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    if (l < 1e-12 || r === 0) return [p[0], p[1], p[2] + half[2]];
    return [c[0] + (r * d[0]) / l, c[1] + (r * d[1]) / l, c[2] + (r * d[2]) / l + half[2]];
  };
  const out: number[] = [];
  for (let k = 0; k < 3; k++) {
    const ku = (k + 1) % 3;
    const kv = (k + 2) % 3;
    for (const s of [1, -1]) {
      const us = axes[ku];
      const vs = axes[kv];
      for (let i = 0; i + 1 < us.length; i++) {
        for (let j = 0; j + 1 < vs.length; j++) {
          const at = (u: number, v: number): P3 => {
            const p: P3 = [0, 0, 0];
            p[k] = s * half[k];
            p[ku] = u;
            p[kv] = v;
            return round(p);
          };
          const a = at(us[i], vs[j]);
          const b = at(us[i + 1], vs[j]);
          const c = at(us[i + 1], vs[j + 1]);
          const d = at(us[i], vs[j + 1]);
          if (s > 0) out.push(...a, ...b, ...c, ...a, ...c, ...d);
          else out.push(...a, ...c, ...b, ...a, ...d, ...c);
        }
      }
    }
  }
  return Float32Array.from(out);
}

 
export function tubeMesh(outer: number, innerRadius: number, h: number, n = 48): Float32Array {
  const ri = Math.max(0, Math.min(innerRadius, outer * 0.999));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const o0: P2 = [outer * Math.cos(a0), outer * Math.sin(a0)];
    const o1: P2 = [outer * Math.cos(a1), outer * Math.sin(a1)];
    const i0: P2 = [ri * Math.cos(a0), ri * Math.sin(a0)];
    const i1: P2 = [ri * Math.cos(a1), ri * Math.sin(a1)];
     
    out.push(o0[0], o0[1], 0, o1[0], o1[1], 0, o1[0], o1[1], h);
    out.push(o0[0], o0[1], 0, o1[0], o1[1], h, o0[0], o0[1], h);
     
    out.push(i0[0], i0[1], 0, i1[0], i1[1], h, i1[0], i1[1], 0);
    out.push(i0[0], i0[1], 0, i0[0], i0[1], h, i1[0], i1[1], h);
     
    out.push(i0[0], i0[1], h, o0[0], o0[1], h, o1[0], o1[1], h);
    out.push(i0[0], i0[1], h, o1[0], o1[1], h, i1[0], i1[1], h);
    out.push(i0[0], i0[1], 0, o1[0], o1[1], 0, o0[0], o0[1], 0);
    out.push(i0[0], i0[1], 0, i1[0], i1[1], 0, o1[0], o1[1], 0);
  }
  return Float32Array.from(out);
}

const cross2 = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function inTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  return cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
}

 
export function triangulatePolygon(pts: P2[]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];
  while (idx.length > 3) {
    let cut = -1;
    for (let i = 0; i < idx.length && cut < 0; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross2(pts[a], pts[b], pts[c]) <= 1e-9) continue;
      if (idx.some((j) => j !== a && j !== b && j !== c && inTriangle(pts[j], pts[a], pts[b], pts[c]))) continue;
      tris.push([a, b, c]);
      cut = i;
    }
     
    if (cut < 0) return tris;
    idx.splice(cut, 1);
  }
  if (idx.length === 3 && Math.abs(cross2(pts[idx[0]], pts[idx[1]], pts[idx[2]])) > 1e-9) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

 
function area(pts: P2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}





export function extrudeMesh(profile: number[][], h: number): Float32Array {
  let pts: P2[] = profile.map((p) => [Number(p[0]), Number(p[1])] as P2).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-9);
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-9) pts.pop();
  if (pts.length < 3 || Math.abs(area(pts)) < 1e-9) return new Float32Array(0);
  if (area(pts) < 0) pts = pts.reverse();
  const out: number[] = [];
  for (const [a, b, c] of triangulatePolygon(pts)) {
    out.push(pts[a][0], pts[a][1], h, pts[b][0], pts[b][1], h, pts[c][0], pts[c][1], h);
    out.push(pts[a][0], pts[a][1], 0, pts[c][0], pts[c][1], 0, pts[b][0], pts[b][1], 0);
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    out.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], h);
    out.push(p[0], p[1], 0, q[0], q[1], h, p[0], p[1], h);
  }
  return Float32Array.from(out);
}

 
export function roundedRectProfile(w: number, h: number, r: number, segments = 6): number[][] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const pts: number[][] = [];
  const corners: [number, number, number][] = [
    [w / 2 - rr, -h / 2 + rr, -Math.PI / 2],
    [w / 2 - rr, h / 2 - rr, 0],
    [-w / 2 + rr, h / 2 - rr, Math.PI / 2],
    [-w / 2 + rr, -h / 2 + rr, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = a0 + (i / segments) * (Math.PI / 2);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return pts;
}
