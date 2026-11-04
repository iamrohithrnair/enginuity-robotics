"use client";

import { GizmoHelper, GizmoViewport, TransformControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { cmd, selectNow } from "@/client/api";
import { activateItem } from "@/client/interaction";
import { useRC, useViewState, type DragPreview } from "@/client/store";
import { runAction } from "@/client/uiActions";
import { findAction } from "@/engine/actions";
import { fk, ikClosest, initKinematics, kinematicsReady, linkFrames } from "@/engine/kinematics";
import { inv, mul, type Mat } from "@/engine/math";
import type { Item, MeshRef, ViewState, Workspace } from "@/engine/types";
import { frameKindOf, frameSize, showsText, TRACE_STYLES } from "@/engine/view";
import { absPose, childFrame, descendants, toolPose } from "@/engine/workspace";
import { ContextMenu } from "../glass/Menu";
import { itemMenu } from "../tree/menus";
import { EndEffectorCard, EndEffectorRenderer } from "./EndEffectorView";
import { CameraRenderer, CameraWindows } from "./CameraView";
import { loadGeometry, matFromRowMajor } from "./geometry";
import { CameraRig } from "./Navigation";
import { FLOOR_ORDER, Stage } from "./Stage";
import { CurveLayer } from "./Curves";
import { SprayLayer } from "./Spray";
import { ViewPickResponder } from "./ViewPick";
import { WorkspaceEnvelopes } from "./WorkspaceEnvelope";
import ExampleBar from "./ExampleBar";
import { robotShowFrames } from "@/engine/commands/robot-display";

const MM = 0.001;





function useSceneWorkspace(): Workspace | null {
  return useRC((s) => s.ws);
}

 
const liveGroups = new Map<string, THREE.Group>();
const liveRefs = new Map<string, (g: THREE.Group | null) => void>();
function liveRef(key: string) {
  let f = liveRefs.get(key);
  if (!f) {
    f = (g) => {
      if (g) liveGroups.set(key, g);
      else liveGroups.delete(key);
    };
    liveRefs.set(key, f);
  }
  return f;
}
function setLiveGroup(key: string, m: Mat) {
  const g = liveGroups.get(key);
  if (!g) return;
  matFromRowMajor(m, g.matrix);
  g.matrixWorldNeedsUpdate = true;
}






function LiveUpdater() {
  const prev = useRef(new Set<string>());
  useFrame(() => {
    const { ws, liveJoints: live } = useRC.getState();
    const ids = Object.keys(live);
    if (!ws || (!ids.length && !prev.current.size)) return;
    const robots = new Set([...ids, ...prev.current]);
    prev.current = new Set(ids);
    for (const id of robots) {
      const r = ws.items[id];
      if (!r?.robot || !kinematicsReady()) continue;
      const base = absPose(ws, id);
      linkFrames(r.robot.model, live[id] ?? r.robot.joints).forEach((f, li) => setLiveGroup(`${id}:${li}`, mul(base, f)));
      for (const d of descendants(ws, id)) {
        setLiveGroup(d.id, absPose(ws, d.id, live));
        if (d.type === "tool") setLiveGroup(`${d.id}:mesh`, childFrame(ws, d.parent, live));
      }
    }
  });
  return null;
}

 
function Invalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const unsub = useRC.subscribe(() => invalidate());
    const onInput = () => invalidate();
    const events = ["pointerdown", "pointermove", "pointerup", "wheel", "keydown", "resize"] as const;
    for (const e of events) window.addEventListener(e, onInput, { passive: true });
    return () => {
      unsub();
      for (const e of events) window.removeEventListener(e, onInput);
    };
  }, [invalidate]);
  return null;
}

 
const MAX_DPR = typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 4) >= 8 ? 2 : 1.5;

