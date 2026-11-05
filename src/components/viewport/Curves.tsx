"use client";
// Displays and edits curve geometry, point selections, and toolpath previews.

 
 
 
 
 

import { Line } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { cmd, selectNow } from "@/client/api";
import { useMachiningUi, type PickedFeature } from "@/client/machiningUi";
import { useRC } from "@/client/store";
import { objectCurves, objectPoints } from "@/engine/curves";
import { ikClosest } from "@/engine/kinematics";
import { projectLinks } from "@/engine/machining/project";
import { surfaceTargetPose } from "@/engine/machining/surface";
import { inv, mul, type Mat } from "@/engine/math";
import { DEFAULT_SETTINGS } from "@/engine/settings";
import type { ParticleShape } from "@/engine/spray/options";
import type { Item, Workspace } from "@/engine/types";
import { absPose, childFrame, firstRobot, toolPose } from "@/engine/workspace";
import { matFromRowMajor } from "./geometry";

const CURVE = "#0ea5e9";
const CURVE_PICKED = "#f59e0b";
const POINT = "#db2777";
const PATH_OK = "#22c55e";
const PATH_BAD = "#ef4444";
const NORMAL = "#a855f7";

const v3 = (r: number[]): [number, number, number] => [r[0], r[1], r[2]];






interface CurveDisplay {
  ratio: number;
  curvePoints: boolean;
  curvePointSize: number;
  curveNormals: boolean;
  curveNormalsOnSelect: boolean;
  pointNormals: boolean;
  pointNormalsOnSelect: boolean;
  normal: number;
  arrow: number;
  pickCurve: number;
  pickPoint: number;
}

function useCurveDisplay(): CurveDisplay {
  const settings = useRC((s) => s.settings);
  return useMemo(() => {
    const v = (k: string) => settings[k] ?? DEFAULT_SETTINGS[k];
    const on = (k: string) => [true, 1, "1", "true"].includes(v(k) as never);
    const num = (k: string) => Number(v(k)) || 0;
    return {
       
      ratio: Math.max(0.05, num("SizeRatioCurves")) / 0.5,
      curvePoints: on("ShowCurvePoints"),
      curvePointSize: Math.max(1, num("SizeCurvePoints")),
      curveNormals: on("ShowCurveNormals"),
      curveNormalsOnSelect: on("DisplayCurveNormalsOnSelect"),
      pointNormals: on("ShowPointNormals"),
      pointNormalsOnSelect: on("ShowSelectedPointNormals"),
      normal: Math.max(0.01, num("SizeNormals")),
      arrow: Math.max(0.01, num("SizeCurveArrow")),
      pickCurve: num("TolerancePickCurve"),
      pickPoint: num("TolerancePickPoint"),
    };
  }, [settings]);
}

const sprites = new Map<string, THREE.Texture>();
 
function pointSprite(color = POINT) {
  const cached = sprites.get(color);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.stroke();
  const sprite = new THREE.CanvasTexture(c);
  sprite.colorSpace = THREE.SRGBColorSpace;
  sprites.set(color, sprite);
  return sprite;
}

 
function PointParticles({ pts, particle, color }: { pts: number[][]; particle: ParticleShape; color: string }) {
  const geom = useMemo(() => {
    if (particle.kind === "cube") return new THREE.BoxGeometry(Math.abs(particle.size[0]) || 1, Math.abs(particle.size[1]) || 1, Math.abs(particle.size[2]) || 1);
    if (particle.kind === "sphere") {
      const g = new THREE.SphereGeometry(Math.abs(particle.radius) || 1, Math.max(3, particle.facets), Math.max(2, particle.facets));
      if (particle.scale) g.scale(particle.scale[0] || 1, particle.scale[1] || 1, particle.scale[2] || 1);
      return g;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(particle.vertices, 3));
    if (particle.normals.length === particle.vertices.length) g.setAttribute("normal", new THREE.Float32BufferAttribute(particle.normals, 3));
    return g;
  }, [particle]);
  useEffect(() => () => geom.dispose(), [geom]);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geom, new THREE.MeshStandardMaterial({ color }), pts.length);
    const t = new THREE.Matrix4();
    pts.forEach((p, i) => m.setMatrixAt(i, t.makeTranslation(p[0], p[1], p[2])));
    m.instanceMatrix.needsUpdate = true;
    return m;
  }, [geom, pts, color]);
  useEffect(() => () => (mesh.material as THREE.Material).dispose(), [mesh]);
  return <primitive object={mesh} />;
}

