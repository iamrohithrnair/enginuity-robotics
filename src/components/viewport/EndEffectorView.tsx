"use client";

 
 
 
 
 

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cmd } from "@/client/api";
import { useRC, useViewState, viewState } from "@/client/store";
import { fk, linkFrames } from "@/engine/kinematics";
import { mul } from "@/engine/math";
import type { Item, Workspace } from "@/engine/types";
import { absPose, activeToolOf, firstRobot, toolPose } from "@/engine/workspace";
import { Icon } from "../icons";
import { FLOOR_MIRROR } from "./Stage";

 
export const closeUp = { el: null as HTMLDivElement | null, suppress: false };

const PANEL_WIDTH: Record<string, number> = { inspector: 336, chat: 400 };

function robotOf(ws: Workspace, id: string): Item | null {
  for (let it: Item | undefined = ws.items[id]; it; it = it.parent ? ws.items[it.parent] : undefined) {
    if (it.type === "robot" && it.robot) return it;
    const link = it.target?.robot ?? it.program?.robot;
    if (link && ws.items[link]?.robot) return ws.items[link];
  }
  return null;
}



export function closeUpRobot(ws: Workspace | null): Item | null {
  if (!ws) return null;
  for (const id of ws.selection) {
    const r = robotOf(ws, id);
    if (r) return r;
  }
  return firstRobot(ws, ws.activeStation) ?? null;
}