function useKinematicsReady() {
  const ready = useRC((s) => s.kinReady);
  useEffect(() => {
    if (!ready) void initKinematics().then(() => useRC.setState({ kinReady: true }));
  }, [ready]);
  return ready || kinematicsReady();
}

 

 
function AxisTriad({ size = 100, opacity = 1, thin = false }: { size?: number; opacity?: number; thin?: boolean }) {
  const r = thin ? size * 0.012 : size * 0.025;
  const axes: { dir: [number, number, number]; color: string }[] = [
    { dir: [1, 0, 0], color: "#ff4d42" },
    { dir: [0, 1, 0], color: "#33d65e" },
    { dir: [0, 0, 1], color: "#2d8cff" },
  ];
  return (
    <group>
      {axes.map(({ dir, color }) => {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
        return (
          <group key={color} quaternion={q}>
            <mesh position={[0, size * 0.4, 0]}>
              <cylinderGeometry args={[r, r, size * 0.8, 10]} />
              <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={0.35} metalness={0.1} />
            </mesh>
            <mesh position={[0, size * 0.89, 0]}>
              <coneGeometry args={[r * 2.6, size * 0.22, 14]} />
              <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={0.35} metalness={0.1} />
            </mesh>
          </group>
        );
      })}
      <mesh>
        <sphereGeometry args={[r * 1.7, 14, 14]} />
        <meshStandardMaterial color="#ececec" roughness={0.4} />
      </mesh>
    </group>
  );
}





const labelRegistry = new Map<number, { obj: THREE.Object3D; text: string; tone: "dark" | "accent" }>();
let labelSeq = 0;

function Label({ text, tone = "dark" }: { text: string; tone?: "dark" | "accent" }) {
  const ref = useRef<THREE.Group>(null);
  const id = useMemo(() => ++labelSeq, []);
  useEffect(() => {
    if (ref.current) labelRegistry.set(id, { obj: ref.current, text, tone });
    return () => void labelRegistry.delete(id);
  }, [id, text, tone]);
  return <group ref={ref} />;
}

function LabelLayer() {
  const { camera, size, gl } = useThree();
  const nodes = useRef(new Map<number, HTMLDivElement>());
  const layer = useMemo(() => {
    if (typeof document === "undefined") return null;
    let el = document.getElementById("rc-labels") as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = "rc-labels";
      Object.assign(el.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2" });
      document.body.appendChild(el);
    }
    return el;
  }, []);
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!layer) return;
     
    const origin = gl.domElement.getBoundingClientRect();
    const seen = new Set<number>();
     
     
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const entries = [...labelRegistry].sort((a, b) => (a[1].tone === "accent" ? 0 : 1) - (b[1].tone === "accent" ? 0 : 1));
    for (const [id, l] of entries) {
      seen.add(id);
      let n = nodes.current.get(id);
      if (!n) {
        n = document.createElement("div");
        Object.assign(n.style, {
          position: "absolute",
          left: "0",
          top: "0",
          whiteSpace: "nowrap",
          padding: "3px 8px",
          borderRadius: "999px",
          font: "600 11px var(--font-ui)",
          color: "var(--label-ink)",
          backdropFilter: "blur(10px) saturate(160%)",
          boxShadow: "0 0 0 1px var(--hair), 0 2px 8px rgba(0,0,0,.12)",
          willChange: "transform",
        } as Partial<CSSStyleDeclaration>);
        layer.appendChild(n);
        nodes.current.set(id, n);
      }
      if (n.textContent !== l.text) {
        n.textContent = l.text;
        delete n.dataset.w;
      }
      n.style.background = l.tone === "accent" ? "var(--accent)" : "var(--label-bg)";
      n.style.color = l.tone === "accent" ? "var(--on-accent)" : "var(--label-ink)";
      l.obj.getWorldPosition(v);
      v.project(camera);
      let visible = v.z < 1 && v.z > -1;
      if (visible) {
        const x = origin.left + ((v.x + 1) / 2) * size.width;
        const y = origin.top + ((1 - v.y) / 2) * size.height - 22;
        if (!n.dataset.w) {
          n.style.display = "block";
          n.dataset.w = String(n.offsetWidth || l.text.length * 7 + 16);
        }
        const w = Number(n.dataset.w);
        const r = { x0: x - w / 2, y0: y - 10, x1: x + w / 2, y1: y + 10 };
        if (placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0)) visible = false;
        else {
          placed.push(r);
          n.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      }
      n.style.display = visible ? "block" : "none";
    }
    for (const [id, n] of nodes.current) {
      if (!seen.has(id)) {
        n.remove();
        nodes.current.delete(id);
      }
    }
  });
  return null;
}

 
const COLLISION_COLOR = new THREE.Color("#ff3b30");

