// Defines sandbox robotics API wrappers and pose/matrix helpers.
 
 
 
 
 
 
 

import "server-only";
import { ITEM_TYPE_CODES } from "@/engine/types";

export const PRELUDE_FILE = "enginuity-api.js";

export const PRELUDE = `(function () {
"use strict";
var G = globalThis;
var HOST_CALL = G.__mb_call, HOST_SLEEP = G.__mb_sleep, HOST_LOG = G.__mb_log;
delete G.__mb_call;
delete G.__mb_sleep;
delete G.__mb_log;
var TYPE_CODES = ${JSON.stringify(ITEM_TYPE_CODES)};
var TYPE_NAMES = {};
Object.keys(TYPE_CODES).forEach(function (k) { TYPE_NAMES[TYPE_CODES[k]] = k; });

function call(name, params) {
  var out = HOST_CALL(String(name), JSON.stringify(params === undefined ? {} : params));
  return out === undefined || out === "" ? null : JSON.parse(out);
}
function sleep(ms) { HOST_SLEEP(Math.max(0, Number(ms) || 0)); }

// ------------------------------------------------------------------------------- robomath
var pi = Math.PI, D2R = Math.PI / 180, R2D = 180 / Math.PI;

class Mat {
  constructor(rows, ncols) {
    if (rows === undefined || rows === null) { this.rows = []; return; }
    if (typeof rows === "number") {
      var n = ncols === undefined ? rows : ncols;
      this.rows = [];
      for (var i = 0; i < rows; i++) { var r = []; for (var j = 0; j < n; j++) r.push(0); this.rows.push(r); }
      return;
    }
    if (rows instanceof Mat) { this.rows = rows.rows.map(function (r) { return r.slice(); }); return; }
    if (Array.isArray(rows)) {
      if (rows.length && Array.isArray(rows[0])) { this.rows = rows.map(function (r) { return r.map(Number); }); return; }
      this.rows = rows.map(function (v) { return [Number(v)]; });
      return;
    }
    throw new TypeError("Mat: expected rows, a vector or a size");
  }
  size(dim) { var m = this.rows.length, n = m ? this.rows[0].length : 0; return dim === undefined ? [m, n] : dim === 0 ? m : n; }
  get(i, j) { return this.rows[i][j === undefined ? 0 : j]; }
  set(i, j, v) { this.rows[i][j] = Number(v); return this; }
  copy() { return new Mat(this); }
  tr() {
    var s = this.size(), R = new Mat(s[1], s[0]);
    for (var i = 0; i < s[0]; i++) for (var j = 0; j < s[1]; j++) R.rows[j][i] = this.rows[i][j];
    return R;
  }
  mul(B) {
    var s = this.size(), self = this;
    if (typeof B === "number") return new Mat(this.rows.map(function (r) { return r.map(function (v) { return v * B; }); }));
    if (Array.isArray(B)) {
      if (s[1] === 4 && B.length === 3) {
        var out = [];
        for (var i = 0; i < 3; i++) out.push(this.rows[i][0] * B[0] + this.rows[i][1] * B[1] + this.rows[i][2] * B[2] + this.rows[i][3]);
        return out;
      }
      if (B.length !== s[1]) throw new Error("Mat.mul: size mismatch");
      return this.rows.map(function (r) { return r.reduce(function (acc, v, k) { return acc + v * B[k]; }, 0); });
    }
    if (!(B instanceof Mat)) throw new TypeError("Mat.mul: expected a Mat, a vector or a number");
    var t = B.size();
    if (s[1] !== t[0]) throw new Error("Mat.mul: size mismatch (" + s[0] + "x" + s[1] + " * " + t[0] + "x" + t[1] + ")");
    var R = new Mat(s[0], t[1]);
    for (var a = 0; a < s[0]; a++) for (var b = 0; b < t[1]; b++) {
      var acc = 0;
      for (var k = 0; k < s[1]; k++) acc += self.rows[a][k] * B.rows[k][b];
      R.rows[a][b] = acc;
    }
    return R;
  }
  add(B) { return this.ew(B, function (a, b) { return a + b; }); }
  sub(B) { return this.ew(B, function (a, b) { return a - b; }); }
  ew(B, f) {
    var b = B instanceof Mat ? B : new Mat(B);
    return new Mat(this.rows.map(function (r, i) { return r.map(function (v, j) { return f(v, b.rows[i][j]); }); }));
  }
  isHomogeneous() {
    var s = this.size();
    if (s[0] !== 4 || s[1] !== 4) return false;
    var r = this.rows[3];
    return Math.abs(r[0]) < 1e-9 && Math.abs(r[1]) < 1e-9 && Math.abs(r[2]) < 1e-9 && Math.abs(r[3] - 1) < 1e-9;
  }
  invH() {
    if (!this.isHomogeneous()) throw new Error("invH: the matrix is not a homogeneous pose");
    var R = this.rows, out = eye(4);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) out.rows[i][j] = R[j][i];
    for (var k = 0; k < 3; k++) out.rows[k][3] = -(out.rows[k][0] * R[0][3] + out.rows[k][1] * R[1][3] + out.rows[k][2] * R[2][3]);
    return out;
  }
  inv() {
    if (this.isHomogeneous()) return this.invH();
    var s = this.size(), n = s[0];
    if (s[0] !== s[1]) throw new Error("inv: the matrix is not square");
    var A = this.rows.map(function (r, i) { var e = []; for (var j = 0; j < n; j++) e.push(i === j ? 1 : 0); return r.concat(e); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-14) throw new Error("inv: singular matrix");
      var tmp = A[c]; A[c] = A[p]; A[p] = tmp;
      var d = A[c][c];
      for (var j2 = 0; j2 < 2 * n; j2++) A[c][j2] /= d;
      for (var r2 = 0; r2 < n; r2++) if (r2 !== c) {
        var f = A[r2][c];
        if (f) for (var j3 = 0; j3 < 2 * n; j3++) A[r2][j3] -= f * A[c][j3];
      }
    }
    return new Mat(A.map(function (row) { return row.slice(n); }));
  }
  Pos() { return [this.rows[0][3], this.rows[1][3], this.rows[2][3]]; }
  setPos(p) { var v = p instanceof Mat ? p.list() : p; this.rows[0][3] = v[0]; this.rows[1][3] = v[1]; this.rows[2][3] = v[2]; return this; }
  VX() { return [this.rows[0][0], this.rows[1][0], this.rows[2][0]]; }
  VY() { return [this.rows[0][1], this.rows[1][1], this.rows[2][1]]; }
  VZ() { return [this.rows[0][2], this.rows[1][2], this.rows[2][2]]; }
  setVX(v) { for (var i = 0; i < 3; i++) this.rows[i][0] = v[i]; return this; }
  setVY(v) { for (var i = 0; i < 3; i++) this.rows[i][1] = v[i]; return this; }
  setVZ(v) { for (var i = 0; i < 3; i++) this.rows[i][2] = v[i]; return this; }
  Rot33() { return new Mat([this.rows[0].slice(0, 3), this.rows[1].slice(0, 3), this.rows[2].slice(0, 3)]); }
  list() { return this.rows.map(function (r) { return r[0]; }); }
  list2() { var s = this.size(), out = []; for (var j = 0; j < s[1]; j++) out.push(this.rows.map(function (r) { return r[j]; })); return out; }
  tolist() { return this.rows.map(function (r) { return r.slice(); }); }
  Offset(x, y, z, rx, ry, rz) { return Offset(this, x, y, z, rx, ry, rz); }
  RelTool(x, y, z, rx, ry, rz) { return RelTool(this, x, y, z, rx, ry, rz); }
  toJSON() { return this.rows; }
  toString() { return "Mat(" + JSON.stringify(this.rows.map(function (r) { return r.map(function (v) { return Math.round(v * 1e6) / 1e6; }); })) + ")"; }
}

// M[0] or M[0, 3] (Python indexing) would silently read undefined: explain how to read a Mat instead
function matIndexError() {
  throw new TypeError("A Mat is not an array: read values with M.get(row, col) (Python M[row, col]), the position with M.Pos(), numbers with M.list() / M.tolist(), or [x, y, z, r, p, w] with pose_2_xyzrpw(M)");
}
for (var mi = 0; mi < 16; mi++) Object.defineProperty(Mat.prototype, String(mi), { get: matIndexError, set: matIndexError, configurable: true });

function asMat(M) {
  if (M instanceof Mat) return M;
  if (Array.isArray(M) && M.length === 16 && !Array.isArray(M[0])) return poseFromFlat(M);
  return new Mat(M);
}
function vec(v) { return v instanceof Mat ? v.list() : Array.from(v); }
function poseFromFlat(a) { return new Mat([a.slice(0, 4), a.slice(4, 8), a.slice(8, 12), a.slice(12, 16)]); }
function flat(M) {
  var m = asMat(M);
  if (!m.isHomogeneous()) throw new Error("Expected a 4x4 pose");
  checkRigid(m);
  return m.rows[0].concat(m.rows[1], m.rows[2], m.rows[3]);
}
// a pose whose rotation columns are not orthonormal (e.g. column 2 changed instead of the position
// column 3) would make IK fail or a post write nonsense: say how to shift a pose instead
function checkRigid(m) {
  var R = m.rows, i, j, k, s, bad = false;
  for (i = 0; i < 3 && !bad; i++) for (j = 0; j < 3; j++) {
    s = 0;
    for (k = 0; k < 3; k++) s += R[k][i] * R[k][j];
    if (Math.abs(s - (i === j ? 1 : 0)) > 1e-4) { bad = true; break; }
  }
  var det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]);
  if (bad || det < 0) throw new TypeError("Not a valid pose: its rotation (columns 0-2) must be orthonormal. Shift a pose with Offset(H, x, y, z) or RelTool(H, x, y, z), or set its position with H.copy().setPos([x, y, z]); the position is column 3 (H.get(row, 3)).");
}
function eye(n) { n = n === undefined ? 4 : n; var M = new Mat(n, n); for (var i = 0; i < n; i++) M.rows[i][i] = 1; return M; }
function transl(x, y, z) {
  if (x instanceof Mat) x = x.list();
  if (Array.isArray(x)) { z = x[2]; y = x[1]; x = x[0]; }
  var M = eye(4); M.rows[0][3] = Number(x); M.rows[1][3] = Number(y); M.rows[2][3] = Number(z); return M;
}
function rotx(a) { var c = Math.cos(a), s = Math.sin(a); return new Mat([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]); }
function roty(a) { var c = Math.cos(a), s = Math.sin(a); return new Mat([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]]); }
function rotz(a) { var c = Math.cos(a), s = Math.sin(a); return new Mat([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]); }
function invH(H) { return asMat(H).invH(); }
function mult() { var M = asMat(arguments[0]); for (var i = 1; i < arguments.length; i++) M = M.mul(arguments[i] instanceof Mat || typeof arguments[i] === "number" ? arguments[i] : asMat(arguments[i])); return M; }
function size(M, dim) { return asMat(M).size(dim); }
function tr(M) { return asMat(M).tr(); }

function pose_2_xyzrpw(H) {
  var R = asMat(H).rows, r, p, w;
  if (R[2][0] > 1 - 1e-10) { p = -pi / 2; r = 0; w = Math.atan2(-R[1][2], R[1][1]); }
  else if (R[2][0] < -1 + 1e-10) { p = pi / 2; r = 0; w = Math.atan2(R[1][2], R[1][1]); }
  else {
    p = Math.atan2(-R[2][0], Math.sqrt(R[0][0] * R[0][0] + R[1][0] * R[1][0]));
    w = Math.atan2(R[1][0], R[0][0]);
    r = Math.atan2(R[2][1], R[2][2]);
  }
  return [R[0][3], R[1][3], R[2][3], r * R2D, p * R2D, w * R2D];
}
function xyzrpw_2_pose(v) { v = vec(v); return transl(v[0], v[1], v[2]).mul(rotz(v[5] * D2R)).mul(roty(v[4] * D2R)).mul(rotx(v[3] * D2R)); }
function Pose_2_TxyzRxyz(H) {
  var R = asMat(H).rows, sb = R[0][2], a, b, c;
  if (sb > 1 - 1e-10) { b = pi / 2; a = 0; c = Math.atan2(R[1][0], R[1][1]); }
  else if (sb < -1 + 1e-10) { b = -pi / 2; a = 0; c = Math.atan2(R[1][0], R[1][1]); }
  else {
    a = Math.atan2(-R[1][2], R[2][2]);
    b = Math.atan2(sb, Math.sqrt(R[0][0] * R[0][0] + R[0][1] * R[0][1]));
    c = Math.atan2(-R[0][1], R[0][0]);
  }
  return [R[0][3], R[1][3], R[2][3], a, b, c];
}
function TxyzRxyz_2_Pose(v) { v = vec(v); return transl(v[0], v[1], v[2]).mul(rotx(v[3])).mul(roty(v[4])).mul(rotz(v[5])); }
function Pose_2_Staubli(H) { var t = Pose_2_TxyzRxyz(H); return [t[0], t[1], t[2], t[3] * R2D, t[4] * R2D, t[5] * R2D]; }
function Pose_2_Fanuc(H) { return pose_2_xyzrpw(H); }
function Pose_2_Motoman(H) { return pose_2_xyzrpw(H); }
function Pose_2_KUKA(H) { var v = pose_2_xyzrpw(H); return [v[0], v[1], v[2], v[5], v[4], v[3]]; }
function KUKA_2_Pose(v) { v = vec(v); return transl(v[0], v[1], v[2]).mul(rotz(v[3] * D2R)).mul(roty(v[4] * D2R)).mul(rotx(v[5] * D2R)); }
function pose_2_quaternion(H) {
  var R = asMat(H).rows, a = R[0][0], b = R[1][1], c = R[2][2];
  var s2 = R[2][1] - R[1][2] < 0 ? -1 : 1, s3 = R[0][2] - R[2][0] < 0 ? -1 : 1, s4 = R[1][0] - R[0][1] < 0 ? -1 : 1;
  return [
    Math.sqrt(Math.max(a + b + c + 1, 0)) / 2,
    s2 * Math.sqrt(Math.max(a - b - c + 1, 0)) / 2,
    s3 * Math.sqrt(Math.max(-a + b - c + 1, 0)) / 2,
    s4 * Math.sqrt(Math.max(-a - b + c + 1, 0)) / 2,
  ];
}
function quaternion_2_pose(q) {
  q = vec(q);
  var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  var w = q[0] / n, x = q[1] / n, y = q[2] / n, z = q[3] / n;
  return new Mat([
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 0],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 0],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y), 0],
    [0, 0, 0, 1],
  ]);
}
function Pose_2_ABB(H) { var P = asMat(H).Pos(); return P.concat(pose_2_quaternion(H)); }
function Pose_2_UR(H) {
  var q = pose_2_quaternion(H), P = asMat(H).Pos();
  var ang = 2 * Math.acos(Math.max(-1, Math.min(1, q[0]))), s = Math.sin(ang / 2);
  if (Math.abs(s) < 1e-12) return P.concat([0, 0, 0]);
  return P.concat([q[1] / s * ang, q[2] / s * ang, q[3] / s * ang]);
}
function UR_2_Pose(v) {
  v = vec(v);
  var r = [v[3], v[4], v[5]], ang = norm(r), M = transl(v[0], v[1], v[2]);
  if (ang < 1e-12) return M;
  var k = [r[0] / ang, r[1] / ang, r[2] / ang], c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  var R = [
    [t * k[0] * k[0] + c, t * k[0] * k[1] - s * k[2], t * k[0] * k[2] + s * k[1]],
    [t * k[0] * k[1] + s * k[2], t * k[1] * k[1] + c, t * k[1] * k[2] - s * k[0]],
    [t * k[0] * k[2] - s * k[1], t * k[1] * k[2] + s * k[0], t * k[2] * k[2] + c],
  ];
  for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) M.rows[i][j] = R[i][j];
  return M;
}
function Offset(H, x, y, z, rx, ry, rz) {
  return transl(x, y, z).mul(rotx((rx || 0) * D2R)).mul(roty((ry || 0) * D2R)).mul(rotz((rz || 0) * D2R)).mul(asMat(H));
}
function RelTool(H, x, y, z, rx, ry, rz) {
  return asMat(H).mul(transl(x, y, z)).mul(rotx((rx || 0) * D2R)).mul(roty((ry || 0) * D2R)).mul(rotz((rz || 0) * D2R));
}
function cross(a, b) { a = vec(a); b = vec(b); return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { a = vec(a); b = vec(b); return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(v) { v = vec(v); return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
function normalize3(v) { v = vec(v); var n = norm(v); if (n < 1e-15) throw new Error("normalize3: zero vector"); return [v[0] / n, v[1] / n, v[2] / n]; }
function add3(a, b) { a = vec(a); b = vec(b); return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function subs3(a, b) { a = vec(a); b = vec(b); return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function mult3(v, s) { v = vec(v); return [v[0] * s, v[1] * s, v[2] * s]; }
function distance(a, b) { return norm(subs3(a, b)); }
function angle3(a, b) { var c = dot(a, b) / (norm(a) * norm(b)); return Math.acos(Math.max(-1, Math.min(1, c))); }
function point_Zaxis_2_pose(point, zaxis, hint1, hint2) {
  var z = normalize3(zaxis), yap = hint1 || [0, 0, 1];
  var ang = angle3(z, yap);
  if (ang < 2 * D2R || ang > pi - 2 * D2R) yap = hint2 || [0, 1, 1];
  var x = normalize3(cross(yap, z)), y = cross(z, x);
  return eye(4).setVX(x).setVY(y).setVZ(z).setPos(vec(point));
}

// ------------------------------------------------------------------------------- robolink
var ITEM_TYPE_ANY = -1;
var RUNMODE_SIMULATE = 1, RUNMODE_QUICKVALIDATE = 2, RUNMODE_MAKE_ROBOTPROG = 3, RUNMODE_MAKE_ROBOTPROG_AND_UPLOAD = 4,
  RUNMODE_MAKE_ROBOTPROG_AND_START = 5, RUNMODE_RUN_ROBOT = 6;
var INSTRUCTION_CALL_PROGRAM = 0, INSTRUCTION_INSERT_CODE = 1, INSTRUCTION_START_THREAD = 2, INSTRUCTION_COMMENT = 3,
  INSTRUCTION_SHOW_MESSAGE = 4;
var COLLISION_OFF = 0, COLLISION_ON = 1;
var INS_KIND = { 0: "call", 1: "code", 2: "thread", 3: "comment", 4: "print" };

function typeName(t) {
  if (t === undefined || t === null || t === ITEM_TYPE_ANY) return undefined;
  if (typeof t === "string") return t;
  var n = TYPE_NAMES[t];
  if (!n) throw new Error("Unknown item type " + t);
  return n;
}
function isPose(v) { return v instanceof Mat && v.size(0) === 4 && v.size(1) === 4; }
function jointsOf(v) {
  if (v instanceof Mat) return v.size(1) === 1 ? v.list() : v.list2()[0];
  return Array.from(v).map(Number);
}
function jointsMat(a) { return new Mat(a || []); }
function waitUntil(test, what) {
  var t0 = Date.now();
  while (!test()) {
    sleep(25);
    if (Date.now() - t0 > 600000) throw new Error("Timed out waiting for " + what);
  }
}

// ---- helpful errors for names that are not in the API (common slips from other robot APIs)
var ALIASES = { getItem: "Item", getItemList: "ItemList", getItems: "ItemList", Items: "ItemList", addFrame: "AddFrame", addTarget: "AddTarget",
  addProgram: "AddProgram", getJoints: "Joints", setJoint: "setJoints", getPose: "Pose", getName: "Name", MoveLinear: "MoveL", MoveJoint: "MoveJ",
  Program: "AddProgram", Target: "AddTarget", Frame: "AddFrame", RunProg: "RunProgram", getPoseAbs: "PoseAbs" };
var MEMBERS = null;
function methodNames(proto) { return Object.getOwnPropertyNames(proto).filter(function (n) { return n !== "constructor"; }); }
function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  var prev = [], cur, i, j;
  for (j = 0; j <= b.length; j++) prev.push(j);
  for (i = 1; i <= a.length; i++) {
    cur = [i];
    for (j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}
function unknownMember(owner, name) {
  if (!MEMBERS) MEMBERS = { RDK: methodNames(Robolink.prototype).concat(Object.keys(MATH)), Item: methodNames(Item.prototype) };
  var own = MEMBERS[owner], other = owner === "RDK" ? "Item" : "RDK";
  var head = owner === "RDK" ? "RDK." + name + " is not part of the Enginuity script API" : "Items have no method " + name + " in the Enginuity script API";
  var hint = ALIASES[name] && own.indexOf(ALIASES[name]) >= 0 ? ALIASES[name] : null;
  if (!hint) {
    var best = null, bestD = Math.max(1, Math.floor(name.length / 3)) + 1;
    own.forEach(function (n) { var d = editDistance(name, n); if (d < bestD) { bestD = d; best = n; } });
    hint = best;
  }
  if (hint) return head + ". Did you mean " + (owner === "RDK" ? "RDK." : "item.") + hint + "()?";
  if (MEMBERS[other].indexOf(name) >= 0) return head + ": " + name + " is " + (other === "RDK" ? "an RDK method: RDK." + name + "(...)" : "an item method, e.g. robot." + name + "(...)");
  return head + " (see the script API reference).";
}
var ITEM_TRAP = {
  get: function (t, k, r) {
    if (typeof k !== "string" || k in t || k === "then") return Reflect.get(t, k, r);
    throw new TypeError(unknownMember("Item", k));
  },
};
function poseArg(p, what) {
  if (p === undefined || p === null) return null;
  if (p instanceof Mat) return p;
  if (Array.isArray(p) && p.length === 3) return transl(p[0], p[1], p[2]);
  if (Array.isArray(p) && p.length === 16) return poseFromFlat(p);
  throw new TypeError(what + ": give the pose as a Mat, e.g. transl(x, y, z).mul(rotx(pi)), or as [x, y, z]; for [x, y, z, rx, ry, rz] in degrees use xyzrpw_2_pose([...])");
}

class Item {
  constructor(link, id, name, type) {
    this.link = link;
    this.item = id || null;
    this.name_ = name || "";
    this.type_ = type;
    return new Proxy(this, ITEM_TRAP);
  }
  need() { if (!this.item) throw new Error("Invalid item" + (this.name_ ? ": " + this.name_ + " was not found" : "")); return this.item; }
  data() { return call("item.data", { item: this.need() }); }
  equals(other) { return other instanceof Item && other.item === this.item; }
  Valid() { return !!this.item; }
  Name() { var n = this.data().name; this.name_ = n; return n; }
  setName(n) { call("item.rename", { item: this.need(), name: String(n) }); this.name_ = String(n); return this; }
  Type() { return this.data().typeCode; }
  typeName() { return this.data().type; }
  Parent() { var d = this.data(); return d.parent ? this.link.wrap(d.parent) : new Item(this.link, null); }
  Childs() { var self = this; return this.data().children.map(function (c) { return self.link.wrap(c); }); }
  Visible() { return !!this.data().visible; }
  setVisible(v) { call("item.setVisible", { items: [this.need()], visible: !!v }); return this; }
  setColor(c) { call("item.setColor", { item: this.need(), color: vec(c) }); return this; }
  setParam(k, v) { call("item.setParam", { item: this.need(), key: String(k), value: String(v) }); return this; }
  getParam(k) { var p = this.data().params || {}; return Object.prototype.hasOwnProperty.call(p, k) ? p[k] : null; }
  Delete() { call("item.delete", { items: [this.need()] }); this.item = null; }
  Copy() { return this.link.Copy(this); }
  setParent(p) { call("item.setParent", { item: this.need(), parent: this.link.ref(p), keepAbsolute: false }); return this; }
  setParentStatic(p) { call("item.setParent", { item: this.need(), parent: this.link.ref(p), keepAbsolute: true }); return this; }
  Pose() { var d = this.data(); return poseFromFlat(d.robot ? d.robot.tcpPose : d.pose); }
  setPose(M) {
    var d = this.data();
    if (d.robot) {
      var flange = mult(invH(poseFromFlat(d.robot.baseAbs)), poseFromFlat(d.robot.refAbs), asMat(M), invH(poseFromFlat(d.robot.toolPose)));
      var r = call("robot.solveIK", { robot: d.id, pose: flat(flange), seed: d.robot.joints });
      if (!r.joints) throw new Error("Target cannot be reached by " + d.name);
      call("robot.setJoints", { robot: d.id, joints: r.joints });
    } else call("item.setPose", { item: d.id, pose: flat(M) });
    return this;
  }
  PoseAbs() { return poseFromFlat(this.data().absPose); }
  setPoseAbs(M) { call("item.setPose", { item: this.need(), pose: flat(M), relativeTo: "station" }); return this; }
  setRobot(robot) {
    var d = this.data(), r = robot ? this.link.ref(robot) : null;
    if (d.type === "program") call("program.setRobot", { program: d.id, robot: r });
    else if (d.type === "target") call("target.setRobot", { target: d.id, robot: r });
    else throw new Error("setRobot: only programs and targets have a robot");
    return this;
  }

  // ---- robots and targets
  Joints() {
    var d = this.data();
    if (d.robot) return jointsMat(d.robot.joints);
    if (d.target) return jointsMat(d.target.joints);
    throw new Error("Joints: " + d.name + " is not a robot or a target");
  }
  setJoints(j) {
    var d = this.data();
    if (d.robot) call("robot.setJoints", { robot: d.id, joints: jointsOf(j) });
    else if (d.target) call("target.setJoints", { target: d.id, joints: jointsOf(j) });
    else throw new Error("setJoints: " + d.name + " is not a robot or a target");
    return this;
  }
  isJointTarget() { var d = this.data(); return !!(d.target && d.target.isJoint); }
  setAsJointTarget() { call("target.setJoint", { target: this.need(), isJoint: true }); return this; }
  setAsCartesianTarget() { call("target.setJoint", { target: this.need(), isJoint: false }); return this; }
  JointsHome() { return jointsMat(this.robotData().home); }
  setJointsHome(j) { call("robot.setHome", { robot: this.need(), joints: jointsOf(j) }); return this; }
  Home() { call("robot.home", { robot: this.need() }); this.WaitMove(); return this; }
  JointLimits() {
    var info = call("item.info", { item: this.need(), depth: 0 });
    var lim = info.jointLimits || [];
    return [jointsMat(lim.map(function (l) { return l[0]; })), jointsMat(lim.map(function (l) { return l[1]; }))];
  }
  robotData() { var d = this.data(); if (!d.robot) throw new Error(d.name + " is not a robot"); return d.robot; }
  SolveFK(j) { return poseFromFlat(call("robot.solveFK", { robot: this.need(), joints: jointsOf(j) }).pose); }
  SolveIK(M, seed) {
    var p = { robot: this.need(), pose: flat(M) };
    if (seed !== undefined && seed !== null) p.seed = jointsOf(seed);
    var r = call("robot.solveIK", p);
    return r.joints ? jointsMat(r.joints) : new Mat();
  }
  SolveIK_All(M) {
    var r = call("robot.solveIK", { robot: this.need(), pose: flat(M), all: true });
    var sols = r.solutions || [];
    if (!sols.length) return new Mat();
    return new Mat(sols).tr();
  }
  JointsConfig(j) { return jointsMat(call("robot.config", { robot: this.need(), joints: jointsOf(j) }).config); }
  PoseTool() { return poseFromFlat(this.robotData().toolPose); }
  PoseFrame() { return poseFromFlat(this.robotData().frameInBase); }
  AddTool(M, name) {
    var r = call("robot.addTool", { robot: this.need(), name: name || undefined, pose: flat(M) });
    return new Item(this.link, r.id, r.name, TYPE_CODES.tool);
  }
  Busy() {
    var id = this.need(), st = call("sim.status", {});
    return (st.busy || []).some(function (b) { return b.id === id; });
  }
  WaitMove() { var self = this; waitUntil(function () { return !self.Busy(); }, "the robot to stop"); return this; }
  WaitFinished() { var self = this; waitUntil(function () { return !self.Busy(); }, "the program to finish"); return this; }

  // ---- motion and program building: robots act by run mode, programs add instructions
  kind() { return this.data().type; }
  progOf() {
    var d = this.data();
    if (d.type === "program") return { prog: d, recording: false };
    if (d.type === "robot") {
      var g = this.link.gen;
      if (this.link.mode === RUNMODE_MAKE_ROBOTPROG && g) return { prog: g.prog.data(), recording: true, robot: d };
      return { robot: d };
    }
    throw new Error(d.name + " is not a robot or a program");
  }
  frameAbs(ctx) {
    var f = ctx.prog ? this.link.progFrames[ctx.prog.id] : null;
    if (f) return f.PoseAbs();
    var robot = ctx.robot || (ctx.prog && ctx.prog.program && ctx.prog.program.robot ? this.link.wrap(ctx.prog.program.robot).data() : null);
    if (robot && robot.robot) return poseFromFlat(robot.robot.refAbs);
    return eye(4);
  }
  moveParams(target, ctx) {
    if (target instanceof Item) return { target: target.need() };
    if (isPose(target)) return { pose: flat(this.frameAbs(ctx).mul(target)), createTarget: false };
    return { joints: jointsOf(target), createTarget: false };
  }
  moveTo(target, linear) {
    var ctx = this.progOf();
    if (ctx.prog) {
      call(linear ? "program.addMoveL" : "program.addMoveJ", Object.assign({ program: ctx.prog.id }, this.moveParams(target, ctx)));
      if (!ctx.recording) return this;
    }
    var r = ctx.robot, joints;
    if (target instanceof Item) {
      var td = target.data();
      if (td.target) joints = target.isJointTarget() ? td.target.joints : null;
      if (!joints) { var tp = td.target ? poseFromFlat(td.absPose) : poseFromFlat(td.absPose); joints = this.ikAbs(r, tp); }
    } else if (isPose(target)) joints = this.ikAbs(r, poseFromFlat(r.robot.refAbs).mul(target));
    else joints = jointsOf(target);
    if (this.link.mode === RUNMODE_SIMULATE && !ctx.recording) {
      call("robot.moveJ", { robot: r.id, joints: joints, linear: !!linear });
      this.WaitMove();
    } else call("robot.setJoints", { robot: r.id, joints: joints });
    return this;
  }
  ikAbs(r, tcpAbs) {
    var flange = mult(invH(poseFromFlat(r.robot.baseAbs)), tcpAbs, invH(poseFromFlat(r.robot.toolPose)));
    var s = call("robot.solveIK", { robot: r.id, pose: flat(flange), seed: r.robot.joints });
    if (!s.joints) throw new Error("Target cannot be reached by " + r.name);
    return s.joints;
  }
  MoveJ(target) { return this.moveTo(target, false); }
  MoveL(target) { return this.moveTo(target, true); }
  MoveC(via, end) {
    var ctx = this.progOf(), self = this;
    function asTarget(t, label) {
      if (t instanceof Item) return t;
      var parent = ctx.prog && self.link.progFrames[ctx.prog.id] ? self.link.progFrames[ctx.prog.id] : null;
      var rob = ctx.robot ? self.link.wrap(ctx.robot) : ctx.prog.program.robot ? self.link.wrap(ctx.prog.program.robot) : null;
      var tg = self.link.AddTarget(label, parent, rob);
      if (isPose(t)) tg.setPoseAbs(self.frameAbs(ctx).mul(t));
      else { tg.setAsJointTarget(); tg.setJoints(t); }
      return tg;
    }
    if (ctx.prog) {
      call("program.addMoveC", { program: ctx.prog.id, via: asTarget(via, "Via").need(), target: asTarget(end, "End").need() });
      if (!ctx.recording) return this;
    }
    var spec = function (t) {
      if (t instanceof Item) return { target: t.need() };
      if (isPose(t)) return { pose: flat(poseFromFlat(ctx.robot.robot.refAbs).mul(t)) };
      return { joints: jointsOf(t) };
    };
    call("robot.moveC", { robot: ctx.robot.id, via: spec(via), to: spec(end) });
    if (this.link.mode === RUNMODE_SIMULATE && !ctx.recording) this.WaitMove();
    return this;
  }
  addIns(params) {
    var ctx = this.progOf();
    if (ctx.prog) call("program.addInstruction", Object.assign({ program: ctx.prog.id }, params));
    return ctx;
  }
  setSpeed(lin, joint, accLin, accJoint) {
    var p = { kind: "speed" };
    if (lin !== undefined && lin >= 0) p.linear = lin;
    if (joint !== undefined && joint >= 0) p.joint = joint;
    if (accLin !== undefined && accLin >= 0) p.linearAccel = accLin;
    if (accJoint !== undefined && accJoint >= 0) p.jointAccel = accJoint;
    var ctx = this.addIns(p);
    if (ctx.robot) call("robot.setSpeed", { robot: ctx.robot.id, linear: p.linear === undefined ? -1 : p.linear, joint: p.joint === undefined ? -1 : p.joint, linearAccel: p.linearAccel === undefined ? -1 : p.linearAccel, jointAccel: p.jointAccel === undefined ? -1 : p.jointAccel });
    return this;
  }
  setRounding(r) { this.addIns({ kind: "rounding", rounding: Number(r) }); return this; }
  setPoseFrame(frame) {
    var ctx = this.progOf();
    if (!(frame instanceof Item)) throw new Error("setPoseFrame: give a reference frame item");
    if (ctx.prog) { call("program.addInstruction", { program: ctx.prog.id, kind: "frame", frame: frame.need() }); this.link.progFrames[ctx.prog.id] = frame; }
    if (ctx.robot) call("robot.setActiveFrame", { robot: ctx.robot.id, frame: frame.need() });
    return this;
  }
  setPoseTool(tool) {
    var ctx = this.progOf();
    if (!(tool instanceof Item)) throw new Error("setPoseTool: give a tool item");
    if (ctx.prog) call("program.addInstruction", { program: ctx.prog.id, kind: "tool", tool: tool.need() });
    if (ctx.robot) call("robot.setActiveTool", { robot: ctx.robot.id, tool: tool.need() });
    return this;
  }
  Pause(ms) {
    var ctx = this.addIns({ kind: "pause", pauseMs: Number(ms) });
    if (!ctx.prog && ctx.robot && this.link.mode === RUNMODE_SIMULATE) sleep(Number(ms));
    return this;
  }
  setDO(io, value) { var ctx = this.addIns({ kind: "io", ioMode: "set", ioName: String(io), ioValue: value }); if (!ctx.prog) call("io.set", { name: String(io), value: value }); return this; }
  setAO(io, value) { var ctx = this.addIns({ kind: "io", ioMode: "set", ioName: String(io), ioValue: value, analog: true }); if (!ctx.prog) call("io.set", { name: String(io), value: value, analog: true }); return this; }
  waitDI(io, value, timeoutMs) {
    var p = { kind: "io", ioMode: "wait", ioName: String(io), ioValue: value };
    if (timeoutMs !== undefined && timeoutMs >= 0) p.timeoutMs = timeoutMs;
    var ctx = this.addIns(p);
    if (!ctx.prog) {
      var t0 = Date.now();
      while (String(call("io.get", { name: String(io) }).value) !== String(value)) {
        if (timeoutMs !== undefined && timeoutMs >= 0 && Date.now() - t0 > timeoutMs) return false;
        sleep(25);
      }
    }
    return true;
  }
  RunInstruction(text, type) {
    var kind = INS_KIND[type === undefined ? INSTRUCTION_CALL_PROGRAM : type];
    if (!kind) throw new Error("RunInstruction: unknown instruction type " + type);
    var ctx = this.addIns({ kind: kind, text: String(text) });
    if (!ctx.prog) {
      if (kind === "print" || kind === "comment") print(String(text));
      else if (kind === "call") this.link.RunProgram(String(text), true);
    }
    return this;
  }
  RunProgram() { call("program.run", { program: this.need() }); return this; }
  RunCode() { return this.RunProgram(); }
  Update(checkCollisions) { return call("program.update", { program: this.need(), checkCollisions: !!checkCollisions }); }
  MakeProgram(folder) {
    var r = call("program.generate", { program: this.need(), folder: folder || undefined });
    return { post: r.post, program: r.program, files: (r.files || []).map(function (f) { return { name: f.name, path: f.path, bytes: (f.content || "").length }; }), log: r.log };
  }
  InstructionCount() { return call("program.instructions", { program: this.need() }).length; }
  Instruction(i) { var list = call("program.instructions", { program: this.need() }); return list[i] || null; }
  InstructionList() { return call("program.instructions", { program: this.need() }); }
  toString() { return "Item(" + (this.name_ || this.item || "invalid") + ")"; }
  toJSON() { return { item: this.item, name: this.name_ }; }
}

class Robolink {
  constructor() {
    this.mode = RUNMODE_SIMULATE;
    this.gen = null;
    this.progFrames = {};
  }
  wrap(ref) { return new Item(this, ref.id, ref.name, ref.typeCode !== undefined ? ref.typeCode : TYPE_CODES[ref.type]); }
  ref(x) {
    if (x === undefined || x === null || x === 0) return undefined;
    if (x instanceof Item) return x.need();
    return x;
  }
  Item(name, type) {
    var t = typeName(type), list = call("item.list", t ? { type: t } : {});
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return new Item(this, list[i].id, list[i].name, TYPE_CODES[list[i].type]);
    return new Item(this, null, name, type);
  }
  ItemList(type, namesOnly) {
    var t = typeName(type), self = this, list = call("item.list", t ? { type: t } : {});
    return namesOnly ? list.map(function (e) { return e.name; }) : list.map(function (e) { return new Item(self, e.id, e.name, TYPE_CODES[e.type]); });
  }
  AddFrame(name, parent, pose) {
    var P = poseArg(pose, "AddFrame");
    var r = call("item.addFrame", { name: name || undefined, parent: this.ref(parent), pose: P ? flat(P) : undefined });
    return new Item(this, r.id, r.name, TYPE_CODES.frame);
  }
  AddTarget(name, parent, robot, pose) {
    var P = poseArg(pose, "AddTarget");
    var r = call("target.add", { name: name || undefined, parent: this.ref(parent), robot: this.ref(robot), pose: P ? flat(P) : undefined });
    return new Item(this, r.id, r.name, TYPE_CODES.target);
  }
  AddProgram(name, robot) {
    var r = call("program.add", { name: name || undefined, robot: this.ref(robot) });
    return new Item(this, r.id, r.name, TYPE_CODES.program);
  }
  AddFile(file, parent) {
    var r = call("library.load", { file: String(file), parent: this.ref(parent) });
    var t = r.dof !== undefined ? TYPE_CODES.robot : /\\.tool$/i.test(String(file)) ? TYPE_CODES.tool : undefined;
    return new Item(this, r.id, r.name, t);
  }
  AddStation(name) { var r = call("station.new", { name: name || undefined }); return new Item(this, r.id, r.name, TYPE_CODES.station); }
  ActiveStation() { var l = call("item.list", { type: "station" }); return l.length ? new Item(this, l[0].id, l[0].name, TYPE_CODES.station) : new Item(this, null); }
  setActiveStation(st) { call("station.setActive", { station: this.ref(st) }); return this; }
  Collisions() { return call("collision.check", {}).count; }
  setCollisionActive(on) { call("collision.setActive", { active: on === undefined ? true : !!on }); return this; }
  setSimulationSpeed(x) { call("sim.setSpeed", { factor: Number(x) }); return this; }
  SimulationSpeed() { return call("sim.status", {}).ratio; }
  RunProgram(name, wait) {
    var p = name instanceof Item ? name : this.Item(String(name), TYPE_CODES.program);
    if (!p.Valid()) throw new Error("Program not found: " + name);
    p.RunProgram();
    if (wait) p.WaitFinished();
    return 0;
  }
  RunCode(code) { return this.RunProgram(code, false); }
  ShowMessage(msg) { print(String(msg)); }
  getParam(k) { return call("station.getParam", { key: String(k) }).value; }
  setParam(k, v) { call("station.setParam", { key: String(k), value: String(v) }); return this; }
  Copy(item) { call("edit.copy", { items: [this.ref(item)] }); return this; }
  Paste(parent, times) {
    var self = this, r = call("edit.paste", { parent: this.ref(parent), copies: times || 1 });
    var items = (r.ids || []).map(function (id, i) { return new Item(self, id, (r.pasted || [])[i], undefined); });
    return items.length === 1 ? items[0] : items;
  }
  Selection() {
    var self = this, sel = call("workspace.describe", {}).selection || [];
    return sel.map(function (s) { return typeof s === "string" ? self.Item(s) : self.wrap(s); });
  }
  setSelection(items) { var self = this; call("edit.select", { items: (items || []).map(function (i) { return self.ref(i); }), mode: "replace" }); return this; }
  setRunMode(m) { this.Finish(); this.mode = m === undefined ? RUNMODE_SIMULATE : m; return this; }
  RunMode() { return this.mode; }
  ProgramStart(name, folder, post, robot) {
    this.flush();
    var rob = robot instanceof Item ? robot : this.ItemList(TYPE_CODES.robot)[0];
    if (!rob) throw new Error("ProgramStart: no robot in the station");
    var prog = this.AddProgram(name, rob);
    this.gen = { prog: prog, folder: folder || "", post: post || "", robot: rob, name: String(name) };
    return 0;
  }
  flush() {
    var g = this.gen;
    if (!g) return null;
    this.gen = null;
    var r = call("program.generate", { program: g.prog.need(), post: g.post || undefined, folder: g.folder || undefined });
    call("item.delete", { items: [g.prog.need()] });
    return r;
  }
  Finish() { this.flush(); return this; }
  Disconnect() { return this.Finish(); }
  Version() { return "Enginuity"; }
  Call(command, params) { return call(command, params); }
}

var MATH = {};
var RDK = new Proxy(new Robolink(), {
  get: function (t, k, r) {
    if (typeof k !== "string" || k in t || k === "then") return Reflect.get(t, k, r);
    if (Object.prototype.hasOwnProperty.call(MATH, k)) return MATH[k];
    throw new TypeError(unknownMember("RDK", k));
  },
});
function RobolinkFactory() { return RDK; }

function print() {
  var parts = [];
  for (var i = 0; i < arguments.length; i++) {
    var a = arguments[i];
    parts.push(typeof a === "string" ? a : a instanceof Mat || a instanceof Item ? String(a) : JSON.stringify(a));
  }
  HOST_LOG(parts.join(" "));
}
G.console = { log: print, info: print, warn: print, error: print, debug: print };

var api = {
  RDK: RDK, Robolink: RobolinkFactory, Item: Item, Mat: Mat, print: print, sleep: sleep, call: call,
  pi: pi, eye: eye, transl: transl, rotx: rotx, roty: roty, rotz: rotz, invH: invH, mult: mult, size: size, tr: tr,
  pose_2_xyzrpw: pose_2_xyzrpw, xyzrpw_2_pose: xyzrpw_2_pose, Pose_2_TxyzRxyz: Pose_2_TxyzRxyz, TxyzRxyz_2_Pose: TxyzRxyz_2_Pose,
  Pose_2_Staubli: Pose_2_Staubli, Pose_2_Fanuc: Pose_2_Fanuc, Pose_2_Motoman: Pose_2_Motoman, Pose_2_KUKA: Pose_2_KUKA,
  KUKA_2_Pose: KUKA_2_Pose, Pose_2_ABB: Pose_2_ABB, Pose_2_UR: Pose_2_UR, UR_2_Pose: UR_2_Pose,
  pose_2_quaternion: pose_2_quaternion, quaternion_2_pose: quaternion_2_pose, Offset: Offset, RelTool: RelTool,
  cross: cross, dot: dot, norm: norm, normalize3: normalize3, add3: add3, subs3: subs3, mult3: mult3, distance: distance,
  angle3: angle3, point_Zaxis_2_pose: point_Zaxis_2_pose,
  ITEM_TYPE_ANY: ITEM_TYPE_ANY,
  RUNMODE_SIMULATE: RUNMODE_SIMULATE, RUNMODE_QUICKVALIDATE: RUNMODE_QUICKVALIDATE, RUNMODE_MAKE_ROBOTPROG: RUNMODE_MAKE_ROBOTPROG,
  RUNMODE_MAKE_ROBOTPROG_AND_UPLOAD: RUNMODE_MAKE_ROBOTPROG_AND_UPLOAD, RUNMODE_MAKE_ROBOTPROG_AND_START: RUNMODE_MAKE_ROBOTPROG_AND_START,
  RUNMODE_RUN_ROBOT: RUNMODE_RUN_ROBOT,
  INSTRUCTION_CALL_PROGRAM: INSTRUCTION_CALL_PROGRAM, INSTRUCTION_INSERT_CODE: INSTRUCTION_INSERT_CODE,
  INSTRUCTION_START_THREAD: INSTRUCTION_START_THREAD, INSTRUCTION_COMMENT: INSTRUCTION_COMMENT, INSTRUCTION_SHOW_MESSAGE: INSTRUCTION_SHOW_MESSAGE,
  COLLISION_OFF: COLLISION_OFF, COLLISION_ON: COLLISION_ON,
};
Object.keys(TYPE_CODES).forEach(function (k) {
  var name = k === "python" ? "PROGRAM_PYTHON" : k.toUpperCase();
  api["ITEM_TYPE_" + name] = TYPE_CODES[k];
});
Object.keys(api).forEach(function (k) {
  if (typeof api[k] === "function" && k !== "Robolink" && k !== "Item" && k !== "call" && k !== "print" && k !== "sleep") MATH[k] = api[k];
});
Object.keys(api).forEach(function (k) {
  Object.defineProperty(G, k, { value: api[k], writable: true, configurable: true, enumerable: false });
});
G.__mbFinish = function () { RDK.Finish(); };
})();
`;