export function EndEffectorCard() {
  const enabled = useRC((s) => s.settings.RC_EE_VIEW === true);
  const cinema = useViewState().cinema;
  const panel = useRC((s) => s.rightPanel);
  const robot = useRC((s) => closeUpRobot(s.ws));
  const toolName = useRC((s) => (s.ws && robot ? activeToolOf(s.ws, robot.id)?.name : undefined));
  if (!enabled || cinema || !robot) return null;
  const right = 12 + (PANEL_WIDTH[panel] ?? 0) + (PANEL_WIDTH[panel] ? 14 : 0);
  return (
    <div
      ref={(el) => {
        closeUp.el = el;
      }}
      className="rc-enter"
      aria-label="End effector close-up"
      style={{
        position: "fixed",
        top: "calc(var(--topbar-bottom, 58px) + 12px)",
        right,
        width: "clamp(240px, 23vw, 360px)",
        aspectRatio: "3 / 2",
        zIndex: 25,
        borderRadius: 14,
        boxShadow: "0 0 0 1px var(--hair), var(--glass-shadow)",
        pointerEvents: "auto",
      }}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        style={{ position: "absolute", left: 8, top: 8, right: 8, display: "flex", alignItems: "center", gap: 6, pointerEvents: "none" }}
      >
        <span className="glass glass-pill" style={{ padding: "3px 9px", font: "600 11px var(--font-ui)", color: "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {robot.name}
          {toolName ? ` · ${toolName}` : " · flange"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="g-btn icon ghost glass glass-pill"
          style={{ width: 24, height: 24, pointerEvents: "auto" }}
          title="Hide close-up"
          aria-label="Hide end effector close-up"
          onClick={() => void cmd("view.rendering", { endEffectorView: false })}
        >
          <Icon.Close size={12} />
        </button>
      </div>
    </div>
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
uniform vec2 size;
uniform float radius;
varying vec2 vUv;
float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  float d = roundedBox((vUv - 0.5) * size, size * 0.5, radius);
  gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0 - smoothstep(-0.75, 0.75, d));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

 
const sizeCache = new WeakMap<object, number>();
function robotSize(robot: Item): number {
  const model = robot.robot!.model;
  let s = sizeCache.get(model);
  if (s === undefined) {
    const frames = linkFrames(model, robot.robot!.home.length ? robot.robot!.home : robot.robot!.joints);
    s = Math.max(300, ...frames.map((f) => Math.hypot(f[3], f[7], f[11])));
    sizeCache.set(model, s);
  }
  return s;
}

interface Resources {
  fbo: THREE.WebGLRenderTarget;
  view: THREE.PerspectiveCamera;
  hudScene: THREE.Scene;
  hudCamera: THREE.OrthographicCamera;
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  follow: { robot: string; target: THREE.Vector3; dir: THREE.Vector3; ready: boolean };
  v: { dir: THREE.Vector3; tcp: THREE.Vector3; flange: THREE.Vector3; aim: THREE.Vector3; clear: THREE.Color };
}

function createResources(): Resources {
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, size: { value: new THREE.Vector2(1, 1) }, radius: { value: 14 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: true,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  const hudScene = new THREE.Scene();
  hudScene.add(quad);
  return {
    fbo: new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }),
    view: new THREE.PerspectiveCamera(34, 1.5, 0.005, 200),
    hudScene,
    hudCamera: new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10),
    quad,
    follow: { robot: "", target: new THREE.Vector3(), dir: new THREE.Vector3(), ready: false },
    v: { dir: new THREE.Vector3(), tcp: new THREE.Vector3(), flange: new THREE.Vector3(), aim: new THREE.Vector3(), clear: new THREE.Color() },
  };
}

export function EndEffectorRenderer({ dark }: { dark: boolean }) {
   
  const res = useRef<Resources | null>(null);
  useEffect(
    () => () => {
      res.current?.fbo.dispose();
      res.current?.quad.geometry.dispose();
      res.current?.quad.material.dispose();
      res.current = null;
    },
    [],
  );
  const background = dark ? "#19191b" : "#ecece9";

  useFrame(({ gl, scene, camera, size }, dt) => {
    const el = closeUp.el;
    const st = useRC.getState();
    if (!el || closeUp.suppress || !el.isConnected || st.settings.RC_EE_VIEW !== true || viewState().cinema) return;
    const ws = st.ws;
    const robot = closeUpRobot(ws);
    const world = scene.getObjectByName("rc-world");
    if (!ws || !robot?.robot || !world) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    if (!res.current) res.current = createResources();
    const { fbo, view, hudScene, hudCamera, quad, follow: f, v } = res.current;

     
     
    const q = st.liveJoints[robot.id] ?? robot.robot.joints;
    const flange = mul(absPose(ws, robot.id), fk(robot.robot.model, q));
    const m = mul(flange, toolPose(ws, robot.id));
    world.localToWorld(v.tcp.set(m[3], m[7], m[11]));
    world.localToWorld(v.flange.set(flange[3], flange[7], flange[11]));
    v.aim.copy(v.tcp).lerp(v.flange, 0.4);
    const toolLength = v.tcp.distanceTo(v.flange);

     
    camera.getWorldDirection(v.dir);
    const flat = Math.hypot(v.dir.x, v.dir.z) || 1;
    const pitch = THREE.MathUtils.clamp(Math.asin(-v.dir.y), THREE.MathUtils.degToRad(12), THREE.MathUtils.degToRad(55));
    v.dir.set((v.dir.x / flat) * Math.cos(pitch), -Math.sin(pitch), (v.dir.z / flat) * Math.cos(pitch));

    if (!f.ready || f.robot !== robot.id) {
      f.target.copy(v.aim);
      f.dir.copy(v.dir);
      f.robot = robot.id;
      f.ready = true;
    } else {
      f.target.lerp(v.aim, 1 - Math.exp(-dt * 12));
      f.dir.lerp(v.dir, 1 - Math.exp(-dt * 6)).normalize();
    }
    const dist = THREE.MathUtils.clamp(Math.max(robotSize(robot) * 0.001 * 0.5, toolLength * 3.4), 0.25, 3);
    view.position.copy(f.target).addScaledVector(f.dir, -dist);
    view.lookAt(f.target);
    view.aspect = rect.width / rect.height;
    view.updateProjectionMatrix();

     
    const dpr = gl.getPixelRatio();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (fbo.width !== w || fbo.height !== h) fbo.setSize(w, h);
    const mirror = scene.getObjectByName(FLOOR_MIRROR);
    const mirrorVisible = mirror?.visible ?? false;
    if (mirror) mirror.visible = false;
    const autoShadow = gl.shadowMap.autoUpdate;
    const clearAlpha = gl.getClearAlpha();
    gl.getClearColor(v.clear);
    gl.shadowMap.autoUpdate = false;  
    gl.setRenderTarget(fbo);
    gl.setClearColor(background, 1);
    gl.clear(true, true, true);
    gl.render(scene, view);
    gl.setRenderTarget(null);
    gl.setClearColor(v.clear, clearAlpha);
    gl.shadowMap.autoUpdate = autoShadow;
    if (mirror) mirror.visible = mirrorVisible;

     
    hudCamera.right = size.width;
    hudCamera.top = size.height;
    hudCamera.updateProjectionMatrix();
     
    const canvas = gl.domElement.getBoundingClientRect();
    quad.position.set(rect.left - canvas.left + rect.width / 2, size.height - (rect.top - canvas.top + rect.height / 2), 0);
    quad.scale.set(rect.width, rect.height, 1);
    quad.material.uniforms.map.value = fbo.texture;
    quad.material.uniforms.size.value.set(rect.width, rect.height);
    const autoClear = gl.autoClear;
    gl.autoClear = false;
    gl.clearDepth();
    gl.render(hudScene, hudCamera);
    gl.autoClear = autoClear;
  }, 2);
  return null;
}
