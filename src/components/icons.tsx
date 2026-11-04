"use client";
 
 
 
 
 
 
 
 
 
import { useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";
import type { AnimatedComponent, AnimatedHandle, AnimatedIconId } from "./icons/animated-icons";
import { ICON_MARKUP } from "./icons/markup.generated";

type P = SVGProps<SVGSVGElement> & { size?: number };

type AnimatedIcons = Record<AnimatedIconId, AnimatedComponent>;
let animatedIcons: AnimatedIcons | null = null;
let loading: Promise<AnimatedIcons> | null = null;

 
function loadAnimatedIcons(): Promise<AnimatedIcons> {
  loading ??= import("./icons/animated-icons").then(
    (m) => (animatedIcons = m.ANIMATED_ICONS),
    (err: unknown) => {
      loading = null;
      throw err;
    },
  );
  return loading;
}

 
let prefetchScheduled = false;
function prefetchWhenIdle() {
  if (prefetchScheduled) return;
  prefetchScheduled = true;
  const load = () => void loadAnimatedIcons().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 2000);
}

 
const HOVER_HOST =
  "button, a[href], summary, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=tab], [role=option], [role=switch]";

const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function AnimatedIcon({ icon: id, size = 16, color, className, style }: P & { icon: AnimatedIconId }) {
  const svg = useRef<SVGSVGElement>(null);
  const handle = useRef<AnimatedHandle>(null);
  const pending = useRef(false);
  const [Live, setLive] = useState<AnimatedComponent | null>(null);

  useEffect(() => {
    prefetchWhenIdle();
     
    const el = svg.current?.parentElement;
    if (!el) return;
    const host = el.closest<HTMLElement>(HOVER_HOST) ?? el;
    const enter = () => {
      if (prefersReducedMotion() || host.matches(":disabled")) return;
      if (handle.current) return handle.current.startAnimation();
      pending.current = true;
      const icons = animatedIcons;
      if (icons) setLive(() => icons[id]);
      else loadAnimatedIcons().then((icons) => pending.current && setLive(() => icons[id]), () => {});
    };
    const leave = () => {
      pending.current = false;
      handle.current?.stopAnimation();
    };
    host.addEventListener("pointerenter", enter);
    host.addEventListener("pointerleave", leave);
    return () => {
      host.removeEventListener("pointerenter", enter);
      host.removeEventListener("pointerleave", leave);
    };
  }, [id]);

   
  useEffect(() => {
    if (!Live || !pending.current) return;
    pending.current = false;
    handle.current?.startAnimation();
  }, [Live]);

  if (Live) return <Live ref={handle} size={size} aria-hidden className={className} style={{ display: "inline-flex", color, ...style }} />;
  return (
    <svg
      ref={svg}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      color={color}
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: ICON_MARKUP[id] }}
    />
  );
}

 
function I({ size = 16, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Station: (p: P) => (
    <I {...p}>
      <ellipse cx="12" cy="17" rx="8.5" ry="3" />
      <path d="M3.5 17V13.5M20.5 17v-3.5" />
      <ellipse cx="12" cy="13.5" rx="8.5" ry="3" />
      <path d="M12 3v7.5M12 3l3 2M12 3 9 5" />
    </I>
  ),
  Robot: (p: P) => (
    <I {...p}>
      <path d="M5 20h8" />
      <path d="M9 20v-3" />
      <circle cx="9" cy="15.5" r="1.6" />
      <path d="m10.2 14.4 4.3-4.6" />
      <circle cx="15.5" cy="8.8" r="1.6" />
      <path d="m16.9 8 2.6 1.5M19.5 9.5l1 2.2M19.5 9.5l2.2-.4" />
    </I>
  ),
  Frame: (p: P) => (
    <I {...p}>
      <path d="M6 18V5M6 18h13M6 18l-3.5 3" />
      <path d="M4.5 6.5 6 5l1.5 1.5M17.5 16.5 19 18l-1.5 1.5" />
    </I>
  ),
   
  Tool: (p: P) => (
    <I {...p}>
      <path d="M9 3h6v5H9z" />
      <path d="M8 8h8l-1 4H9z" />
      <path d="M10 12v5l-1.5 4M14 12v5l1.5 4" />
    </I>
  ),
  Object: (p: P) => <AnimatedIcon icon="lucide/box" {...p} />,
  Target: (p: P) => <AnimatedIcon icon="lucide/target" {...p} />,
  JointTarget: (p: P) => (
    <I {...p}>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 12 16 8" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="M12 2v3M2 12h3M19 12h3" />
    </I>
  ),
  Program: (p: P) => <AnimatedIcon icon="lucide/file-code" {...p} />,
  Folder: (p: P) => <AnimatedIcon icon="lucide/folder" {...p} />,
  Notes: (p: P) => <AnimatedIcon icon="lucide/sticky-note" {...p} />,
  Python: (p: P) => <AnimatedIcon icon="lucide/file-terminal" {...p} />,
  Script: (p: P) => <AnimatedIcon icon="lucide/scroll-text" {...p} />,
  Curve: (p: P) => <AnimatedIcon icon="lucide/route" {...p} />,
  MoveJ: (p: P) => (
    <I {...p}>
      <path d="M4 18c2-9 9-12 16-12" strokeDasharray="2.6 2.6" />
      <circle cx="20" cy="6" r="1.8" />
    </I>
  ),
  MoveL: (p: P) => (
    <I {...p}>
      <path d="M4 19 19 5" />
      <circle cx="19" cy="5" r="1.8" />
    </I>
  ),
  MoveC: (p: P) => (
    <I {...p}>
      <path d="M4 18a10 10 0 0 1 16-6" />
      <circle cx="12" cy="9" r="1.2" />
      <circle cx="20" cy="12" r="1.8" />
    </I>
  ),
  Speed: (p: P) => <AnimatedIcon icon="lucide/gauge" {...p} />,
  Rounding: (p: P) => (
    <I {...p}>
      <path d="M4 20V12a8 8 0 0 1 8-8h8" />
    </I>
  ),
  Pause: (p: P) => <AnimatedIcon icon="lucide/pause" {...p} />,
  Play: (p: P) => <AnimatedIcon icon="lucide/play" {...p} />,
  Stop: (p: P) => <AnimatedIcon icon="lucide/circle-stop" {...p} />,
  FastForward: (p: P) => <AnimatedIcon icon="lucide/fast-forward" {...p} />,
  Message: (p: P) => <AnimatedIcon icon="lucide/message-square" {...p} />,
  Comment: (p: P) => <AnimatedIcon icon="lucide/message-square-text" {...p} />,
  Code: (p: P) => <AnimatedIcon icon="lucide/code-xml" {...p} />,
  Call: (p: P) => <AnimatedIcon icon="lucide/corner-down-right" {...p} />,
  IO: (p: P) => <AnimatedIcon icon="lucide/toggle-right" {...p} />,
  Event: (p: P) => <AnimatedIcon icon="lucide/zap" {...p} />,
  Library: (p: P) => <AnimatedIcon icon="lucide/blocks" {...p} />,
  Decision: (p: P) => <AnimatedIcon icon="lucide/signpost" {...p} />,
  Sparkle: (p: P) => <AnimatedIcon icon="lucide/sparkles" {...p} />,
  Undo: (p: P) => <AnimatedIcon icon="lucide/undo" {...p} />,
  Redo: (p: P) => <AnimatedIcon icon="lucide/redo" {...p} />,
  Save: (p: P) => <AnimatedIcon icon="lucide/save" {...p} />,
  Open: (p: P) => <AnimatedIcon icon="lucide/folder-open" {...p} />,
  New: (p: P) => <AnimatedIcon icon="lucide/file-plus" {...p} />,
  Eye: (p: P) => <AnimatedIcon icon="lucide/eye" {...p} />,
  EyeOff: (p: P) => <AnimatedIcon icon="lucide/eye-off" {...p} />,
  Search: (p: P) => <AnimatedIcon icon="lucide/search" {...p} />,
  Settings: (p: P) => <AnimatedIcon icon="lucide/settings" {...p} />,
  Close: (p: P) => <AnimatedIcon icon="lucide/x" {...p} />,
  ChevronRight: (p: P) => <AnimatedIcon icon="lucide/chevron-right" {...p} />,
  ChevronDown: (p: P) => <AnimatedIcon icon="lucide/chevron-down" {...p} />,
  Plus: (p: P) => <AnimatedIcon icon="lucide/plus" {...p} />,
  Minus: (p: P) => <AnimatedIcon icon="lucide/minus" {...p} />,
  Trash: (p: P) => <AnimatedIcon icon="lucide/trash-2" {...p} />,
  Copy: (p: P) => <AnimatedIcon icon="lucide/copy" {...p} />,
  Cube: (p: P) => <AnimatedIcon icon="lucide/box" {...p} />,
  Fit: (p: P) => <AnimatedIcon icon="lucide/scan" {...p} />,
  Collision: (p: P) => <AnimatedIcon icon="lucide/blend" {...p} />,
  Home: (p: P) => <AnimatedIcon icon="lucide/house" {...p} />,
  Check: (p: P) => <AnimatedIcon icon="lucide/check" {...p} />,
  Warning: (p: P) => <AnimatedIcon icon="lucide/triangle-alert" {...p} />,
  Info: (p: P) => <AnimatedIcon icon="lucide/info" {...p} />,
  Send: (p: P) => <AnimatedIcon icon="lucide/send" {...p} />,
   
  Grid: (p: P) => (
    <I {...p}>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </I>
  ),
  Layers: (p: P) => <AnimatedIcon icon="lucide/layers" {...p} />,
  Command: (p: P) => <AnimatedIcon icon="lucide/command" {...p} />,
  Download: (p: P) => <AnimatedIcon icon="lucide/download" {...p} />,
   
  Teach: (p: P) => <AnimatedIcon icon="lucide-animated/map-pin-plus" {...p} />,
  Gauge: (p: P) => <AnimatedIcon icon="lucide/gauge" {...p} />,
  Loop: (p: P) => <AnimatedIcon icon="lucide/repeat" {...p} />,
   
  CloseUp: (p: P) => (
    <I {...p}>
      <circle cx="10" cy="10" r="6.6" />
      <path d="m14.8 14.8 5.7 5.7" />
      <path d="M7.4 7.3h5.2M8.2 7.3v3.4l1.3 1.6M11.8 7.3v3.4l-1.3 1.6" />
    </I>
  ),
   
  Measure: (p: P) => <AnimatedIcon icon="lucide/ruler" {...p} />,
   
  Palette: (p: P) => <AnimatedIcon icon="lucide/palette" {...p} />,
  Help: (p: P) => <AnimatedIcon icon="lucide/circle-question-mark" {...p} />,
   
  Cursor: (p: P) => <AnimatedIcon icon="lucide/mouse-pointer" {...p} />,
   
  NoCursor: (p: P) => (
    <I {...p}>
      <path d="M6 3.5 18 10.8l-5.5 1.3-2.7 5.7z" />
      <path d="m3.5 20.5 17-17" />
    </I>
  ),
   
  MoveRef: (p: P) => <AnimatedIcon icon="lucide/move" {...p} />,
   
  MoveTool: (p: P) => <AnimatedIcon icon="lucide-animated/hand-grab" {...p} />,
   
  Orbit: (p: P) => <AnimatedIcon icon="lucide/rotate-cw" {...p} />,
   
  Pan: (p: P) => <AnimatedIcon icon="lucide/hand" {...p} />,
   
  ZoomIn: (p: P) => <AnimatedIcon icon="lucide/zoom-in" {...p} />,
   
  Expand: (p: P) => <AnimatedIcon icon="lucide/expand" {...p} />,
   
  Camera: (p: P) => <AnimatedIcon icon="lucide/camera" {...p} />,
   
  Cut: (p: P) => <AnimatedIcon icon="lucide/scissors" {...p} />,
   
  Paste: (p: P) => <AnimatedIcon icon="lucide/clipboard-paste" {...p} />,
   
  Print: (p: P) => <AnimatedIcon icon="lucide/printer" {...p} />,
   
  CameraItem: (p: P) => <AnimatedIcon icon="lucide-animated/cctv" {...p} />,
   
  Trace: (p: P) => <AnimatedIcon icon="lucide/activity" {...p} />,
   
  Perspective: (p: P) => (
    <I {...p}>
      <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5z" />
      <path d="M8.5 9.5h7v6h-7zM4 7.5l4.5 2M20 7.5l-4.5 2M4 16.5l4.5-1M20 16.5l-4.5-1" />
    </I>
  ),
   
  Package: (p: P) => <AnimatedIcon icon="lucide/package" {...p} />,
   
  ExternalLink: (p: P) => <AnimatedIcon icon="lucide/external-link" {...p} />,
};

export type IconName = keyof typeof Icon;

export function ItemIcon({ type, size = 15, isJoint }: { type: string; size?: number; isJoint?: boolean }) {
  const map: Record<string, IconName> = {
    station: "Station",
    robot: "Robot",
    frame: "Frame",
    tool: "Tool",
    object: "Object",
    target: isJoint ? "JointTarget" : "Target",
    program: "Program",
    folder: "Folder",
    notes: "Notes",
    python: "Python",
    script: "Script",
    curve: "Curve",
    machining: "Curve",
    camera: "CameraItem",
  };
  const C = Icon[map[type] ?? "Object"];
  return <C size={size} />;
}

export function InstructionIcon({ kind, moveType, size = 14 }: { kind?: string; moveType?: string; size?: number }) {
  const k: IconName =
    kind === "move"
      ? moveType === "linear"
        ? "MoveL"
        : "MoveJ"
      : kind === "movec"
        ? "MoveC"
        : kind === "speed"
          ? "Speed"
          : kind === "rounding"
            ? "Rounding"
            : kind === "frame"
              ? "Frame"
              : kind === "tool"
                ? "Tool"
                : kind === "pause"
                  ? "Pause"
                  : kind === "print"
                    ? "Message"
                    : kind === "io"
                      ? "IO"
                      : kind === "event"
                        ? "Event"
                        : kind === "code"
                          ? "Code"
                          : "Code";
  const C = Icon[k];
  return <C size={size} />;
}