function ObjectCurves({ it, m, selected, display }: { it: Item; m: Mat; selected: boolean; display: CurveDisplay }) {
  const picked = useMachiningUi((s) => s.picked);
  const tool = useMachiningUi((s) => s.tool);
  const curves = objectCurves(it);
  const pts = objectPoints(it);
   
  const ds = it.object?.display;
  const dsColor = ds?.color ? `#${new THREE.Color(ds.color[0], ds.color[1], ds.color[2]).getHexString()}` : null;
  const chosen = tool?.mode === "select" && tool.object === it.id ? new Set(tool.curves) : null;
  const curveNormals = display.curveNormals || (display.curveNormalsOnSelect && selected);
  const showPoints = pts.length > 0;
  const pointNormals = showPoints && (display.pointNormals || (display.pointNormalsOnSelect && selected));
  const normals = useMemo(() => {
    const out: [number, number, number][] = [];
    const arrow = (r: number[]) => {
      const n = Math.hypot(r[3] ?? 0, r[4] ?? 0, r[5] ?? 0);
      if (n < 1e-9) return;
      out.push(v3(r), [r[0] + (r[3] / n) * display.normal, r[1] + (r[4] / n) * display.normal, r[2] + (r[5] / n) * display.normal]);
    };
    if (curveNormals) {
      for (const c of curves) {
        const step = Math.max(1, Math.floor(c.points.length / 40));
        for (let i = 0; i < c.points.length; i += step) arrow(c.points[i]);
      }
    }
    if (pointNormals) pts.forEach(arrow);
    return out;
  }, [curves, pts, curveNormals, pointNormals, display.normal]);
  const pointGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((p) => [p[0], p[1], p[2]]), 3));
    return g;
  }, [pts]);
  useEffect(() => () => pointGeom.dispose(), [pointGeom]);
  const vertexGeom = useMemo(() => {
    if (!display.curvePoints) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(curves.flatMap((c) => c.points.flatMap((p) => [p[0], p[1], p[2]])), 3));
    return g;
  }, [curves, display.curvePoints]);
  useEffect(() => () => vertexGeom?.dispose(), [vertexGeom]);
  const pickedPoint = picked?.object === it.id && picked.kind === "point" ? pts[picked.index] : undefined;
  const pickedGeom = useMemo(() => {
    if (!pickedPoint) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([pickedPoint[0], pickedPoint[1], pickedPoint[2]], 3));
    return g;
  }, [pickedPoint]);
  useEffect(() => () => pickedGeom?.dispose(), [pickedGeom]);
  return (
    <group matrixAutoUpdate={false} matrix={matFromRowMajor(m)} userData={{ ignoreFit: false }}>
      {curves.map((c, i) =>
        c.points.length > 1 ? (
          <Line
            key={i}
            points={c.points.map(v3)}
            color={
              picked?.object === it.id && picked.kind === "curve" && picked.index === i
                ? CURVE_PICKED
                : chosen?.has(i)
                  ? CURVE_PICKED
                  : dsColor
                    ? dsColor
                    : c.color
                      ? new THREE.Color(c.color[0], c.color[1], c.color[2])
                      : CURVE
            }
            lineWidth={ds && ds.lineWidth > 0 ? ds.lineWidth + (selected || chosen?.has(i) ? 1 : 0) : (selected || chosen?.has(i) ? 3 : 2) * display.ratio}
          />
        ) : null,
      )}
      {normals.length > 0 && <Line points={normals} segments color={NORMAL} lineWidth={1} />}
      {vertexGeom && (
        <points geometry={vertexGeom} renderOrder={9}>
          <pointsMaterial color={CURVE} size={display.curvePointSize} sizeAttenuation={false} depthTest={false} depthWrite={false} transparent />
        </points>
      )}
      {showPoints && (
         
        <points geometry={pointGeom} renderOrder={10}>
          <pointsMaterial map={pointSprite(dsColor ?? POINT)} color="#ffffff" size={ds && ds.pointSize > 0 ? ds.pointSize + (selected ? 2 : 0) : selected ? 13 : 11} sizeAttenuation={false} transparent alphaTest={0.05} depthTest={false} depthWrite={false} />
        </points>
      )}
      {showPoints && ds?.particle && <PointParticles pts={pts} particle={ds.particle} color={dsColor ?? POINT} />}
      {showPoints && pickedGeom && (
        <points geometry={pickedGeom} renderOrder={11}>
          <pointsMaterial map={pointSprite(CURVE_PICKED)} color="#ffffff" size={16} sizeAttenuation={false} transparent alphaTest={0.05} depthTest={false} depthWrite={false} />
        </points>
      )}
    </group>
  );
}

