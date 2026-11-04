"use client";

import { useSyncExternalStore } from "react";







function makeDisplacementMap(size = 256): string {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const r = size * 0.18;  
  const bezel = size * 0.16;  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
       
      const px = Math.abs(x + 0.5 - size / 2) - (size / 2 - r);
      const py = Math.abs(y + 0.5 - size / 2) - (size / 2 - r);
      const ox = Math.max(px, 0);
      const oy = Math.max(py, 0);
      const dist = Math.min(Math.max(px, py), 0) + Math.hypot(ox, oy) - r;  
      const inside = -dist;
      let dx = 0;
      let dy = 0;
      if (inside < bezel) {
         
        const t = 1 - Math.max(0, inside) / bezel;
        const strength = t * t * (3 - 2 * t);
        const vx = size / 2 - (x + 0.5);
        const vy = size / 2 - (y + 0.5);
        const len = Math.hypot(vx, vy) || 1;
        dx = (vx / len) * strength;
        dy = (vy / len) * strength;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(128 + dx * 127);
      img.data[i + 1] = Math.round(128 + dy * 127);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

let cachedMap: string | null = null;
const noSubscribe = () => () => {};

export default function LiquidFilter() {
   
  const map = useSyncExternalStore(noSubscribe, () => (cachedMap ??= makeDisplacementMap()), () => null);
  if (!map) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <defs>
        <filter id="rc-liquid" x="0" y="0" width="100%" height="100%" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
          <feImage href={map} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="0.045" xChannelSelector="R" yChannelSelector="G" result="refracted" />
          <feColorMatrix in="refracted" type="saturate" values="1.25" />
        </filter>
      </defs>
    </svg>
  );
}
