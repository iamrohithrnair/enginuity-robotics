 
 
 
 

type S = Record<string, unknown>;

export const TREE_TEXT_RANGE = [8, 40] as const;
export const TREE_ICON_RANGE = [10, 64] as const;

const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v !== undefined ? Number(v) : d);
const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

 
export function treeSizes(settings: S) {
  const text = clamp(num(settings.TreeTextSize, 12.5), TREE_TEXT_RANGE);
  const icon = clamp(num(settings.TreeIconSize, 15), TREE_ICON_RANGE);
  const row = Math.max(28, Math.round(Math.max(icon + 12, text * 2.2)));
  const set = settings.TreeSizePercentSet === true || settings.TreeSizePercentSet === "true" || settings.TreeSizePercentSet === 1;
  const pct = clamp(num(settings.TreeSizePercent, 20), [5, 90]);
   
  const width = set ? `max(180px, ${pct}vw)` : "clamp(250px, 17vw, 340px)";
  return { text, icon, row, width };
}





export function angleDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return (-deltaY / 3) * 120;
  if (deltaMode === 2) return -deltaY * 120;
  return (-deltaY / 100) * 120;
}

 
export function zoomTree(settings: S, angle: number): { TreeTextSize: number; TreeIconSize: number } {
  const { text, icon } = treeSizes(settings);
  const d = angle / 80;
  const r = (v: number) => Math.round(v * 10) / 10;
  return { TreeTextSize: r(clamp(text + d, TREE_TEXT_RANGE)), TreeIconSize: r(clamp(icon + d, TREE_ICON_RANGE)) };
}
