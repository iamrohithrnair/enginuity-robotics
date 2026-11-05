// Computes rigid transforms, pose conversions and interpolated spatial motion.
 
 
 

export type Mat = number[];

export const eye = (): Mat => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: Mat, b: Mat): Mat {
  const r = new Array<number>(16).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      r[i * 4 + j] = s;
    }
  }
  return r;
}

export const mulAll = (...ms: Mat[]): Mat => ms.reduce((acc, m) => mul(acc, m), eye());

 
export function inv(m: Mat): Mat {
  const r = eye();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 4 + j] = m[j * 4 + i];
  for (let i = 0; i < 3; i++) r[i * 4 + 3] = -(r[i * 4] * m[3] + r[i * 4 + 1] * m[7] + r[i * 4 + 2] * m[11]);
  return r;
}

export function transl(x: number, y: number, z: number): Mat {
  const m = eye();
  m[3] = x;
  m[7] = y;
  m[11] = z;
  return m;
}

export function rotx(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
}

export function roty(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

export function rotz(a: number): Mat {
  const c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export const DEG = Math.PI / 180;
export const pos = (m: Mat): [number, number, number] => [m[3], m[7], m[11]];
export const setPos = (m: Mat, p: [number, number, number]): Mat => {
  const r = m.slice();
  r[3] = p[0];
  r[7] = p[1];
  r[11] = p[2];
  return r;
};





export function poseToXYZRPW(m: Mat): number[] {
  const [x, y, z] = pos(m);
  let rx: number, ry: number, rz: number;
  const r20 = m[8];
  if (r20 > 1 - 1e-10) {
    ry = -Math.PI / 2;
    rz = 0;
    rx = Math.atan2(-m[1], -m[2]);
  } else if (r20 < -1 + 1e-10) {
    ry = Math.PI / 2;
    rz = 0;
    rx = Math.atan2(m[1], m[2]);
  } else {
    ry = Math.asin(-r20);
    const c = Math.cos(ry);
    rx = Math.atan2(m[9] / c, m[10] / c);
    rz = Math.atan2(m[4] / c, m[0] / c);
  }
  return [x, y, z, rx / DEG, ry / DEG, rz / DEG];
}

export function xyzrpwToPose(v: number[]): Mat {
  const [x, y, z, rx, ry, rz] = v;
  return mulAll(transl(x, y, z), rotz(rz * DEG), roty(ry * DEG), rotx(rx * DEG));
}

 
export function rotError(a: Mat, b: Mat): [number, number, number] {
  const r = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += b[i * 4 + k] * a[j * 4 + k];
      r[i * 3 + j] = s;
    }
  const tr = r[0] + r[4] + r[8];
  const theta = Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
  const v: [number, number, number] = [r[7] - r[5], r[2] - r[6], r[3] - r[1]];
  if (theta < 1e-9) return [v[0] / 2, v[1] / 2, v[2] / 2];
  const k = theta / (2 * Math.sin(theta));
  if (Math.PI - theta < 1e-6) {
    const ax = [Math.sqrt(Math.max(0, (r[0] + 1) / 2)), Math.sqrt(Math.max(0, (r[4] + 1) / 2)), Math.sqrt(Math.max(0, (r[8] + 1) / 2))];
    return [ax[0] * theta, ax[1] * theta, ax[2] * theta];
  }
  return [v[0] * k, v[1] * k, v[2] * k];
}

export function poseDistance(a: Mat, b: Mat): { mm: number; deg: number } {
  const d = [a[3] - b[3], a[7] - b[7], a[11] - b[11]];
  const e = rotError(a, b);
  return { mm: Math.hypot(d[0], d[1], d[2]), deg: Math.hypot(e[0], e[1], e[2]) / DEG };
}

export function axisAngle(axis: [number, number, number], angle: number): Mat {
  const [x, y, z] = axis;
  const c = Math.cos(angle), s = Math.sin(angle), v = 1 - c;
  return [
    x * x * v + c, x * y * v - z * s, x * z * v + y * s, 0,
    x * y * v + z * s, y * y * v + c, y * z * v - x * s, 0,
    x * z * v - y * s, y * z * v + x * s, z * z * v + c, 0,
    0, 0, 0, 1,
  ];
}

 
export function interpolatePose(a: Mat, b: Mat, t: number): Mat {
  const e = rotError(a, b);
  const ang = Math.hypot(e[0], e[1], e[2]);
  let r = a.slice();
  if (ang > 1e-12) {
    const rot = axisAngle([e[0] / ang, e[1] / ang, e[2] / ang], ang * t);
    r = mul(rot, setPos(a, [0, 0, 0]));
  }
  r[3] = a[3] + (b[3] - a[3]) * t;
  r[7] = a[7] + (b[7] - a[7]) * t;
  r[11] = a[11] + (b[11] - a[11]) * t;
  r[12] = 0;
  r[13] = 0;
  r[14] = 0;
  r[15] = 1;
  return r;
}

 
export function poseToQuat(m: Mat): [number, number, number, number] {
  const tr = m[0] + m[5] + m[10];
  let w: number, x: number, y: number, z: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m[9] - m[6]) / s;
    y = (m[2] - m[8]) / s;
    z = (m[4] - m[1]) / s;
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = Math.sqrt(1 + m[0] - m[5] - m[10]) * 2;
    w = (m[9] - m[6]) / s;
    x = 0.25 * s;
    y = (m[1] + m[4]) / s;
    z = (m[2] + m[8]) / s;
  } else if (m[5] > m[10]) {
    const s = Math.sqrt(1 + m[5] - m[0] - m[10]) * 2;
    w = (m[2] - m[8]) / s;
    x = (m[1] + m[4]) / s;
    y = 0.25 * s;
    z = (m[6] + m[9]) / s;
  } else {
    const s = Math.sqrt(1 + m[10] - m[0] - m[5]) * 2;
    w = (m[4] - m[1]) / s;
    x = (m[2] + m[8]) / s;
    y = (m[6] + m[9]) / s;
    z = 0.25 * s;
  }
  return [w, x, y, z];
}

export const isMat = (v: unknown): v is Mat => Array.isArray(v) && v.length === 16 && v.every((x) => typeof x === "number");

export const round = (v: number, d = 3) => {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
