"use client";
// Fetches mesh buffers and builds cached Three.js geometry and transforms.

import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

 
 

const cache = new Map<string, Promise<THREE.BufferGeometry>>();

async function fetchFloats(id: string): Promise<Float32Array> {
  const r = await fetch(`/api/geometry/${id}`);
  if (!r.ok) throw new Error(`geometry ${id}: ${r.status}`);
  return new Float32Array(await r.arrayBuffer());
}






export function loadGeometry(id: string, normalsId?: string): Promise<THREE.BufferGeometry> {
  const key = normalsId ? `${id}|${normalsId}` : id;
  let p = cache.get(key);
  if (!p) {
    p = normalsId
      ? Promise.all([fetchFloats(id), fetchFloats(normalsId)]).then(([pos, nrm]) => {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
          g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
          g.computeBoundingSphere();
          g.computeBoundingBox();
          return g;
        })
      : fetchFloats(id).then((buf) => buildGeometry(buf));
    cache.set(key, p);
  }
  return p;
}

export function buildGeometry(tri: Float32Array): THREE.BufferGeometry {
  let g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(tri, 3));
  g = mergeVertices(g, 1e-3);
  g = toCreasedNormals(g, (35 * Math.PI) / 180);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

 
function toCreasedNormals(geom: THREE.BufferGeometry, crease: number): THREE.BufferGeometry {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const n = pos.count;
  const faceNormals: THREE.Vector3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    faceNormals.push(new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize());
  }
  const key = (i: number) => `${Math.round(pos.getX(i) * 1000)},${Math.round(pos.getY(i) * 1000)},${Math.round(pos.getZ(i) * 1000)}`;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const arr = buckets.get(k);
    if (arr) arr.push(i);
    else buckets.set(k, [i]);
  }
  const normals = new Float32Array(n * 3);
  const cosCrease = Math.cos(crease);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const fn = faceNormals[(i / 3) | 0];
    tmp.set(0, 0, 0);
    for (const j of buckets.get(key(i))!) {
      const other = faceNormals[(j / 3) | 0];
      if (other.dot(fn) >= cosCrease) tmp.add(other);
    }
    tmp.normalize();
    normals[i * 3] = tmp.x;
    normals[i * 3 + 1] = tmp.y;
    normals[i * 3 + 2] = tmp.z;
  }
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return g;
}

export function matFromRowMajor(m: number[], target = new THREE.Matrix4()): THREE.Matrix4 {
  return target.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], m[12], m[13], m[14], m[15]);
}