function Toolpath({ ws, it, arrow }: { ws: Workspace; it: Item; arrow: number }) {
  const m = it.machining!;
  const { robot, frame } = projectLinks(ws, m);
  const tp = m.toolpath;
  const lines = useMemo(() => {
    if (!tp?.poses.length || !robot) return null;
    const ref = frame ? absPose(ws, frame.id) : childFrame(ws, robot.parent);
    const absPoses = tp.poses.map((q) => mul(ref, q));
    const p = absPoses.map((a) => [a[3], a[7], a[11]] as [number, number, number]);
    const bad = new Set(tp.bad);
     
    const every = Math.max(1, Math.floor(p.length / 60));
    const z: [number, number, number][] = [];
    absPoses.forEach((a, i) => {
      if (i % every) return;
      z.push(p[i], [a[3] - a[2] * arrow, a[7] - a[6] * arrow, a[11] - a[10] * arrow]);
    });
    return { p, bad: p.filter((_, i) => bad.has(i)), z };
  }, [tp, robot, frame, ws, arrow]);
  if (!lines || lines.p.length < 2) return null;
  return (
    <group userData={{ ignoreFit: true }}>
      <Line points={lines.p} color={PATH_OK} lineWidth={2} />
      {Number(m.settings.VisibleNormals) ? <Line points={lines.z} segments color={NORMAL} lineWidth={1} /> : null}
      {lines.bad.map((q, i) => (
        <mesh key={i} position={q}>
          <sphereGeometry args={[4, 10, 10]} />
          <meshBasicMaterial color={PATH_BAD} />
        </mesh>
      ))}
    </group>
  );
}

