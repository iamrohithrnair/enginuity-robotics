// Formats program durations and completion status messages.
 
 
 

const pad = (s: string, width: number, ch = " ") => (s.length >= width ? s : ch.repeat(width - s.length) + s);

 
const fz = (v: number, width: number, prec: number) => {
  const s = v.toFixed(prec);
  return s.startsWith("-") ? "-" + pad(s.slice(1), width - 1, "0") : pad(s, width, "0");
};

export function formatProgramTime(t: number): string {
  if (!(t > 0)) return "0.000s";
  if (t < 60) return `${fz(t, 3, 1)}s`;
  if (t < 3600) {
    const m = Math.floor(t / 60);
    return `${pad(String(m), 2)}m ${fz(t - m * 60, 3, 1)}s`;
  }
  if (t < 86400) {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t - h * 3600) / 60);
    return `${pad(String(h), 2, "0")}h ${pad(String(m), 2, "0")}m ${fz(t - h * 3600 - m * 60, 2, 0)}s`;
  }
  const d = Math.floor(t / 86400);
  const h = Math.floor((t - d * 86400) / 3600);
  const m = Math.floor((t - d * 86400 - h * 3600) / 60);
  return `${d}d ${pad(String(h), 2, "0")}h ${pad(String(m), 2, "0")}m ${fz(t - d * 86400 - h * 3600 - m * 60, 2, 0)}s`;
}

 
export function programFinishedText(name: string, distanceMM: number, timeS: number): string {
  if (timeS <= 0.01) return `Program ${name} finished`;
  return `Program ${name} finished (path length: ${distanceMM.toFixed(1)} mm, program time: ${formatProgramTime(timeS)})`;
}
