"use client";
// Builds viewport lighting, floor reflections, shadows, and grid.

 
 
 
 
 

import { ContactShadows, Environment, Grid, Lightformer, MeshReflectorMaterial } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { physicsFloorY } from "../physics/store";




const SUN_DIR = new THREE.Vector3(0.12, 0.57, -0.81).normalize();

 
export const FLOOR_MIRROR = "rc-floor-mirror";
export const FLOOR_SHADOW = "rc-floor-shadow";








export const FLOOR_ORDER = { mirror: 1, grid: 2, shadow: 3, contact: 4, translucent: 10 } as const;

interface Bounds {
  cx: number;
  cz: number;
  floorY: number;
  radius: number;
}

 
function useStationBounds(): Bounds {
  const scene = useThree((s) => s.scene);
  const [bounds, setBounds] = useState<Bounds>({ cx: 0, cz: 0, floorY: 0, radius: 2 });
  const box = useMemo(() => new THREE.Box3(), []);
  const elapsed = useRef(1);
  useFrame((_, dt) => {
    elapsed.current += dt;
    if (elapsed.current < 0.5) return;
    elapsed.current = 0;
    const world = scene.getObjectByName("rc-world");
    if (!world) return;
    box.setFromObject(world);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
     
    const pf = physicsFloorY();
    const next = { cx: c.x, cz: c.z, floorY: pf ?? (box.min.y < -0.05 ? box.min.y : 0), radius: Math.min(25, Math.max(1, 0.5 * Math.hypot(s.x, s.y, s.z))) };
    const b = bounds;
    const moved = Math.hypot(next.cx - b.cx, next.cz - b.cz) > 0.05 * b.radius;
    if (moved || Math.abs(next.floorY - b.floorY) > (pf === null ? 0.002 : 1e-6) || Math.abs(next.radius - b.radius) > 0.08 * b.radius) setBounds(next);
  });
  return bounds;
}

function radialFade(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "#fff");
  grad.addColorStop(0.4, "#fff");
  grad.addColorStop(1, "#000");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function KeyLight({ bounds, shadows }: { bounds: Bounds; shadows: boolean }) {
  const light = useRef<THREE.DirectionalLight>(null);
  useLayoutEffect(() => {
    const l = light.current;
    if (!l) return;
    const { cx, cz, floorY, radius } = bounds;
    const center = new THREE.Vector3(cx, floorY + radius * 0.4, cz);
    l.position.copy(center).addScaledVector(SUN_DIR, radius * 3);
    l.target.position.copy(center);
    l.target.updateMatrixWorld();
     
     
    const cam = l.shadow.camera;
    const e = radius * 1.3;
    cam.left = -e;
    cam.right = e;
    cam.top = e;
    cam.bottom = -e;
    cam.near = 0.05;
    cam.far = radius * 8 + 5;
    cam.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }, [bounds]);
   
  return <directionalLight ref={light} intensity={1.7} castShadow={shadows} shadow-mapSize={[1024, 1024]} shadow-radius={14} shadow-blurSamples={16} shadow-bias={-0.0004} />;
}

function Floor({ bounds, reflections, dark }: { bounds: Bounds; reflections: boolean; dark: boolean }) {
  const fade = useMemo(() => radialFade(), []);
  const r = Math.max(6, bounds.radius * 4);
  return (
    <group position={[bounds.cx, bounds.floorY - 0.0003, bounds.cz]}>
      <mesh name={FLOOR_SHADOW} rotation-x={-Math.PI / 2} position-y={0.0006} receiveShadow renderOrder={FLOOR_ORDER.shadow} userData={{ ignoreFit: true }}>
        <circleGeometry args={[r, 72]} />
        <shadowMaterial transparent opacity={dark ? 0.5 : 0.26} depthWrite={false} />
      </mesh>
      {reflections && (
        <mesh name={FLOOR_MIRROR} rotation-x={-Math.PI / 2} position-y={-0.0003} renderOrder={FLOOR_ORDER.mirror} userData={{ ignoreFit: true }}>
          <circleGeometry args={[r, 72]} />
          <MeshReflectorMaterial
            color={dark ? "#161617" : "#e8e8e5"}
            alphaMap={fade}
            transparent
            depthWrite={false}
            resolution={1024}
            blur={[320, 90]}
            mixBlur={0.85}
            mixStrength={dark ? 1.8 : 1.3}
            mirror={0.3}
            roughness={0.92}
            metalness={0}
            depthScale={1}
            minDepthThreshold={0.5}
            maxDepthThreshold={1.3}
          />
        </mesh>
      )}
    </group>
  );
}

 
function gridNoDepth(mesh: THREE.Mesh | null) {
  if (mesh) (mesh.material as THREE.Material).depthWrite = false;
}







function FloorGrid({ floorY, dark }: { floorY: number; dark: boolean }) {
  return (
    <Grid
      ref={gridNoDepth}
      position={[0, floorY, 0]}
      renderOrder={FLOOR_ORDER.grid}
      args={[40, 40]}
      cellSize={0.1}
      cellThickness={0.6}
      sectionSize={1}
      sectionThickness={1.1}
      cellColor={dark ? "#2a2a2d" : "#d3d3cf"}
      sectionColor={dark ? "#47474c" : "#a9a9a3"}
      fadeDistance={22}
      fadeStrength={1.4}
      infiniteGrid
      followCamera={false}
      userData={{ ignoreFit: true }}
    />
  );
}

export function Stage({ dark, shadows, reflections, grid }: { dark: boolean; shadows: boolean; reflections: boolean; grid: boolean }) {
  const bounds = useStationBounds();
  return (
    <>
      <hemisphereLight args={["#ffffff", dark ? "#2a2a2c" : "#4a4a48", 0.65]} />
      <KeyLight bounds={bounds} shadows={shadows} />
      <Environment resolution={256} frames={1}>
        { }
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={1.1} position={[-5, 1.5, 2]} rotation-y={Math.PI / 2} scale={[6, 4, 1]} />
        <Lightformer form="rect" intensity={1.3} color="#fff3e6" position={[5, 1.5, -2]} rotation-y={-Math.PI / 2} scale={[6, 4, 1]} />
        <Lightformer form="ring" intensity={0.6} position={[0, 2, -6]} scale={3} />
      </Environment>
      <Floor bounds={bounds} reflections={reflections} dark={dark} />
      {grid && <FloorGrid floorY={bounds.floorY} dark={dark} />}
      <ContactShadows
        position={[bounds.cx, bounds.floorY + 0.0009, bounds.cz]}
        opacity={dark ? 0.5 : 0.3}
        scale={Math.max(4, bounds.radius * 3)}
        blur={2.2}
        far={bounds.floorY < 0 ? Math.min(Math.max(1.5, bounds.radius), -bounds.floorY - 0.002) : Math.max(1.5, bounds.radius)}
        resolution={1024}
        frames={Infinity}
        renderOrder={FLOOR_ORDER.contact}
      />
    </>
  );
}