function CreatePreview() {
  const tool = useMachiningUi((s) => s.tool);
  if (tool?.mode !== "create" || !tool.points.length) return null;
  return (
    <group userData={{ ignoreFit: true }}>
      {tool.points.length > 1 && <Line points={tool.points.map(v3)} color={CURVE_PICKED} lineWidth={3} />}
      {tool.points.map((p, i) => (
        <mesh key={i} position={v3(p)}>
          <sphereGeometry args={[3, 10, 10]} />
          <meshBasicMaterial color={CURVE_PICKED} />
        </mesh>
      ))}
    </group>
  );
}

 
function Picking({ ws, objects, abs, display }: { ws: Workspace; objects: Item[]; abs: (id: string) => Mat; display: CurveDisplay }) {
  const { gl, camera, scene, raycaster } = useThree();
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement;
    let down: { x: number; y: number; button: number } | null = null;
    const toPx = (world: THREE.Object3D, p: number[]) => {
      const v = world.localToWorld(new THREE.Vector3(p[0], p[1], p[2])).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z };
    };
     
    const pxPerMm = (world: THREE.Object3D, p: number[]) => {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).transformDirection(new THREE.Matrix4().copy(world.matrixWorld).invert());
      const a = toPx(world, p);
      const b = toPx(world, [p[0] + right.x, p[1] + right.y, p[2] + right.z]);
      return Math.hypot(b.x - a.x, b.y - a.y);
    };
     
    const nearest = (x: number, y: number, only?: string | null): PickedFeature | null => {
      const world = scene.getObjectByName("rc-world");
      if (!world) return null;
      let best: (PickedFeature & { d: number }) | null = null;
      for (const it of objects) {
        if (only && it.id !== only) continue;
        const m = abs(it.id);
        const toAbs = (r: number[]) => [m[0] * r[0] + m[1] * r[1] + m[2] * r[2] + m[3], m[4] * r[0] + m[5] * r[1] + m[6] * r[2] + m[7], m[8] * r[0] + m[9] * r[1] + m[10] * r[2] + m[11]];
        const scale = pxPerMm(world, [m[3], m[7], m[11]]);
        const tolCurve = display.pickCurve * scale;
        const tolPoint = display.pickPoint * scale;
        const curves = tolCurve > 0 ? objectCurves(it) : [];
        const points = tolPoint > 0 ? objectPoints(it) : [];
        curves.forEach((c, ci) => {
          let prev: { x: number; y: number; z: number } | null = null;
          c.points.forEach((r, pi) => {
            const q = toPx(world, toAbs(r));
            if (q.z > 1) return;
            let d = Math.hypot(q.x - x, q.y - y);
            if (prev) {
              const dx = q.x - prev.x;
              const dy = q.y - prev.y;
              const l2 = dx * dx + dy * dy;
              const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - prev.x) * dx + (y - prev.y) * dy) / l2)) : 0;
              d = Math.min(d, Math.hypot(prev.x + dx * t - x, prev.y + dy * t - y));
            }
            if (d < tolCurve && (!best || d < best.d)) best = { object: it.id, kind: "curve", index: ci, point: pi, at: [r[0], r[1], r[2]], d };
            prev = q;
          });
        });
        points.forEach((r, pi) => {
          const q = toPx(world, toAbs(r));
          const d = Math.hypot(q.x - x, q.y - y);
          if (q.z <= 1 && d < tolPoint && (!best || d < best.d)) best = { object: it.id, kind: "point", index: pi, at: [r[0], r[1], r[2]], d };
        });
      }
      if (!best) return null;
      const { d: _d, ...f } = best as PickedFeature & { d: number };
      void _d;
      return f;
    };
     
    const surface = (x: number, y: number) => {
      const world = scene.getObjectByName("rc-world");
      if (!world) return null;
      const r = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
      const hits = raycaster.intersectObject(world, true).filter((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData?.itemId) o = o.parent;
        const id = o?.userData?.itemId as string | undefined;
        const item = id ? ws.items[id] : undefined;
        if (!item || (item.type !== "object" && item.type !== "tool")) continue;
        const p = world.worldToLocal(h.point.clone());
        const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
         
        if (n.dot(raycaster.ray.direction) > 0) n.negate();
        const inv3 = new THREE.Matrix4().copy(world.matrixWorld).invert();
        n.transformDirection(inv3);
        return { item, point: [p.x, p.y, p.z], normal: [n.x, n.y, n.z] };
      }
      return null;
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
    };
     
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      const tool = useMachiningUi.getState().tool;
      if (tool?.mode !== "surface" || !tool.preview || down || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const robot = surfaceRobot(ws);
        const s = surface(e.clientX, e.clientY);
        if (!robot?.robot || !s) return useRC.setState({ preview: null });
        const pose = surfaceTargetPose(ws, robot, s.point, s.normal, tool.orient, tool.rot);
        const flange = mul(mul(inv(absPose(ws, robot.id)), pose), inv(toolPose(ws, robot.id)));
        const q = ikClosest(robot.robot.model, flange, robot.robot.joints);
        useRC.setState({ preview: q ? { robot: robot.id, joints: [q] } : null });
      });
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) {
        down = null;
        return;
      }
      const button = down.button;
      down = null;
      const ui = useMachiningUi.getState();
      if (button === 2) {
        const f = nearest(e.clientX, e.clientY);
        useMachiningUi.setState({ picked: f });
        if (f) {
           
          setTimeout(() => {
            void selectNow([f.object]);
            useRC.setState({ viewMenu: { x: e.clientX, y: e.clientY, item: f.object } });
          }, 0);
        }
        return;
      }
      if (button !== 0) return;
      if (!ui.tool) {
         
        const f = nearest(e.clientX, e.clientY);
        if (f) {
          useMachiningUi.setState({ picked: f });
          void cmd("object.selectFeature", { object: f.object, feature: f.kind, id: f.index });
        } else if (ui.picked) {
          useMachiningUi.setState({ picked: null });
          if (ws.items[ui.picked.object]) void cmd("object.selectFeature", { object: ui.picked.object, feature: "none" });
        }
        return;
      }
      const tool = ui.tool;
      if (tool.mode === "create") {
        const s = surface(e.clientX, e.clientY);
        if (!s || (tool.object && s.item.id !== tool.object) || s.item.type !== "object") return;
        useMachiningUi.setState({ tool: { ...tool, object: s.item.id, points: [...tool.points, [...s.point, ...s.normal]] } });
      } else if (tool.mode === "select") {
        const f = nearest(e.clientX, e.clientY, tool.object);
        if (!f || f.kind !== tool.kind) return;
        const set = new Set(tool.object === f.object ? tool.curves : []);
        if (set.has(f.index)) set.delete(f.index);
        else set.add(f.index);
        useMachiningUi.setState({ tool: { ...tool, object: f.object, curves: [...set].sort((a, b) => a - b) } });
      } else if (tool.mode === "surface") {
        const s = surface(e.clientX, e.clientY);
        if (!s) return;
        void cmd("target.teachOnSurface", { point: s.point, normal: s.normal, mode: tool.orient, rotX: tool.rot[0], rotY: tool.rot[1], rotZ: tool.rot[2] });
      }
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [gl, camera, scene, raycaster, ws, objects, abs, display]);
  return null;
}

 
function surfaceRobot(ws: Workspace): Item | undefined {
  const sel = ws.selection.map((s) => ws.items[s]).find((i) => i?.type === "robot");
  return sel ?? firstRobot(ws, ws.activeStation);
}

 
export async function finishCurveTool() {
  const { tool } = useMachiningUi.getState();
  useMachiningUi.setState({ tool: null });
  if (!tool) return;
  const ws = useRC.getState().ws;
  if (tool.mode === "create" && tool.object && tool.points.length > 1 && ws) {
     
    const obj = ws.items[tool.object];
    const toParent = inv(childFrame(ws, obj.parent));
    const rows = tool.points.map((r) => {
      const p = mul(toParent, [1, 0, 0, r[0], 0, 1, 0, r[1], 0, 0, 1, r[2], 0, 0, 0, 1]);
      const n = [toParent[0] * r[3] + toParent[1] * r[4] + toParent[2] * r[5], toParent[4] * r[3] + toParent[5] * r[4] + toParent[6] * r[5], toParent[8] * r[3] + toParent[9] * r[4] + toParent[10] * r[5]];
      return [p[3], p[7], p[11], ...n];
    });
    await cmd("object.addCurve", { object: obj.id, addToRef: true, points: rows, projection: 0 });
  } else if (tool.mode === "select" && tool.object) {
    await cmd("machining.setInput", { project: tool.project, object: tool.object, ...(tool.kind === "curve" ? { curves: tool.curves } : {}) });
  }
}