function MeshList({
  meshes,
  selected,
  colliding,
  hovered,
  override,
  ghost,
  onPick,
}: {
  meshes: MeshRef[];
  selected?: boolean;
  colliding?: boolean;
  hovered?: boolean;
  override?: [number, number, number, number];
  ghost?: boolean;
  onPick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const [geoms, setGeoms] = useState<(THREE.BufferGeometry | null)[]>(() => meshes.map(() => null));
  const key = meshes.map((m) => m.geometry + (m.normals ?? "")).join(",");
  useEffect(() => {
    let alive = true;
    void Promise.all(meshes.map((m) => loadGeometry(m.geometry, m.normals).catch(() => null))).then((g) => alive && setGeoms(g));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <>
      {meshes.map((m, i) => {
        if (!geoms[i]) return null;
         
        const c = override ?? m.color;
        const alpha = ghost ? 0.25 : colliding ? 0.62 : c[3];
        return (
          <mesh key={i} geometry={geoms[i]!} castShadow receiveShadow renderOrder={ghost || colliding || alpha < 1 ? FLOOR_ORDER.translucent : 0} onClick={onPick} onDoubleClick={onPick}>
            <meshPhysicalMaterial
              color={colliding ? COLLISION_COLOR : new THREE.Color(c[0], c[1], c[2])}
              emissive={colliding ? COLLISION_COLOR : selected ? new THREE.Color("#2563eb") : hovered ? new THREE.Color("#4f8cff") : new THREE.Color(0, 0, 0)}
              emissiveIntensity={colliding ? 0.35 : selected ? 0.12 : hovered ? 0.06 : 0}
              roughness={0.42}
              metalness={0.08}
              clearcoat={0.55}
              clearcoatRoughness={0.3}
              transparent={ghost || colliding || alpha < 1}
              opacity={alpha}
              depthWrite={!colliding}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </>
  );
}

 
function ProceduralLinks({ frames, selected }: { frames: number[][]; selected: boolean }) {
  const segs = useMemo(() => {
    const out: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
    for (let i = 0; i + 1 < frames.length; i++) {
      const a = new THREE.Vector3(frames[i][3], frames[i][7], frames[i][11]);
      const b = new THREE.Vector3(frames[i + 1][3], frames[i + 1][7], frames[i + 1][11]);
      if (a.distanceTo(b) > 1) out.push({ a, b });
    }
    return out;
  }, [frames]);
  return (
    <group>
      {segs.map(({ a, b }, i) => {
        const len = a.distanceTo(b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        return (
          <mesh key={i} position={mid} quaternion={q} castShadow>
            <capsuleGeometry args={[Math.max(18, 48 - i * 6), len, 8, 24]} />
            <meshPhysicalMaterial color={i % 2 ? "#f2f4f7" : "#ff7a1a"} roughness={0.35} clearcoat={0.4} emissive={selected ? "#0a84ff" : "#000"} emissiveIntensity={selected ? 0.3 : 0} />
          </mesh>
        );
      })}
    </group>
  );
}

 

 
function usePoses(ws: Workspace, drag: DragPreview | null) {
  return useMemo(() => {
    const moved = new Set<string>();
    if (drag) for (const id of drag.ids) for (const it of [ws.items[id], ...descendants(ws, id)]) if (it) moved.add(it.id);
    const abs = (id: string): Mat => (drag && moved.has(id) ? mul(drag.motion, absPose(ws, id)) : absPose(ws, id));
    const child = (id: string | null, of: string): Mat => (drag && moved.has(of) ? mul(drag.motion, childFrame(ws, id)) : childFrame(ws, id));
    return { abs, child };
  }, [ws, drag]);
}

const shown = (it: Item, key: string) => it.params?.[key] !== "0";

function SceneContent({ ws }: { ws: Workspace }) {
  const view = useViewState();
  const settings = useRC((s) => s.settings);
  const selection = useRC((s) => s.ws?.selection ?? []);
  const collisions = useRC((s) => s.collisions);
  const hover = useRC((s) => s.hover);
  const drag = useRC((s) => s.drag);
  const station = ws.activeStation;
  const items = useMemo(() => (station ? descendants(ws, station) : []), [ws, station]);
  const { abs, child } = usePoses(ws, drag);
  const size = (type: Item["type"]) => frameSize(settings, frameKindOf(type));
  const text = (type: Item["type"]) => showsText(settings, view, type);

   
   
  const showHiddenSelected = settings.ShowHiddenSelected !== false;
  const visibleChain = (it: Item) => it.visible || (showHiddenSelected && selection.includes(it.id));

   
  const pick = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.nativeEvent.button !== 0) return;
    const st = useRC.getState();
    if (st.measureOpen) return;  
    if (e.type === "dblclick") {
      if (st.apiEvents) void fetch("/api/uievent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: 15, item: id, click: 3 }) }).catch(() => undefined);
      void activateItem(id, { alt: e.nativeEvent.altKey });
      return;
    }
    if (Date.now() - st.suppressClick < 250) return;
    if (st.moveMode !== "default" && st.ws?.selection.includes(id)) return;
    const multi = e.nativeEvent.metaKey || e.nativeEvent.ctrlKey;
    void selectNow([id], multi ? "toggle" : "replace");
  };

   
  const objectFrame = (it: Item) => (it.params?.ShowFrame !== undefined ? it.params.ShowFrame !== "0" : settings.ShowRef_NewObjects === true);

  return (
    <group name="rc-world" rotation-x={-Math.PI / 2} scale={MM}>
      {items.map((it) => {
        if (!visibleChain(it)) return null;
        const sel = selection.includes(it.id);
        const coll = collisions.includes(it.id);
        const hov = hover === it.id && !sel;
        if (it.type === "robot" && it.robot) {
          const base = abs(it.id);
          const frames = linkFrames(it.robot.model, it.robot.joints).map((f) => mul(base, f));
          const hasMeshes = it.robot.links.some((l) => l.length);
          const hasTool = it.children.some((c) => ws.items[c]?.type === "tool");
          return (
            <group key={it.id} userData={{ itemId: it.id }}>
              {hasMeshes ? (
                 
                it.robot.links.slice(0, frames.length).map((meshes, li) => (
                  <group key={li} ref={liveRef(`${it.id}:${li}`)} matrixAutoUpdate={false} matrix={matFromRowMajor(frames[li])}>
                    <MeshList meshes={meshes} selected={sel} colliding={coll} hovered={hov} override={it.color} onPick={pick(it.id)} />
                  </group>
                ))
              ) : (
                <group onClick={pick(it.id)}>
                  <ProceduralLinks frames={frames} selected={sel} />
                </group>
              )}
              { }
              {view.frames &&
                robotShowFrames(it).links.map((li) =>
                  frames[li] && li < frames.length - 1 ? (
                    <group key={`lf${li}`} matrixAutoUpdate={false} matrix={matFromRowMajor(frames[li])}>
                      <AxisTriad size={size("robot")} thin />
                    </group>
                  ) : null,
                )}
              { }
              {view.frames && !hasTool && shown(it, "ShowFlange") && (
                <group matrixAutoUpdate={false} matrix={matFromRowMajor(frames[frames.length - 1])}>
                  <AxisTriad size={size("robot")} thin />
                </group>
              )}
              {text("robot") && (
                <group matrixAutoUpdate={false} matrix={matFromRowMajor(base)}>
                  <Label text={it.name} tone={sel ? "accent" : "dark"} />
                </group>
              )}
            </group>
          );
        }
        const m = matFromRowMajor(abs(it.id));
        if (it.type === "frame") {
           
          const refOff = items.some((r) => r.type === "robot" && r.robot?.activeFrame === it.id && r.params?.ShowRefFrame === "0");
          const triad = view.frames && shown(it, "ShowFrame") && !refOff;
          return triad || text("frame") ? (
            <group key={it.id} ref={liveRef(it.id)} userData={{ itemId: it.id }} matrixAutoUpdate={false} matrix={m} onClick={pick(it.id)}>
              {triad && <AxisTriad size={size("frame")} />}
              {text("frame") && <Label text={it.name} tone={sel ? "accent" : "dark"} />}
            </group>
          ) : null;
        }
        if (it.type === "tool") {
           
          return (
            <group key={it.id} ref={liveRef(it.id)} userData={{ itemId: it.id }} matrixAutoUpdate={false} matrix={m}>
              {view.frames && shown(it, "ShowTCP") && shown(it, "ShowToolFrame") && !(it.parent && ws.items[it.parent]?.params?.ShowToolFrame === "0") && <AxisTriad size={size("tool")} thin />}
              {text("tool") && <Label text={it.name} tone={sel ? "accent" : "dark"} />}
            </group>
          );
        }
        if (it.type === "object") {
          return (
            <group key={it.id} ref={liveRef(it.id)} userData={{ itemId: it.id }} matrixAutoUpdate={false} matrix={m}>
              <MeshList meshes={it.object?.meshes ?? []} selected={sel} colliding={coll} hovered={hov} override={it.color} onPick={pick(it.id)} />
              {view.frames && objectFrame(it) && <AxisTriad size={size("object")} thin />}
              {text("object") && <Label text={it.name} tone={sel ? "accent" : "dark"} />}
            </group>
          );
        }
        if (it.type === "target") {
          const color = it.target?.isJoint ? "#bf5af2" : "#ff9f0a";
          return (
            <group key={it.id} ref={liveRef(it.id)} userData={{ itemId: it.id }} matrixAutoUpdate={false} matrix={m} onClick={pick(it.id)} onDoubleClick={pick(it.id)}>
              <mesh>
                <sphereGeometry args={[10, 20, 20]} />
                <meshPhysicalMaterial color={color} emissive={sel ? "#0a84ff" : color} emissiveIntensity={sel ? 0.6 : hov ? 0.45 : 0.25} roughness={0.2} clearcoat={1} />
              </mesh>
              {view.frames && shown(it, "ShowFrame") && <AxisTriad size={size("target")} thin opacity={0.95} />}
              {text("target") && <Label text={it.name} tone={sel ? "accent" : "dark"} />}
            </group>
          );
        }
        return null;
      })}
      { }
      {items
        .filter((it) => it.type === "tool" && it.tool?.meshes.length && visibleChain(it))
        .map((it) => (
          <group key={`${it.id}-mesh`} ref={liveRef(`${it.id}:mesh`)} userData={{ itemId: it.id }} matrixAutoUpdate={false} matrix={matFromRowMajor(child(it.parent, it.id))}>
            <MeshList meshes={it.tool!.meshes} selected={selection.includes(it.id)} colliding={collisions.includes(it.id)} hovered={hover === it.id} override={it.color} onPick={pick(it.id)} />
          </group>
        ))}
      <PreviewGhosts ws={ws} />
      <ProgramPaths ws={ws} items={items} abs={abs} />
      <Trace view={view} />
      <WorkspaceEnvelopes ws={ws} items={items} view={view} />
      <CurveLayer ws={ws} items={items} abs={abs} />
      <SprayLayer ws={ws} abs={abs} />
      <MeasureMarkers />
      <MoveGizmo ws={ws} />
    </group>
  );
}

 
function PreviewGhosts({ ws }: { ws: Workspace }) {
  const preview = useRC((s) => s.preview);
  const robot = preview ? ws.items[preview.robot] : undefined;
  if (!preview || !robot?.robot) return null;
  const base = absPose(ws, robot.id);
  return (
    <group userData={{ ignoreFit: true }}>
      {preview.joints.map((q, k) => {
        const frames = linkFrames(robot.robot!.model, q).map((f) => mul(base, f));
        return (
          <group key={k}>
            {robot.robot!.links.slice(0, frames.length).map((meshes, li) => (
              <group key={li} matrixAutoUpdate={false} matrix={matFromRowMajor(frames[li])}>
                <MeshList meshes={meshes} ghost />
              </group>
            ))}
          </group>
        );
      })}
    </group>
  );
}

 
function ProgramPaths({ ws, items, abs }: { ws: Workspace; items: Item[]; abs: (id: string) => Mat }) {
  const selection = useRC((s) => s.ws?.selection ?? []);
  const dark = useRC((s) => s.settings.RC_THEME) === "dark";
  const lines = useMemo(() => {
    const out: { id: string; pts: THREE.Vector3[]; sel: boolean }[] = [];
    for (const p of items) {
      if (p.type !== "program") continue;
      const pts: THREE.Vector3[] = [];
      for (const c of p.children) {
        const ins = ws.items[c]?.instruction;
        for (const t of [ins?.target, ins?.target2]) {
          if (t && ws.items[t]) {
            const m = abs(t);
            pts.push(new THREE.Vector3(m[3], m[7], m[11]));
          }
        }
      }
      const sel = selection.includes(p.id) || p.children.some((c) => selection.includes(c));
       
      const display = (p.program as { displayPath?: boolean } | undefined)?.displayPath !== false;
      if (pts.length > 1 && (sel || display)) out.push({ id: p.id, pts, sel });
    }
    return out;
  }, [ws, items, selection, abs]);
  return (
    <>
      {lines.map((l) => (
        <line key={l.id}>
          <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints(l.pts)} />
          <lineBasicMaterial attach="material" color={l.sel ? (dark ? "#67e8f9" : "#0284c7") : dark ? "#fbbf24" : "#d97706"} transparent opacity={l.sel ? 1 : 0.8} />
        </line>
      ))}
    </>
  );
}

 

function tcpOf(ws: Workspace, robot: Item): Mat {
  return mul(mul(absPose(ws, robot.id), fk(robot.robot!.model, robot.robot!.joints)), toolPose(ws, robot.id));
}





function Trace({ view }: { view: ViewState }) {
  const paths = useRC((s) => s.trace);
  const style = TRACE_STYLES[Number(useRC((s) => s.settings.Trace_Render_Style ?? 0))] ?? "References";
  const pathSize = Number(useRC((s) => s.settings.FrameSizesPath ?? 150)) || 150;
  const geo = useMemo(() => {
    const out: { id: string; points: Float32Array; frames: Float32Array; colors: Float32Array }[] = [];
    for (const [id, samples] of Object.entries(paths)) {
      if (samples.length < 1) continue;
      const points = new Float32Array(samples.length * 3);
      samples.forEach((s, i) => points.set([s[3], s[7], s[11]], i * 3));
       
      const L = pathSize * 0.2;
      const fr: number[] = [];
      const col: number[] = [];
      let last: number[] | null = null;
      for (const s of samples) {
        if (last && Math.hypot(s[3] - last[3], s[7] - last[7], s[11] - last[11]) < pathSize * 0.05) continue;
        last = s;
        const o = [s[3], s[7], s[11]];
        [[s[0], s[4], s[8], 1, 0.3, 0.26], [s[1], s[5], s[9], 0.2, 0.84, 0.37], [s[2], s[6], s[10], 0.18, 0.55, 1]].forEach(([x, y, z, r, g, b]) => {
          fr.push(o[0], o[1], o[2], o[0] + x * L, o[1] + y * L, o[2] + z * L);
          col.push(r, g, b, r, g, b);
        });
      }
      out.push({ id, points, frames: new Float32Array(fr), colors: new Float32Array(col) });
    }
    return out;
  }, [paths, pathSize]);
  if (!view.trace && !geo.length) return null;
  return (
    <group userData={{ ignoreFit: true }}>
      {geo.map((g) => (
        <group key={`${g.id}-${style}`}>
          {style === "Line" && (
            <line>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[g.points, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color="#ff375f" />
            </line>
          )}
          {(style === "Dots" || style === "Points") && (
            <points>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[g.points, 3]} />
              </bufferGeometry>
              <pointsMaterial color="#ff375f" size={style === "Dots" ? 3 : 7} sizeAttenuation={false} />
            </points>
          )}
          {style === "Spheres" && <TraceSpheres points={g.points} radius={pathSize * 0.02} />}
          {style === "References" && (
            <lineSegments>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[g.frames, 3]} />
                <bufferAttribute attach="attributes-color" args={[g.colors, 3]} />
              </bufferGeometry>
              <lineBasicMaterial vertexColors />
            </lineSegments>
          )}
        </group>
      ))}
    </group>
  );
}

function TraceSpheres({ points, radius }: { points: Float32Array; radius: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const n = points.length / 3;
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, m.makeTranslation(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
    mesh.instanceMatrix.needsUpdate = true;
  }, [points, n]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, n]}>
      <sphereGeometry args={[radius, 10, 10]} />
      <meshStandardMaterial color="#ff375f" roughness={0.4} />
    </instancedMesh>
  );
}

 
function MeasureMarkers() {
  const open = useRC((s) => s.measureOpen);
  const m = useRC((s) => s.measure);
  if (!open) return null;
  const pts = [m.a, m.b].filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <group userData={{ ignoreFit: true }}>
      {pts.map((p, i) => (
        <mesh key={i} position={p.point}>
          <sphereGeometry args={[6, 16, 16]} />
          <meshBasicMaterial color="#2563eb" depthTest={false} />
        </mesh>
      ))}
      {pts.length === 2 && (
        <line>
          <bufferGeometry onUpdate={(g) => g.setFromPoints(pts.map((p) => new THREE.Vector3(...p.point)))} />
          <lineBasicMaterial color="#2563eb" depthTest={false} />
        </line>
      )}
    </group>
  );
}





function MoveGizmo({ ws }: { ws: Workspace }) {
  const sel = ws.selection.length === 1 ? ws.items[ws.selection[0]] : undefined;
  const moveTool = useRC((s) => s.moveTool);
   
  const [dummy, setDummy] = useState<THREE.Object3D | null>(null);
  const [dragging, setDragging] = useState(false);
  const target = sel && ["frame", "object", "target", "robot", "tool"].includes(sel.type) && !(sel as Item & { locked?: boolean }).locked ? sel : undefined;
  const active = !!target && (moveTool || dragging);
  const pose = target ? (target.type === "robot" ? tcpOf(ws, target) : absPose(ws, target.id)) : null;
  useEffect(() => {
    if (!dummy || !pose || dragging) return;
    matFromRowMajor(pose).decompose(dummy.position, dummy.quaternion, dummy.scale);
  }, [pose, dummy, dragging]);
  if (!target || !pose) return null;
  const handlePose = (o: THREE.Object3D) => {
    o.updateMatrix();
    const e = o.matrix.elements;  
    return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14], 0, 0, 0, 1];
  };
  const commit = (o: THREE.Object3D) => {
    const m = handlePose(o);
    if (target.type === "robot") void cmd("robot.moveTo", { robot: target.id, pose: m, relativeTo: "station" }, { quiet: true });
    else void cmd("item.setPose", { item: target.id, pose: m, relativeTo: "station" }, { quiet: true });
  };
  return (
    <group userData={{ ignoreFit: true }}>
      <object3D ref={setDummy} />
      {active && dummy && (
        <TransformControls
          object={dummy}
          mode="translate"
          size={0.9}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => {
            setDragging(false);
            if (target.type === "robot") {
              const lj = { ...useRC.getState().liveJoints };
              delete lj[target.id];
              useRC.setState({ liveJoints: lj });
            }
            commit(dummy);
          }}
          onObjectChange={() => {
             
            if (target.type !== "robot" || !target.robot) return;
            const flange = mul(mul(inv(absPose(ws, target.id)), handlePose(dummy)), inv(toolPose(ws, target.id)));
            const q = ikClosest(target.robot.model, flange, useRC.getState().liveJoints[target.id] ?? target.robot.joints);
            if (q) useRC.setState({ liveJoints: { ...useRC.getState().liveJoints, [target.id]: q } });
          }}
        />
      )}
    </group>
  );
}

 
function ViewOverlays() {
  const rubber = useRC((s) => s.rubber);
  const menu = useRC((s) => s.viewMenu);
  const ws = useRC((s) => s.ws);
  const entry = (name: string) => {
    const a = findAction(name);
    return { label: a?.text.replace(/\.\.\.$/, "…") ?? name, shortcut: a?.shortcut, onSelect: () => void runAction(name) };
  };
  return (
    <>
      {rubber && (
        <div
          style={{
            position: "fixed",
            left: Math.min(rubber.x0, rubber.x1),
            top: Math.min(rubber.y0, rubber.y1),
            width: Math.abs(rubber.x1 - rubber.x0),
            height: Math.abs(rubber.y1 - rubber.y0),
            zIndex: 20,
            borderRadius: 6,
            border: "1px solid var(--accent)",
            background: "var(--accent-soft)",
            pointerEvents: "none",
          }}
        />
      )}
      {menu && ws && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={
            menu.item && ws.items[menu.item]
              ? itemMenu(ws, menu.item, { from3D: true })
              : [entry("actionFit_All"), entry("actionIsometric"), entry("actionTop"), entry("actionFront"), { separator: true }, entry("actionAdd_Frame"), entry("actionOpen_weblib")]
          }
          onClose={() => useRC.setState({ viewMenu: null })}
        />
      )}
    </>
  );
}

