 
 
 
 
 
 
 
 
 
 
 
 

import type { BodyMode } from "./types";

 
export const AUTO = {
   
  supportGap: 3,
   
  touchGap: 1,
   
  penetration: 1.5,
   
  largeSize: 2000,
   
  largeVolume: 1.0,
   
  supporterRatio: 1.5,
   
  supporterParts: 2,
   
  stackLayers: 4,
   
  holderDrop: 5,
} as const;

 
export interface Candidate {
  key: string;
  name: string;
  mode: BodyMode;
   
  size: number;
   
  volume: number;
  locked: boolean;
   
  released?: boolean;
   
  carrier?: string;
   
  box?: { min: [number, number, number]; max: [number, number, number] };
}

 
export interface Other {
  key: string;
  name: string;
  role: "floor" | "static" | "kinematic" | "dynamic";
   
  robotBase?: boolean;
}

export interface Relations {
   
  pen: Map<string, Map<string, number>>;
   
  touch: Map<string, Set<string>>;
   
  below: Map<string, Set<string>>;
   
  overlap?: Map<string, Map<string, number>>;
}

export interface Decision {
  role: "dynamic" | "static";
  reason: string;
   
  ignore: string[];
}

const mm = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} m` : `${Math.round(v)} mm`);

export function decide(cands: Candidate[], others: Other[], rel: Relations): Map<string, Decision> {
  const name = new Map<string, string>([...others.map((o) => [o.key, o.name] as const), ...cands.map((c) => [c.key, c.name] as const)]);
  const other = new Map(others.map((o) => [o.key, o]));
  const cand = new Map(cands.map((c) => [c.key, c]));
  const out = new Map<string, Decision>();
  const fixed = new Map<string, string>();  
  const label = (k: string) => (k === "floor" ? "the floor" : (name.get(k) ?? k));

  for (const c of cands) {
    if (c.mode === "static") fixed.set(c.key, "set to Static");
    else if (c.mode === "auto" && c.locked) fixed.set(c.key, "locked");
    else if (c.mode === "auto" && !c.released && (c.size >= AUTO.largeSize || c.volume >= AUTO.largeVolume)) fixed.set(c.key, `large: ${mm(c.size)}`);
  }
   
  const solid = (k: string) => fixed.has(k) || (other.get(k)?.role ?? "") === "static" || k === "floor";
   
  const firm = (k: string) => /^(set to Static|locked|large)/.test(fixed.get(k) ?? "");
  const kinematic = (k: string) => other.get(k)?.role === "kinematic";
  const moving = (k: string) => cand.has(k) || other.get(k)?.role === "dynamic";
  const penOf = (a: string, b: string) => rel.pen.get(a)?.get(b) ?? 0;
   
  const copies = (a: string, b: string) => (rel.overlap?.get(a)?.get(b) ?? 0) > AUTO.penetration && penOf(a, b) <= AUTO.penetration && penOf(b, a) <= AUTO.penetration;
   
  const mutual = (a: string, b: string) => (penOf(a, b) > AUTO.penetration && penOf(b, a) > AUTO.penetration) || copies(a, b);
   
   
  const lower = (s: string, k: string) => {
    const a = cand.get(s)?.box;
    const b = cand.get(k)?.box;
    return !a || !b || a.min[2] < b.min[2] - 1;
  };
  const restsOn = new Map<string, string[]>();
  for (const [k, set] of rel.below) for (const s of set) if (!mutual(k, s) && lower(s, k)) restsOn.set(s, [...(restsOn.get(s) ?? []), k]);
   
  const height = new Map<string, number>();
  const stackOn = (k: string, seen: Set<string>): number => {
    const hit = height.get(k);
    if (hit !== undefined) return hit;
    if (seen.has(k) || seen.size > 256) return 0;
    seen.add(k);
    let h = 0;
    for (const up of restsOn.get(k) ?? []) if (cand.has(up) && up !== k) h = Math.max(h, 1 + stackOn(up, seen));
    seen.delete(k);
    height.set(k, h);
    return h;
  };
  for (const c of cands) stackOn(c.key, new Set());

  for (let pass = 0; pass < 32; pass++) {
    let changed = false;
    for (const c of cands) {
      if (c.mode !== "auto" || fixed.has(c.key)) continue;
      const pen = rel.pen.get(c.key) ?? new Map<string, number>();
      const deep = [...pen].filter(([k, d]) => d > AUTO.penetration && k !== c.carrier);
      let reason: string | null = null;
      if (!c.released) {
         
        const base = (restsOn.get(c.key) ?? []).find((k) => other.get(k)?.robotBase);
        if (base) reason = `carries ${label(base)}`;
      }
      if (!reason) {
         
         
         
        const hit = deep.find(([k]) => (solid(k) && (!fixed.has(k) || firm(k) || lower(k, c.key))) || (kinematic(k) && !c.released));
        if (hit) reason = hit[0] === "floor" ? "below the floor" : `penetrates ${label(hit[0])}`;
      }
      if (!reason && !c.released) {
        const onIt = (restsOn.get(c.key) ?? []).filter((k) => k !== c.key);
         
        const heavy = onIt.find((k) => solid(k) || kinematic(k));
        if (heavy) reason = `supports ${label(heavy)}`;
        else {
           
           
          const all = onIt.filter((k) => cand.has(k));
          const parts = all.length >= AUTO.supporterParts ? all : all.filter((k) => c.size >= AUTO.supporterRatio * cand.get(k)!.size);
          if (parts.length) reason = parts.length === 1 ? `supports ${label(parts[0])}` : `supports ${parts.length} parts`;
           
          else if ((height.get(c.key) ?? 0) >= AUTO.stackLayers) reason = `under a stack of ${height.get(c.key)} parts`;
        }
      }
      if (!reason && !c.released && c.box) {
         
        const held = [...cand.values()].find(
          (k) =>
            k.key !== c.key &&
            k.box &&
            mutual(c.key, k.key) &&
            c.box!.min[2] < k.box.min[2] - AUTO.holderDrop &&
            c.box!.min[0] <= (k.box.min[0] + k.box.max[0]) / 2 &&
            c.box!.max[0] >= (k.box.min[0] + k.box.max[0]) / 2 &&
            c.box!.min[1] <= (k.box.min[1] + k.box.max[1]) / 2 &&
            c.box!.max[1] >= (k.box.min[1] + k.box.max[1]) / 2,
        );
        if (held) reason = `holds ${label(held.key)}`;
      }
      if (!reason) {
         
        const swallowed = deep.find(([k]) => cand.has(k) && !((rel.pen.get(k)?.get(c.key) ?? 0) > AUTO.penetration));
        if (swallowed) reason = `contains ${label(swallowed[0])}`;
      }
      if (!reason && !c.released && !(rel.below.get(c.key)?.size ?? 0)) {
         
        const mount = [...(rel.touch.get(c.key) ?? [])].find((k) => solid(k) || kinematic(k));
        if (mount) reason = `mounted on ${label(mount)}`;
      }
      if (reason) {
        fixed.set(c.key, reason);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const c of cands) {
    const r = fixed.get(c.key);
    if (r) {
      out.set(c.key, { role: "static", reason: r, ignore: [] });
      continue;
    }
    const below = [...(rel.below.get(c.key) ?? [])];
    const pen = rel.pen.get(c.key) ?? new Map<string, number>();
     
    const ignore = [...pen].filter(([k, d]) => d > AUTO.penetration && (k === c.carrier || moving(k) || kinematic(k))).map(([k]) => k);
    for (const [k] of rel.overlap?.get(c.key) ?? []) if (copies(c.key, k) && !fixed.has(k) && cand.has(k) && !ignore.includes(k)) ignore.push(k);
    if (c.carrier && !ignore.includes(c.carrier) && (pen.get(c.carrier) ?? 0) > 0) ignore.push(c.carrier);
    const resting = below.filter((k) => k !== c.carrier && !mutual(c.key, k) && lower(k, c.key));
    const reason =
      c.mode === "dynamic" ? "set to Dynamic" : c.released ? (resting.length ? `released onto ${label(resting[0])}` : "released") : resting.length ? `rests on ${label(resting[0])}` : "floating";
    out.set(c.key, { role: "dynamic", reason, ignore });
  }
  return out;
}
