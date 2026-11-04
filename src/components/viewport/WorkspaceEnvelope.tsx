"use client";

 
 
 
 

import { useMemo } from "react";
import * as THREE from "three";
import { useRC } from "@/client/store";
import { eye } from "@/engine/math";
import type { Item, ViewState, Workspace } from "@/engine/types";
import { envelopeIndices, workspaceEnvelope } from "@/engine/workspaceEnvelope";
import { absPose, toolPose } from "@/engine/workspace";

 
export function workspaceModeOf(r: Item, view: Pick<ViewState, "workspace">): number {
  return r.params?.ShowWorkspace !== undefined ? Number(r.params.ShowWorkspace) : view.workspace ? 2 : 0;
}

function EnvelopeMesh({ robot, mode, ws }: { robot: Item; mode: 1 | 2 | 3; ws: Workspace }) {
  const dark = useRC((s) => s.settings.RC_THEME) === "dark";
  const model = robot.robot!.model;
  const base = absPose(ws, robot.id);
  const tool = mode === 3 ? toolPose(ws, robot.id) : eye();
   
  const key = JSON.stringify([base, tool, model.userLower, model.userUpper, model.polygon, mode]);
  const geo = useMemo(() => {
    void key;
    const env = workspaceEnvelope(model, mode, base, tool);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(env.points, 3));
    g.setIndex(new THREE.BufferAttribute(envelopeIndices(env), 1));
    g.computeVertexNormals();
     
    const lines: number[] = [];
    const p = (i: number, j: number) => Array.from(env.points.subarray((i * env.cols + j) * 3, (i * env.cols + j) * 3 + 3));
    for (let i = 0; i < env.rows; i += 6) for (let j = 0; j < env.cols - 1; j++) lines.push(...p(i, j), ...p(i, j + 1));
    for (let j = 0; j < env.cols; j += 6) for (let i = 0; i < env.rows - 1; i++) lines.push(...p(i, j), ...p(i + 1, j));
    const l = new THREE.BufferGeometry();
    l.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    return { surface: g, lines: l };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const color = dark ? "#67e8f9" : "#0a84ff";
  return (
    <group userData={{ ignoreFit: true }} renderOrder={5}>
      <mesh geometry={geo.surface} raycast={() => null}>
        <meshBasicMaterial color={color} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments geometry={geo.lines} raycast={() => null}>
        <lineBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

export function WorkspaceEnvelopes({ ws, items, view }: { ws: Workspace; items: Item[]; view: ViewState }) {
  return (
    <>
      {items
        .filter((r) => r.type === "robot" && r.robot && r.robot.model.nq > 0)
        .map((r) => {
          const mode = workspaceModeOf(r, view);
          return mode >= 1 && mode <= 3 ? <EnvelopeMesh key={`${r.id}:${mode}`} robot={r} mode={mode as 1 | 2 | 3} ws={ws} /> : null;
        })}
    </>
  );
}