export default function Viewport() {
  const ws = useSceneWorkspace();
  const ready = useKinematicsReady();
  const view = useViewState();
  const dark = useRC((s) => s.settings.RC_THEME) === "dark";
  const shadows = useRC((s) => s.settings.RC_SHADOWS !== false);
  const reflections = useRC((s) => s.settings.RC_REFLECTIONS !== false);
   
  const rightPanel = useRC((s) => s.rightPanel);
  const gizmoX = rightPanel === "chat" ? 484 : rightPanel === "inspector" ? 420 : 86;
   
  const grid = useRC((s) => {
    const st = s.ws?.activeStation ? s.ws.items[s.ws.activeStation] : undefined;
    return st?.params?.ShowGrid !== "0";
  });
  const docked = view.treeVisible && !view.treeInside;
  return (
    <>
      <ViewOverlays />
      <ExampleBar />
      <EndEffectorCard />
      <CameraWindows />
      <Canvas
        shadows="variance"
        frameloop="demand"
        dpr={[1, MAX_DPR]}
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
        onPointerMissed={(e) => {
           
          const st = useRC.getState();
          if (e.type === "click" && e.button === 0 && !st.measureOpen && Date.now() - st.suppressClick > 250) void selectNow([]);
        }}
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: docked ? "clamp(250px, 17vw, 340px)" : 0 }}
        onCreated={({ gl, scene, camera }) => {
          gl.setClearColor(0x000000, 0);
          gl.domElement.dataset.rcMain = "1";
          scene.background = null;
           
          if (process.env.NODE_ENV !== "production") Object.assign(window, { __rc3d: { gl, scene, camera } });
        }}
      >
        <fog attach="fog" args={[dark ? "#141415" : "#e6e6e3", 9, 34]} />
        <Stage dark={dark} shadows={shadows} reflections={reflections} grid={grid} />
        <Suspense fallback={null}>{ws && ready ? <SceneContent ws={ws} /> : null}</Suspense>
        <LiveUpdater />
        <Invalidator />
        <CameraRig />
        <ViewPickResponder />
        <LabelLayer />
        <GizmoHelper alignment="bottom-right" margin={[gizmoX, 150]}>
          <GizmoViewport axisColors={["#ff4d42", "#33d65e", "#2d8cff"]} labelColor="#18181b" />
        </GizmoHelper>
        <EndEffectorRenderer dark={dark} />
        <CameraRenderer dark={dark} />
      </Canvas>
    </>
  );
}

