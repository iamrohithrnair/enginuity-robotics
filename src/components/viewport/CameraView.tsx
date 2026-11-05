"use client";
// Renders simulated camera windows, frusta, and downloadable snapshots.

 
 
 
 
 
 
 

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cmd } from "@/client/api";
import { useRC } from "@/client/store";
import { cameraPose, cameraSettings } from "@/engine/commands/camera";
import type { Item } from "@/engine/types";
import type { CameraSettings } from "@/engine/utilities/camera";
import { Icon } from "../icons";

 
export const cameraWindows = new Map<string, HTMLDivElement>();

const settingsOf = (cam: Item) => cameraSettings({ settings: useRC.getState().settings as Record<string, number | string | boolean> }, cam);

 
export async function downloadCameraSnapshot(cam: Item) {
  const r = await cmd<{ dataUrl?: string }>("camera.snapshot", { camera: cam.id, inline: true });
  if (!r?.dataUrl) return;
  const a = document.createElement("a");
  a.href = r.dataUrl;
  a.download = `${cam.name.replace(/[\\/:*?"<>| ]+/g, "_")}_snapshot.png`;
  a.click();
}

function CameraWindow({ cam, index }: { cam: Item; index: number }) {
  const s = settingsOf(cam);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
   
  const maxW = typeof window === "undefined" ? s.width : Math.min(s.width, window.innerWidth * 0.42);
  const scale = maxW / s.width;
  const w = Math.round(s.width * scale);
  const h = Math.round(s.height * scale);
  const title = s.title || cam.name;
   
  const left = pos ? `${pos.x}px` : `calc(clamp(250px, 17vw, 340px) + ${24 + index * 28}px)`;
  const top = pos?.y ?? 110 + index * 28;
  return (
    <div
       
      ref={(el) => {
        if (el) cameraWindows.set(cam.id, el);
        else cameraWindows.delete(cam.id);
      }}
      className="rc-enter"
      role="dialog"
      aria-label={`Camera view ${title}`}
      style={{ position: "fixed", left, top, width: w, height: h, zIndex: 26, borderRadius: 12, boxShadow: "0 0 0 1px var(--hair), var(--glass-shadow)", pointerEvents: "auto" }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        style={{ position: "absolute", left: 8, top: 8, right: 8, display: "flex", alignItems: "center", gap: 6, cursor: "grab", userSelect: "none" }}
        onPointerDown={(e) => {
          const el = (e.currentTarget.parentElement as HTMLDivElement).getBoundingClientRect();
          const start = { x: e.clientX, y: e.clientY, left: el.left, top: el.top };
          const move = (ev: PointerEvent) => setPos({ x: start.left + ev.clientX - start.x, y: Math.max(0, start.top + ev.clientY - start.y) });
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        <span className="glass glass-pill" style={{ padding: "3px 9px", font: "600 11px var(--font-ui)", color: "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
          <span style={{ fontWeight: 500, color: "var(--ink-3)" }}>
            {" "}
            · {s.width}×{s.height} · FOV {Math.round(s.fov * 10) / 10}°{s.gray ? " · gray" : ""}
            {s.depth ? " · depth" : ""}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <button className="g-btn icon ghost glass glass-pill" style={{ width: 24, height: 24 }} title="Take snapshot" aria-label="Take snapshot" onPointerDown={(e) => e.stopPropagation()} onClick={() => void downloadCameraSnapshot(cam)}>
          <Icon.Camera size={12} />
        </button>
        <button
          className="g-btn icon ghost glass glass-pill"
          style={{ width: 24, height: 24 }}
          title="Close camera view"
          aria-label="Close camera view"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => void cmd("camera.window", { camera: cam.id, open: false })}
        >
          <Icon.Close size={12} />
        </button>
      </div>
    </div>
  );
}

 
export function CameraWindows() {
   
  const ws = useRC((s) => s.ws);
  const cams = useMemo(() => (ws ? Object.values(ws.items).filter((i) => i.type === "camera" && i.camera?.open) : []), [ws]);
  const cinema = useRC((s) => !!s.ws?.view?.cinema);
  if (cinema || !cams.length) return null;
  return (
    <>
      {cams.map((c, i) => (
        <CameraWindow key={c.id} cam={c} index={i} />
      ))}
    </>
  );
}

const VERT =   `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

 
 
const FRAG =   `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0);
  #include <colorspace_fragment>
}`;

interface CamRes {
  fbo: THREE.WebGLRenderTarget;
  view: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
}

 
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

function frustumPoints(s: CameraSettings, full: boolean): number[] {
   
  const far = full ? s.far : Math.min(s.far, 60 + s.focal);
  const near = full ? s.focal : 0;
  const t = Math.tan((s.fov * Math.PI) / 360);
  const asp = s.width / s.height;
  const corners = (z: number) => [
    [-t * z * asp, -t * z, z],
    [t * z * asp, -t * z, z],
    [t * z * asp, t * z, z],
    [-t * z * asp, t * z, z],
  ];
  const n = corners(near);
  const f = corners(far);
  const seg: number[] = [];
  for (let i = 0; i < 4; i++) {
    seg.push(...n[i], ...f[i]);
    seg.push(...f[i], ...f[(i + 1) % 4]);
    if (full) seg.push(...n[i], ...n[(i + 1) % 4]);
  }
   
  seg.push(0, -t * far, far, 0, -t * far * 1.25, far);
  return seg;
}

 
export function CameraRenderer({ dark }: { dark: boolean }) {
  const res = useRef(new Map<string, CamRes>());
  const glyphs = useRef(new Map<string, THREE.LineSegments>());
  const hud = useRef<{ scene: THREE.Scene; cam: THREE.OrthographicCamera; quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> } | null>(null);
  useEffect(() => {
    const r = res.current;
    const g = glyphs.current;
    return () => {
      r.forEach((x) => x.fbo.dispose());
      r.clear();
      g.forEach((l) => {
        l.removeFromParent();
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
      });
      g.clear();
      hud.current?.quad.geometry.dispose();
      hud.current?.quad.material.dispose();
    };
  }, []);

  useFrame(({ gl, scene, size }) => {
    const ws = useRC.getState().ws;
    const world = scene.getObjectByName("rc-world");
    if (!ws || !world) return;
    const cams = Object.values(ws.items).filter((i) => i.type === "camera" && i.camera && i.visible);

     
    const seen = new Set<string>();
    for (const cam of cams) {
      seen.add(cam.id);
      const s = settingsOf(cam);
      let line = glyphs.current.get(cam.id);
      if (!line) {
        line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: dark ? "#7fb2ff" : "#2563eb", transparent: true, opacity: 0.85 }));
        line.userData.ignoreFit = true;
        line.matrixAutoUpdate = false;
        world.add(line);
        glyphs.current.set(cam.id, line);
      }
      const key = `${s.fov}|${s.focal}|${s.far}|${s.width}|${s.height}|${s.showLimits}`;
      if (line.userData.key !== key) {
        line.geometry.setAttribute("position", new THREE.Float32BufferAttribute(frustumPoints(s, s.showLimits), 3));
        line.userData.key = key;
      }
      const m = cameraPose(ws, cam);
      line.matrix.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
      line.matrixWorldNeedsUpdate = true;
    }
    for (const [id, l] of glyphs.current)
      if (!seen.has(id)) {
        l.removeFromParent();
        l.geometry.dispose();
        (l.material as THREE.Material).dispose();
        glyphs.current.delete(id);
      }

     
    const open = cams.filter((c) => c.camera!.open && cameraWindows.get(c.id)?.isConnected);
    if (!open.length) return;
    if (!hud.current) {
      const material = new THREE.ShaderMaterial({ uniforms: { map: { value: null } }, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false });
      const sc = new THREE.Scene();
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      sc.add(quad);
      hud.current = { scene: sc, cam: new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10), quad };
    }
    const canvas = gl.domElement.getBoundingClientRect();
    const dpr = gl.getPixelRatio();
     
    const hidden: THREE.Object3D[] = [];
    for (const child of scene.children) if (child !== world && !(child as THREE.Light).isLight && child.visible) hidden.push(child);
    const glyphList: THREE.Object3D[] = [...glyphs.current.values()];
     
     
    world.traverse((o) => {
      const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (o.visible && g && (g.type === "CylinderGeometry" || g.type === "ConeGeometry" || g.type === "SphereGeometry")) glyphList.push(o);
    });
    const clear = new THREE.Color();
    gl.getClearColor(clear);
    const clearAlpha = gl.getClearAlpha();
    const autoShadow = gl.shadowMap.autoUpdate;
    const fog = scene.fog;
    for (const cam of open) {
      const el = cameraWindows.get(cam.id)!;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      const s = settingsOf(cam);
      let r = res.current.get(cam.id);
      if (!r) {
        r = { fbo: new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }), view: new THREE.PerspectiveCamera(), ortho: new THREE.OrthographicCamera() };
        res.current.set(cam.id, r);
      }
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (r.fbo.width !== w || r.fbo.height !== h) r.fbo.setSize(w, h);
       
      const m = cameraPose(ws, cam);
      const mat = new THREE.Matrix4().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11], 0, 0, 0, 1);
      const p = world.localToWorld(new THREE.Vector3().setFromMatrixPosition(mat));
      const q = world.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromRotationMatrix(mat)).multiply(FLIP);
      const scale = world.getWorldScale(new THREE.Vector3()).x;
      const view = s.ortho ? r.ortho : r.view;
      if (s.ortho) {
        const half = Math.tan((s.fov * Math.PI) / 360) * ((s.focal + s.far) / 2) * scale;
        r.ortho.left = (-half * rect.width) / rect.height;
        r.ortho.right = (half * rect.width) / rect.height;
        r.ortho.top = half;
        r.ortho.bottom = -half;
      } else {
        r.view.fov = s.fov;
        r.view.aspect = rect.width / rect.height;
      }
      view.near = Math.max(1e-4, s.focal * scale);
      view.far = s.far * scale;
      view.position.copy(p);
      view.quaternion.copy(q);
      view.updateProjectionMatrix();
      view.updateMatrixWorld(true);

      hidden.forEach((o) => (o.visible = false));
      glyphList.forEach((o) => (o.visible = false));
      scene.fog = null;
      gl.shadowMap.autoUpdate = false;
      gl.setRenderTarget(r.fbo);
      gl.setClearColor(new THREE.Color().setRGB(s.bg[0], s.bg[1], s.bg[2], THREE.SRGBColorSpace), 1);
      gl.clear(true, true, true);
      gl.render(scene, view);
      gl.setRenderTarget(null);
      hidden.forEach((o) => (o.visible = true));
      glyphList.forEach((o) => (o.visible = true));
      scene.fog = fog;

      const hd = hud.current;
      hd.cam.right = size.width;
      hd.cam.top = size.height;
      hd.cam.updateProjectionMatrix();
      hd.quad.position.set(rect.left - canvas.left + rect.width / 2, size.height - (rect.top - canvas.top + rect.height / 2), 0);
      hd.quad.scale.set(rect.width, rect.height, 1);
      hd.quad.material.uniforms.map.value = r.fbo.texture;
      const autoClear = gl.autoClear;
      gl.autoClear = false;
      gl.clearDepth();
      gl.render(hd.scene, hd.cam);
      gl.autoClear = autoClear;
    }
    gl.setClearColor(clear, clearAlpha);
    gl.shadowMap.autoUpdate = autoShadow;
    for (const [id, r] of res.current)
      if (!open.some((c) => c.id === id)) {
        r.fbo.dispose();
        res.current.delete(id);
      }
  }, 3);
  return null;
}