export function CurveLayer({ ws, items, abs }: { ws: Workspace; items: Item[]; abs: (id: string) => Mat }) {
  const selection = useRC((s) => s.ws?.selection ?? []);
  const objects = useMemo(() => items.filter((it) => it.type === "object" && it.visible && (objectCurves(it).length || objectPoints(it).length)), [items]);
  const projects = useMemo(() => items.filter((it) => it.type === "machining" && it.visible && it.machining?.toolpath && String(it.machining.settings.PathDisplay ?? "Estimated") !== "None"), [items]);
  const tool = useMachiningUi((s) => s.tool);
  const display = useCurveDisplay();
  const previewing = tool?.mode === "surface" && tool.preview;
   
  useEffect(() => {
    if (!previewing) return;
    return () => useRC.setState({ preview: null });
  }, [previewing]);
  useEffect(() => {
    if (!tool) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        void finishCurveTool();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [tool]);
  return (
    <>
      {objects.map((it) => (
        <ObjectCurves key={it.id} it={it} m={abs(it.id)} selected={selection.includes(it.id)} display={display} />
      ))}
      {projects.map((it) => (
        <Toolpath key={it.id} ws={ws} it={it} arrow={display.arrow} />
      ))}
      <CreatePreview />
      <Picking ws={ws} objects={objects} abs={abs} display={display} />
    </>
  );
}
