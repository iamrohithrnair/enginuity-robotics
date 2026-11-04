 
 
 
 

import type { Item } from "./types";

type Remap = (id: string | null | undefined) => string | null;

 
export function remapItemRefs(it: Item, remap: Remap): Item {
  if (it.robot) {
    it.robot.activeTool = remap(it.robot.activeTool);
    it.robot.activeFrame = remap(it.robot.activeFrame);
  }
  if (it.target) it.target.robot = remap(it.target.robot);
  if (it.program) it.program.robot = remap(it.program.robot);
  const ins = it.instruction;
  if (ins) {
    ins.target = remap(ins.target);
    ins.target2 = remap(ins.target2);
    ins.frame = remap(ins.frame);
    ins.tool = remap(ins.tool);
    ins.robot = remap(ins.robot);
    const ev = ins.event;
    if (ev) {
      ev.tool = remap(ev.tool);
      ev.object = remap(ev.object);
      ev.frame = remap(ev.frame);
      if (ev.objects) ev.objects = ev.objects.map((o) => remap(o)).filter((o): o is string => !!o);
      if (ev.positions) ev.positions = ev.positions.flatMap((p) => (remap(p.item) ? [{ ...p, item: remap(p.item)!, parent: remap(p.parent) }] : []));
    }
    if (ins.decision && ins.decision.camera !== undefined) ins.decision.camera = remap(ins.decision.camera);
  }
  const m = it.machining;
  if (m) {
    m.robot = remap(m.robot);
    m.frame = remap(m.frame);
    m.tool = remap(m.tool);
    m.program = remap(m.program);
    if (m.input && m.input.object !== undefined) m.input.object = remap(m.input.object);
  }
  if (it.camera) it.camera.link = remap(it.camera.link);
  if (it.collisionMap) {
    it.collisionMap.pairs = it.collisionMap.pairs.flatMap(([a, la, b, lb, on]) => {
      const ra = remap(a);
      const rb = remap(b);
      return ra && rb ? [[ra, la, rb, lb, on] as [string, number, string, number, boolean]] : [];
    });
  }
  return it;
}
