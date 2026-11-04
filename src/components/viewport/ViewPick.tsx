"use client";

 
 
 
 

import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { toStation } from "./navMath";

function itemIdOf(o: THREE.Object3D | null): string | null {
  for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (cur.userData.itemId) return cur.userData.itemId as string;
  return null;
}

function isShown(o: THREE.Object3D) {
  for (let cur: THREE.Object3D | null = o; cur; cur = cur.parent) if (!cur.visible || cur.userData.ignoreFit) return false;
  return true;
}

export function ViewPickResponder() {
  const { scene, camera, gl } = useThree();
  const cursor = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      cursor.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    el.addEventListener("pointermove", move);
    return () => el.removeEventListener("pointermove", move);
  }, [gl]);

  useEffect(() => {
    const onRequest = (ev: Event) => {
      const req = (ev as CustomEvent<{ id: string; x: number; y: number }>).detail;
      const rect = gl.domElement.getBoundingClientRect();
      let { x, y } = req;
      if (x < 0 && y < 0) {
         
        x = cursor.current?.x ?? -1;
        y = cursor.current?.y ?? -1;
      }
      let answer: { item: string | null; xyz: number[] } = { item: null, xyz: [0, 0, 0] };
      if (rect.width > 0 && rect.height > 0) {
        const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, 1 - (y / rect.height) * 2);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const world = scene.getObjectByName("rc-world");
        const hit = world ? raycaster.intersectObject(world, true).find((h) => (h.object as THREE.Mesh).isMesh && isShown(h.object)) : undefined;
        if (hit) answer = { item: itemIdOf(hit.object), xyz: toStation(hit.point) };
      }
      void fetch("/api/viewpick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: req.id, ...answer }) }).catch(() => undefined);
    };
    window.addEventListener("rc-view-pick-request", onRequest);
    return () => window.removeEventListener("rc-view-pick-request", onRequest);
  }, [scene, camera, gl]);

  return null;
}
