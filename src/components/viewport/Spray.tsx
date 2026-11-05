"use client";
// Loads and renders spray-gun particle layers in the viewport.

 
 
 
 
 
 
 
 

import { useEffect, useState } from "react";
import * as THREE from "three";
import { onServerEvent } from "@/client/api";
import type { Mat } from "@/engine/math";
import type { ParticleShape } from "@/engine/spray/options";
import { PARTICLE_BYTES } from "@/engine/spray/particles";
import type { GunMeta } from "@/engine/spray/runtime";
import type { Workspace } from "@/engine/types";
import { matFromRowMajor } from "./geometry";

const FLOATS = PARTICLE_BYTES / 4;

 
function particleGeometry(p: ParticleShape, count: number): THREE.BufferGeometry {
  if (p.kind === "cube") return new THREE.BoxGeometry(Math.abs(p.size[0]) || 1e-3, Math.abs(p.size[1]) || 1e-3, Math.abs(p.size[2]) || 1e-3);
  if (p.kind === "mesh") {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p.vertices, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(p.normals, 3));
    return g;
  }
   
  const cap = count > 400_000 ? 4 : count > 120_000 ? 6 : count > 40_000 ? 10 : 24;
  const f = Math.max(3, Math.min(p.facets, cap));
  const g = new THREE.SphereGeometry(Math.abs(p.radius) || 1e-3, f, Math.max(2, f));
  if (p.scale) g.scale(p.scale[0] || 1e-6, p.scale[1] || 1e-6, p.scale[2] || 1e-6);
  return g;
}

 
function particleMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, transparent: true, depthWrite: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 iPos;
attribute vec4 iQuat;
attribute vec4 iColor;
varying vec4 vIColor;
vec3 rcRotate(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }`,
      )
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = rcRotate(vec3(normal), iQuat);")
      .replace("#include <begin_vertex>", "vec3 transformed = rcRotate(vec3(position), iQuat) + iPos;\nvIColor = iColor;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec4 vIColor;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor *= vIColor;");
  };
  return m;
}

 
class GunLayer {
  readonly group = new THREE.Group();
  readonly material = particleMaterial();
  private geometry = new THREE.InstancedBufferGeometry();
  private mesh: THREE.Mesh;
  private data = new Float32Array(0);
  private colors = new Uint8Array(0);
  private capacity = 0;
  private detailFor = 0;
   
  received = 0;
   
  wanted = 0;
  busy = false;
  again = false;
  disposed = false;
  opaque = true;

  constructor(
    readonly key: string,
    public meta: GunMeta,
  ) {
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;  
    this.group.add(this.mesh);
    this.ensure(1024);
  }

  private setBase(count: number) {
    const base = particleGeometry(this.meta.particle, count);
    const g = this.geometry;
    for (const name of ["position", "normal", "uv"]) g.deleteAttribute(name);
    g.setIndex(base.index);
    g.setAttribute("position", base.getAttribute("position"));
    g.setAttribute("normal", base.getAttribute("normal") ?? base.getAttribute("position"));
    this.detailFor = count;
    base.dispose();
  }

  private ensure(n: number) {
    if (n <= this.capacity) return;
    let cap = Math.max(1024, this.capacity);
    while (cap < n) cap *= 2;
    const data = new Float32Array(cap * FLOATS);
    data.set(this.data.subarray(0, this.received * FLOATS));
    const colors = new Uint8Array(cap * 4);
    colors.set(this.colors.subarray(0, this.received * 4));
    this.data = data;
    this.colors = colors;
    this.capacity = cap;
    const ib = new THREE.InstancedInterleavedBuffer(data, FLOATS);
    this.geometry.setAttribute("iPos", new THREE.InterleavedBufferAttribute(ib, 3, 0));
    this.geometry.setAttribute("iQuat", new THREE.InterleavedBufferAttribute(ib, 4, 3));
    this.geometry.setAttribute("iColor", new THREE.InstancedBufferAttribute(colors, 4, true));
    if (!this.detailFor) this.setBase(0);
  }

   
  append(bytes: Uint8Array) {
    const n = Math.floor(bytes.byteLength / PARTICLE_BYTES);
    if (!n) return;
    const start = this.received;
    this.ensure(start + n);
    const src = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
    this.data.set(new Float32Array(src.buffer, src.byteOffset, n * FLOATS), start * FLOATS);
    let translucent = false;
    for (let i = 0; i < n; i++) {
      const o = i * PARTICLE_BYTES + 28;
      this.colors.set(src.subarray(o, o + 4), (start + i) * 4);
      if (src[o + 3] < 255) translucent = true;
    }
    this.received = start + n;
    const iPos = this.geometry.getAttribute("iPos") as THREE.InterleavedBufferAttribute;
    iPos.data.addUpdateRange(start * FLOATS, n * FLOATS);
    iPos.data.needsUpdate = true;
    const iColor = this.geometry.getAttribute("iColor") as THREE.InstancedBufferAttribute;
    iColor.addUpdateRange(start * 4, n * 4);
    iColor.needsUpdate = true;
    this.geometry.instanceCount = this.received;
    if (translucent && this.opaque) {
       
      this.opaque = false;
      this.material.depthWrite = false;
      this.material.needsUpdate = true;
    }
     
    if (this.meta.particle.kind === "sphere" && this.received > 40_000 && this.received > this.detailFor * 3) this.setBase(this.received);
  }

  setMeta(meta: GunMeta) {
    const shapeChanged = JSON.stringify(meta.particle) !== JSON.stringify(this.meta.particle);
    this.meta = meta;
    this.wanted = meta.count;
    this.group.visible = meta.state !== 2;
    if (shapeChanged) this.setBase(this.received);
  }

  dispose() {
    this.disposed = true;
    this.group.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}

 
async function pull(layer: GunLayer) {
  if (layer.busy) {
    layer.again = true;
    return;
  }
  layer.busy = true;
  try {
    while (!layer.disposed && layer.received < layer.wanted) {
      const r = await fetch(`/api/spray?gun=${encodeURIComponent(layer.key)}&from=${layer.received}`, { cache: "no-store" });
      if (!r.ok) break;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (layer.disposed) return;
      const from = Number(r.headers.get("x-spray-from") ?? layer.received);
      if (from !== layer.received) break;
      if (!bytes.byteLength) break;
      layer.append(bytes);
    }
  } catch {
     
  } finally {
    layer.busy = false;
    if (layer.again && !layer.disposed) {
      layer.again = false;
      void pull(layer);
    }
  }
}

 
export function SprayLayer({ ws, abs }: { ws: Workspace; abs: (id: string) => Mat }) {
  const station = ws.activeStation;
  const [list, setList] = useState<GunLayer[]>([]);

  useEffect(() => {
    let alive = true;
    const map = new Map<string, GunLayer>();
    const publish = () => setList([...map.values()]);
    const reconcile = (guns: GunMeta[]) => {
      const keep = new Set(guns.map((g) => g.key));
      let changed = false;
      for (const [k, l] of map) {
        if (!keep.has(k)) {
          l.dispose();
          map.delete(k);
          changed = true;
        }
      }
      for (const g of guns) {
        let l = map.get(g.key);
        if (!l) {
          l = new GunLayer(g.key, g);
          map.set(g.key, l);
          changed = true;
        } else if (l.meta.state !== g.state || l.meta.object !== g.object) changed = true;
        l.setMeta(g);
        if (l.received < l.wanted) void pull(l);
      }
      if (changed) publish();
    };
    const load = async () => {
      try {
        const r = await fetch("/api/spray", { cache: "no-store" });
        const d = (await r.json()) as { station: string | null; guns: GunMeta[] };
        if (alive) reconcile(d.station === station ? d.guns : []);
      } catch {
         
      }
    };
    const reset = () => {
      for (const l of map.values()) l.dispose();
      map.clear();
      publish();
      void load();
    };
    void load();
    const off = onServerEvent((e) => {
      if (e.type === "snapshot") reset();
      else if (e.type === "spray" && e.station === station) reconcile((e.guns as GunMeta[]) ?? []);
    });
    return () => {
      alive = false;
      off();
      for (const l of map.values()) l.dispose();
      map.clear();
      setList([]);
    };
  }, [station]);

  return (
    <>
      {list.map((l) =>
        ws.items[l.meta.object] ? (
          <group key={l.key} matrixAutoUpdate={false} matrix={matFromRowMajor(abs(l.meta.object))} visible={l.meta.state !== 2}>
            <primitive object={l.group} />
          </group>
        ) : null,
      )}
    </>
  );
}
