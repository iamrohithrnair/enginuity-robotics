"use client";
// Handles viewport camera navigation, item picking, and interactive dragging.

 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { CameraControls, OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { cmd, selectNow } from "@/client/api";
import { moveModeNow, useRC, useViewState, viewState } from "@/client/store";
import { dragMotion, dragSubject, isLocked } from "@/engine/drag";
import { fk, ikClosest } from "@/engine/kinematics";
import { inv, mul, type Mat } from "@/engine/math";
import type { Workspace } from "@/engine/types";
import { navStyle } from "@/engine/view";
import { absPose, robotOfTool, toolPose } from "@/engine/workspace";
import { dirToStation, dragZoomStep, MM, PRESETS, classicOp, rotateRate, toStation, viewPoseOf, w2t, wheelStep, type Op } from "./navMath";

const NONE = 0;

function itemIdOf(o: THREE.Object3D | null): string | null {
  for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (cur.userData.itemId) return cur.userData.itemId as string;
  return null;
}

function isShown(o: THREE.Object3D) {
  for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (!cur.visible || cur.userData.ignoreFit) return false;
  return true;
}

interface Hit {
  point: THREE.Vector3;
  normal: THREE.Vector3 | null;
  item: string | null;
}

function postEvent(body: Record<string, unknown>) {
  if (!useRC.getState().apiEvents) return;
  void fetch("/api/uievent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
}

 
function dragItems(ws: Workspace, pressed: string): string[] | null {
  const subject = dragSubject(ws, pressed);
  if (!subject || isLocked(subject) || isLocked(ws.items[pressed])) return null;
  if (ws.selection.includes(pressed)) {
    const ids = ws.selection.filter((id) => {
      const s = dragSubject(ws, id);
      return ws.items[id] && s && !isLocked(s) && !isLocked(ws.items[id]);
    });
    return ids.length ? ids : [pressed];
  }
  return [pressed];
}

interface DragState {
  ids: string[];
  subjects: string[];
  grab: THREE.Vector3;
  pivot: [number, number, number];
  plane: "horizontal" | "screen";
  toolMode: "robot" | "tcp";
  keepChildren: boolean;
  translate: [number, number, number];
  rotateZ: number;
  tools: { robot: string; tcp: Mat; q: number[] }[];
}

export function CameraRig() {
  const ref = useRef<CameraControls>(null);
  const view = useRC((s) => s.view);
  const vs = useViewState();
  const settings = useRC((s) => s.settings);
  const { scene, camera, gl, raycaster, size } = useThree();
  const pose = useRef({ pos: new THREE.Vector3(1.96, 2.05, 2.2), target: new THREE.Vector3(0, 0.45, 0), up: new THREE.Vector3(0, 1, 0), dist: 3 });

   
  const fov = (Number(settings.ViewAngle ?? 30) || 30) * ((vs as { vr?: boolean }).vr ? 2 : 1);
  const near = (Number(settings.NearPlane ?? 5) || 5) * MM;
  const far = (Number(settings.FarPlane ?? 200000) || 200000) * MM;

   
  const pick = (clientX: number, clientY: number): Hit | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const world = scene.getObjectByName("rc-world");
    if (!world) return null;
    const hits = raycaster.intersectObject(world, true).filter((h) => (h.object as THREE.Mesh).isMesh && isShown(h.object));
    if (!hits.length) return null;
    const h = hits[0];
    const normal = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : null;
    return { point: h.point.clone(), normal, item: itemIdOf(h.object) };
  };

   
  const onPlane = (clientX: number, clientY: number, plane: THREE.Plane) => {
    const rect = gl.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  };

   
  function selectInRect(r: { x0: number; y0: number; x1: number; y1: number }, add: boolean) {
    const world = scene.getObjectByName("rc-world");
    if (!world) return;
    const rect = gl.domElement.getBoundingClientRect();
    const [xa, xb] = [Math.min(r.x0, r.x1), Math.max(r.x0, r.x1)];
    const [ya, yb] = [Math.min(r.y0, r.y1), Math.max(r.y0, r.y1)];
    const ids = new Set<string>();
    const v = new THREE.Vector3();
    world.updateWorldMatrix(true, true);
    world.traverse((o) => {
      const id = o.userData.itemId as string | undefined;
      if (!id || !isShown(o)) return;
      o.getWorldPosition(v);
      v.project(camera);
      if (v.z > 1 || v.z < -1) return;
      const x = rect.left + ((v.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - v.y) / 2) * rect.height;
      if (x >= xa && x <= xb && y >= ya && y <= yb) ids.add(id);
    });
    const list = [...ids];
    const cur = useRC.getState().ws?.selection ?? [];
    const next = add ? [...new Set([...cur, ...list])] : list;
    void selectNow(next);
    if (next[0]) post3dSelection(next[0], null);
  }

   
  function post3dSelection(id: string, hit: Hit | null) {
    const ws = useRC.getState().ws;
    if (!ws?.items[id] || !useRC.getState().apiEvents) return;
    const abs = absPose(ws, id);
    const colMajor = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15].map((i) => abs[i]);
    let xyz = [0, 0, 0];
    let ijk = [0, 0, 0];
    if (hit) {
      const p = toStation(hit.point);
      const local = mul(inv(abs), [1, 0, 0, p[0], 0, 1, 0, p[1], 0, 0, 1, p[2], 0, 0, 0, 1]);
      xyz = [local[3], local[7], local[11]];
      if (hit.normal) {
        const n = dirToStation(hit.normal);
        ijk = [0, 1, 2].map((r) => abs[r] * n[0] + abs[4 + r] * n[1] + abs[8 + r] * n[2]);
      }
    }
    postEvent({ id: 7, item: id, array: [...colMajor, ...xyz, ...ijk, 0, 0] });
  }

   
  const remember = () => {
    const c = ref.current;
    if (!c) return;
    c.getPosition(pose.current.pos);
    c.getTarget(pose.current.target);
    pose.current.up.copy(c.camera.up);
    pose.current.dist = c.distance;
  };

   
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.mouseButtons.left = NONE as typeof c.mouseButtons.left;
    c.mouseButtons.right = NONE as typeof c.mouseButtons.right;
    c.mouseButtons.middle = NONE as typeof c.mouseButtons.middle;
    c.mouseButtons.wheel = NONE as typeof c.mouseButtons.wheel;
    c.touches.one = NONE as typeof c.touches.one;
    c.touches.two = NONE as typeof c.touches.two;
    c.touches.three = NONE as typeof c.touches.three;
    c.smoothTime = 0.16;
    c.draggingSmoothTime = 0.06;
    c.minDistance = 0.02;
    c.maxDistance = far;
     
    const p = pose.current;
    c.camera.up.copy(p.up);
    c.updateCameraUp();
    void c.setLookAt(p.pos.x, p.pos.y, p.pos.z, p.target.x, p.target.y, p.target.z, false);
    if ((c.camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const h = 2 * p.dist * Math.tan(((fov / 2) * Math.PI) / 180);
      void c.zoomTo(size.height / Math.max(1e-6, h), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

   
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const report = () => {
      remember();
      if (t) clearTimeout(t);
      t = setTimeout(() => postEvent({ id: 8, viewPose: viewPoseOf(c.camera) }), 150);
    };
    c.addEventListener("update", report);
    return () => {
      c.removeEventListener("update", report);
      if (t) clearTimeout(t);
    };
  }, [camera]);

   
  const aligned = settings.KeepRotationAligned !== false;
  useEffect(() => {
    const c = ref.current;
    if (!c || !aligned || c.camera.up.y > 0.9999) return;
    c.camera.up.set(0, 1, 0);
    c.updateCameraUp();
  }, [aligned]);

   
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement;
    let s: {
      id: number;
      button: "left" | "middle" | "right";
      x: number;
      y: number;
      lx: number;
      ly: number;
      op: Op;
      hit: Hit | null;
      moved: boolean;
      meta: boolean;
      plane: THREE.Plane | null;
      depth: number | null;
      drag: DragState | null;
      buttons: number;
      touchTimer: ReturnType<typeof setTimeout> | null;
    } | null = null;
    let hoverRaf = 0;

    const c = () => ref.current;
    const st = () => useRC.getState();
    const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

    const startPan = (hit: Hit | null) => {
      const cc = c();
      if (!cc) return null;
      const anchor = hit?.point ?? cc.getTarget(new THREE.Vector3());
      const fwd = new THREE.Vector3();
      cc.camera.getWorldDirection(fwd);
      return new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, anchor);
    };

    const beginDrag = (pressed: string, hit: Hit): DragState | null => {
      const ws = st().ws;
      if (!ws) return null;
      const ids = dragItems(ws, pressed);
      if (!ids) return null;
      const subjects = [...new Set(ids.map((id) => dragSubject(ws, id)!.id))];
      const first = absPose(ws, subjects[0]);
      const mode = moveModeNow();
      const classic = navStyle(st().settings) === "classic";
      const tools = subjects
        .filter((id) => ws.items[id].type === "tool" && !(classic && mode === "tools"))
        .map((id) => robotOfTool(ws, id))
        .filter((r): r is NonNullable<typeof r> => !!r?.robot)
        .map((r) => ({ robot: r.id, q: st().liveJoints[r.id] ?? r.robot!.joints, tcp: mul(mul(absPose(ws, r.id), fk(r.robot!.model, st().liveJoints[r.id] ?? r.robot!.joints)), toolPose(ws, r.id)) }));
      if (!ws.selection.includes(pressed)) void selectNow([pressed]);
      postEvent({ id: 3, item: pressed });
      return {
        ids,
        subjects,
        grab: hit.point.clone(),
        pivot: [first[3], first[7], first[11]],
        plane: classic ? "screen" : "horizontal",
        toolMode: classic && mode === "tools" ? "tcp" : "robot",
        keepChildren: classic && mode === "tools",
        translate: [0, 0, 0],
        rotateZ: 0,
        tools,
      };
    };

    const updateDrag = (d: DragState, e: PointerEvent) => {
      const cc = c();
      if (!cc) return;
      const ws = st().ws;
      if (!ws) return;
      const grabS = toStation(d.grab);
      if (d.plane === "screen") {
        const fwd = new THREE.Vector3();
        cc.camera.getWorldDirection(fwd);
        const q = onPlane(e.clientX, e.clientY, new THREE.Plane().setFromNormalAndCoplanarPoint(fwd, d.grab));
        if (!q) return;
        const qs = toStation(q);
        d.translate = [qs[0] - grabS[0], qs[1] - grabS[1], qs[2] - grabS[2]];
        d.rotateZ = 0;
      } else if (e.shiftKey) {
         
        const fwd = new THREE.Vector3();
        cc.camera.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, 1);
        const q = onPlane(e.clientX, e.clientY, new THREE.Plane().setFromNormalAndCoplanarPoint(fwd.normalize(), d.grab));
        if (!q) return;
        d.translate = [0, 0, toStation(q)[2] - grabS[2]];
        d.rotateZ = 0;
      } else {
        const q = onPlane(e.clientX, e.clientY, new THREE.Plane(new THREE.Vector3(0, 1, 0), -d.grab.y));
        if (!q) return;
        const qs = toStation(q);
        if (e.altKey) {
           
          const a0 = Math.atan2(grabS[1] - d.pivot[1], grabS[0] - d.pivot[0]);
          const a1 = Math.atan2(qs[1] - d.pivot[1], qs[0] - d.pivot[0]);
          d.translate = [0, 0, 0];
          d.rotateZ = ((a1 - a0) * 180) / Math.PI;
        } else {
          d.translate = [qs[0] - grabS[0], qs[1] - grabS[1], 0];
          d.rotateZ = 0;
        }
      }
      const motion = dragMotion(d.translate, d.rotateZ, d.pivot);
      const robotIds = new Set(d.tools.map((t) => ws.items[t.robot]?.parent).filter(Boolean));
      useRC.setState({ drag: { ids: d.subjects.filter((id) => !(ws.items[id]?.type === "tool" && d.toolMode === "robot") && !robotIds.has(id)), motion } });
      if (d.tools.length) {
        const live = { ...st().liveJoints };
        for (const t of d.tools) {
          const r = ws.items[t.robot];
          if (!r?.robot) continue;
          const flange = mul(mul(inv(absPose(ws, r.id)), mul(motion, t.tcp)), inv(toolPose(ws, r.id)));
          const q = ikClosest(r.robot.model, flange, live[r.id] ?? t.q);
          if (q) live[r.id] = q;
        }
        useRC.setState({ liveJoints: live });
      }
    };

    const endDrag = async (d: DragState, commit: boolean) => {
      const ws = st().ws;
      const rev = ws?.rev ?? 0;
      const clearTools = () => {
        const lj = { ...st().liveJoints };
        for (const t of d.tools) delete lj[t.robot];
        useRC.setState({ liveJoints: lj });
      };
      postEvent({ id: 4, item: d.ids[0] });
      const moved = Math.hypot(...d.translate) > 1e-6 || Math.abs(d.rotateZ) > 1e-9;
      if (!commit || !moved) {
        useRC.setState({ drag: null });
        clearTools();
        return;
      }
      const r = await cmd("item.moveBy", {
        items: d.ids,
        translate: d.translate,
        ...(d.rotateZ ? { rotateZ: d.rotateZ, pivot: d.pivot } : {}),
        ...(d.keepChildren ? { keepChildren: true } : {}),
        ...(d.toolMode === "tcp" ? { toolMode: "tcp" } : {}),
      });
       
      const done = () => {
        useRC.setState({ drag: null });
        clearTools();
      };
      if (!r || (st().ws?.rev ?? 0) > rev) return done();
      const unsub = useRC.subscribe((s2) => {
        if ((s2.ws?.rev ?? 0) > rev) {
          unsub();
          done();
        }
      });
      setTimeout(() => {
        unsub();
        if (st().drag) done();
      }, 1500);
    };

    const opFor = (e: PointerEvent, button: "left" | "middle" | "right", hit: Hit | null): Op => {
      const state = st();
      if (state.measureOpen && button === "left") return "measure";
      const classic = navStyle(state.settings) === "classic";
      const cmdKey = e.metaKey || (!isMac && e.ctrlKey);
      if (classic) {
        if (state.holdPan && button === "left") return "pan";
        const mode = moveModeNow();
        if (mode !== "default" && button === "left" && hit?.item) return "drag";
        const v = viewState();
        const op = classicOp(Number(state.settings.Mouse3D_Type ?? 0), button, { shift: e.shiftKey, cmd: cmdKey }, v.leftAction, {
          mid: String(state.settings.Mouse3D_ClickMid ?? "Rotate"),
          right: String(state.settings.Mouse3D_ClickRight ?? "Pan"),
        });
        return op === "select" ? "band" : op;
      }
      if (button === "right") return "rotate";
      if (button === "middle") return "pan";
      if (hit?.item && !e.shiftKey && state.ws && dragItems(state.ws, hit.item)) return "drag";
      return e.shiftKey ? "band" : "pan";
    };

    const down = (e: PointerEvent) => {
      if (!e.isPrimary && e.pointerType === "touch") return;
      const cc = c();
      if (!cc) return;
       
      if (e.pointerType === "touch" && st().settings.AllowTouch3D !== true) {
        const hit = pick(e.clientX, e.clientY);
        s = { id: e.pointerId, button: "left", x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, op: "none", hit, moved: false, meta: false, plane: null, depth: null, drag: null, buttons: 1, touchTimer: null };
        s.touchTimer = setTimeout(() => {
          if (s && !s.moved) useRC.setState({ viewMenu: { x: s.x, y: s.y, item: hit?.item ?? null } });
        }, 550);
        return;
      }
      const button: "left" | "middle" | "right" = e.button === 2 || (isMac && e.button === 0 && e.ctrlKey) ? "right" : e.button === 1 ? "middle" : "left";
      const hit = pick(e.clientX, e.clientY);
      const op = opFor(e, button, hit);
      s = { id: e.pointerId, button, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, op, hit, moved: false, meta: e.metaKey || e.ctrlKey, plane: null, depth: null, drag: null, buttons: e.buttons, touchTimer: null };
      if (op === "rotate") {
        if (hit) cc.setOrbitPoint(hit.point.x, hit.point.y, hit.point.z);
      } else if (op === "pan") s.plane = startPan(hit);
      else if (op === "zoom") s.depth = hit ? cc.camera.position.distanceTo(hit.point) : null;
      if (op !== "none" && op !== "band" && op !== "measure") el.setPointerCapture?.(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      const cc = c();
      if (!cc) return;
      if (!s) {
         
        if (e.buttons || hoverRaf) return;
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          const state = st();
          const classic = navStyle(state.settings) === "classic";
          const want = state.settings.MouseFeedback !== false && (classic ? viewState().leftAction === "none" : true);
          const hit = want ? pick(e.clientX, e.clientY) : null;
          const id = hit?.item ?? null;
          if (state.hover !== id) useRC.setState({ hover: id });
          if (!classic) gl.domElement.style.cursor = id && state.ws && dragItems(state.ws, id) ? "grab" : "";
        });
        return;
      }
      if (e.pointerId !== s.id) return;
      const dx = e.clientX - s.lx;
      const dy = e.clientY - s.ly;
      s.lx = e.clientX;
      s.ly = e.clientY;
      const total = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!s.moved && total < (e.pointerType === "touch" ? 10 : 4)) return;
      if (!s.moved) {
        s.moved = true;
        if (s.touchTimer) clearTimeout(s.touchTimer);
        if (s.op === "drag" && s.hit?.item) {
          s.drag = beginDrag(s.hit.item, s.hit);
          if (!s.drag) s.op = "none";
          else gl.domElement.style.cursor = "grabbing";
        }
      }
       
       
      if (s.button === "middle" && navStyle(st().settings) === "classic") {
        if (e.buttons & 3 && s.op !== "rotate") {
          s.op = "rotate";
          if (s.hit) cc.setOrbitPoint(s.hit.point.x, s.hit.point.y, s.hit.point.z);
        } else if (s.op === "rotate" && e.buttons === 4) {
          s.op = "zoom";
          s.depth = s.hit ? cc.camera.position.distanceTo(s.hit.point) : null;
        }
      }
      const speed = Number(st().settings.Mouse3D_SpeedRotate ?? 1) || 1;
      switch (s.op) {
        case "rotate": {
          if (st().settings.KeepRotationAligned !== false) {
            const k = rotateRate(true, speed);
            void cc.rotate(-dx * k, -dy * k, false);
          } else {
             
            const k = rotateRate(false, speed);
            const angle = Math.hypot(dx, dy) * k;
            if (!angle) break;
            const cam = cc.camera;
            const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
            const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
            const axis = up.clone().multiplyScalar(dx).add(right.clone().multiplyScalar(dy)).normalize();
            const q = new THREE.Quaternion().setFromAxisAngle(axis, -angle);
            const target = cc.getTarget(new THREE.Vector3());
            const pos = cc.getPosition(new THREE.Vector3()).sub(target).applyQuaternion(q).add(target);
            cam.up.applyQuaternion(q);
            cc.updateCameraUp();
            void cc.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, false);
          }
          break;
        }
        case "pan": {
          if (!s.plane) s.plane = startPan(s.hit);
          const anchor = s.hit?.point ?? null;
          const qp = s.plane ? onPlane(e.clientX, e.clientY, s.plane) : null;
          if (!qp) break;
          const p0 = anchor ?? s.plane!.coplanarPoint(new THREE.Vector3());
           
          const delta = p0.clone().sub(qp);
          const pos = cc.getPosition(new THREE.Vector3()).add(delta);
          const tgt = cc.getTarget(new THREE.Vector3()).add(delta);
          void cc.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, false);
          break;
        }
        case "zoom": {
          if ((cc.camera as THREE.OrthographicCamera).isOrthographicCamera) {
            void cc.zoomTo(cc.camera.zoom * Math.exp(-dy * 0.005), false);
            break;
          }
          const step = dragZoomStep(dy, s.depth);
          const pos = cc.getPosition(new THREE.Vector3());
          const tgt = cc.getTarget(new THREE.Vector3());
          const dir = (s.hit ? s.hit.point.clone().sub(pos) : tgt.clone().sub(pos)).normalize();
           
          const mv = dir.multiplyScalar(-step);
          void cc.setLookAt(pos.x + mv.x, pos.y + mv.y, pos.z + mv.z, tgt.x + mv.x, tgt.y + mv.y, tgt.z + mv.z, false);
          if (s.depth !== null && s.hit) s.depth = cc.camera.position.distanceTo(s.hit.point);
          break;
        }
        case "band":
          useRC.setState({ rubber: { x0: s.x, y0: s.y, x1: e.clientX, y1: e.clientY } });
          break;
        case "drag":
          if (s.drag) updateDrag(s.drag, e);
          break;
      }
    };

    const up = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return;
      const cur = s;
      s = null;
      if (cur.touchTimer) clearTimeout(cur.touchTimer);
      el.releasePointerCapture?.(e.pointerId);
      gl.domElement.style.cursor = "";
      if (cur.drag) {
        useRC.setState({ suppressClick: Date.now() });
        void endDrag(cur.drag, true);
        return;
      }
      if (cur.op === "band" && cur.moved) {
        const r = st().rubber;
        useRC.setState({ rubber: null, suppressClick: Date.now() });
        if (r) selectInRect(r, cur.meta);
        return;
      }
      if (cur.moved) {
        useRC.setState({ suppressClick: Date.now() });
        return;
      }
       
      const hit = cur.hit;
      if (cur.op === "measure" && hit) {
        const m = st().measure;
        const pt = { point: toStation(hit.point), normal: hit.normal ? dirToStation(hit.normal) : undefined, item: hit.item ?? undefined };
        useRC.setState({ measure: !m.a || m.b ? { a: pt, b: null } : { a: m.a, b: pt } });
        return;
      }
      if (cur.button === "right") {
        if (hit?.item && !st().ws?.selection.includes(hit.item)) void selectNow([hit.item]);
        if (hit?.item) postEvent({ id: 15, item: hit.item, click: 2 });
        useRC.setState({ viewMenu: { x: e.clientX, y: e.clientY, item: hit?.item ?? null } });
        return;
      }
      if (cur.button === "left" && hit?.item) {
        postEvent({ id: 15, item: hit.item, click: 1 });
        post3dSelection(hit.item, hit);
      }
    };

    const cancel = () => {
      if (s?.drag) void endDrag(s.drag, false);
      if (s) el.releasePointerCapture?.(s.id);
      s = null;
      useRC.setState({ rubber: null });
      gl.domElement.style.cursor = "";
    };

    const wheel = (e: WheelEvent) => {
      const cc = c();
      if (!cc) return;
      e.preventDefault();
       
      if (s?.button === "middle") return;
      const lines = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
       
      let deg = -e.deltaY * lines * (e.ctrlKey ? 0.6 : 0.15);
      if (st().settings.ZoomInvert) deg = -deg;
      if (!deg) return;
      const hit = pick(e.clientX, e.clientY);
      if ((cc.camera as THREE.OrthographicCamera).isOrthographicCamera) {
         
        void cc.zoomTo(cc.camera.zoom * (1 + Math.max(-0.9, deg * 0.015)), false);
        return;
      }
      const pos = cc.getPosition(new THREE.Vector3());
      const tgt = cc.getTarget(new THREE.Vector3());
      let move: THREE.Vector3;
      if (hit) {
        const toward = hit.point.clone().sub(pos);
        const dist = toward.length();
         
        const step = Math.min(wheelStep(deg, dist, st().settings), dist * 0.95);
        move = toward.normalize().multiplyScalar(step);
      } else {
        const fwd = tgt.clone().sub(pos).normalize();
        move = fwd.multiplyScalar(wheelStep(deg, null, st().settings));
      }
      void cc.setLookAt(pos.x + move.x, pos.y + move.y, pos.z + move.z, tgt.x + move.x, tgt.y + move.y, tgt.z + move.z, false);
    };

    const ctx = (e: Event) => e.preventDefault();
    const onCancel = () => cancel();
    const leave = () => {
      if (st().hover) useRC.setState({ hover: null });
    };
    el.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", onCancel);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, { passive: false, capture: true });
    el.addEventListener("contextmenu", ctx);
    window.addEventListener("rc-drag-cancel", onCancel);
    return () => {
      el.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel, { capture: true });
      el.removeEventListener("contextmenu", ctx);
      window.removeEventListener("rc-drag-cancel", onCancel);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera]);

   
  useEffect(() => {
    const c = ref.current;
    if (!c || !view) return;
    const fit = (only?: string[] | null, minSize = 0.6) => {
      const box = new THREE.Box3();
      const world = scene.getObjectByName("rc-world");
      const want = only?.length ? new Set(only) : null;
      world?.updateWorldMatrix(true, true);
      world?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry || !isShown(o)) return;
        if (want && !want.has(itemIdOf(o) ?? "")) return;
        box.expandByObject(o);
      });
      if (want && box.isEmpty()) {
         
        world?.traverse((o) => {
          if (o.userData.itemId && want.has(o.userData.itemId)) box.expandByPoint(o.getWorldPosition(new THREE.Vector3()));
        });
      }
      if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.3, 0), new THREE.Vector3(0.6, 0.6, 0.6));
      const center = box.getCenter(new THREE.Vector3());
      const sz = box.getSize(new THREE.Vector3()).length();
      const radius = (1.2 * Math.max(sz, minSize)) / 2;
      void c.fitToSphere(new THREE.Sphere(center, radius), true);
    };
    const v = view as typeof view & { pose?: number[] };
    if (v.action === "preset" && v.view) {
      const p = PRESETS[v.view] ?? PRESETS.iso;
      const z = w2t(p.z).normalize();
      const up = w2t(p.y).normalize();
      const tgt = c.getTarget(new THREE.Vector3());
      const dist = Math.max(1, c.distance);
       
       
      const offset = Math.abs(z.y) > 0.99 ? up.clone().multiplyScalar(-1e-4) : new THREE.Vector3();
      c.camera.up.set(0, 1, 0);
      c.updateCameraUp();
      void c.setLookAt(tgt.x + z.x * dist + offset.x, tgt.y + z.y * dist + offset.y, tgt.z + z.z * dist + offset.z, tgt.x, tgt.y, tgt.z, false).then(() => fit());
    } else if (v.action === "fit") fit(v.items ?? undefined, v.items?.length ? 0.2 : 0.6);
    else if (v.action === "pose" && Array.isArray(v.pose) && v.pose.length === 16) {
       
      const m = v.pose;
      const R = [m.slice(0, 3), m.slice(4, 7), m.slice(8, 11)];
      const t = [m[3], m[7], m[11]];
      const camS = [0, 1, 2].map((j) => -(R[0][j] * t[0] + R[1][j] * t[1] + R[2][j] * t[2]));
      const pos = new THREE.Vector3(camS[0] * MM, camS[2] * MM, -camS[1] * MM);
      const back = w2t(R[2] as [number, number, number]).normalize();
      const up = w2t(R[1] as [number, number, number]).normalize();
      const dist = Math.max(0.05, c.distance);
      const tgt = pos.clone().addScaledVector(back, -dist);
      if (settings.KeepRotationAligned === false || Math.abs(up.y) < 0.999) {
        c.camera.up.copy(up);
        c.updateCameraUp();
      }
      void c.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, scene]);

  return (
    <>
      {vs.perspective ? (
        <PerspectiveCamera makeDefault fov={fov} near={near} far={far} position={[1.96, 2.05, 2.2]} />
      ) : (
        <OrthographicCamera makeDefault near={-far} far={far} position={[1.96, 2.05, 2.2]} />
      )}
      <CameraControls ref={ref} makeDefault minDistance={0.02} maxDistance={far} />
    </>
  );
}
