// Parses object display strings into point, line and surface styles.
 
 
 
 
 
 
 
 
 
 
 
 

import { parseParticle, type ParticleShape } from "./spray/options";
import { parseQColor } from "./spray/qcolor";

export interface DisplayStyle {
   
  lineWidth: number;
   
  pointSize: number;
   
  color: [number, number, number, number] | null;
  particle: ParticleShape | null;
}

 
function toFloat(s: string): number {
  const t = s.trim();
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Math.fround(Number(t)) : 0;
}

export function parseDisplayString(value: string): DisplayStyle {
  const out: DisplayStyle = { lineWidth: -1, pointSize: -1, color: null, particle: null };
  for (const tok of value.split(" ").filter(Boolean)) {
    const up = tok.toUpperCase();
    if (up.startsWith("PARTICLE=")) {
      let spec = tok.slice(9);
      if (spec.endsWith(")")) spec = spec.slice(0, -1);
      out.particle = parseParticle(spec) ?? out.particle;
    } else if (up.startsWith("POINTSIZE=")) out.pointSize = toFloat(tok.slice(10));
    else if (up.startsWith("LINEW=")) out.lineWidth = toFloat(tok.slice(6));
    else if (tok.startsWith("COLOR=")) {
       
      const c = parseQColor(tok.slice(6));
      out.color = [c[0], c[1], c[2], c[3]];
    }
  }
  return out;
}
