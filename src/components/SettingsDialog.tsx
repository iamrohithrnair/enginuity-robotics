"use client";
// Edits application options, keyboard shortcuts, and Copilot settings.

 
 
 
 
 

import { useEffect, useMemo, useState } from "react";
import { cmd, saveSettings } from "@/client/api";
import { recoverBackupUI, stationParamsUI } from "@/client/fileActions";
import { eventKeys, prettyKeys } from "@/client/shortcuts";
import { useRC, useViewState } from "@/client/store";
import { runAction } from "@/client/uiActions";
import { effectiveShortcut, MAIN_ACTIONS, shortcutOverrides } from "@/engine/actions";
import { DEFAULT_SETTINGS, SETTINGS_DOC } from "@/engine/settings";
import { stationParams } from "@/engine/stationParams";
import { navStyle } from "@/engine/view";
import { clearOptionsTab, DEFAULT_GUARD_MODEL, DEFAULT_MODEL, flag, GUARD_MODELS, META_MODELS, peekOptionsTab, providerOf, PROVIDERS, useAgentInfo } from "./copilot/agentInfo";
import { CapabilityChips, ModelBadge } from "./copilot/CopilotUi";
import DecisionModelsSection from "./decisions/DecisionModelsSection";
import { Icon } from "./icons";

type FieldType = "number" | "boolean" | "text" | "secret" | "select";
interface Field {
  key: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
   
  get?: () => unknown;
  set?: (v: unknown) => void;
}
interface Tab {
  title: string;
  sections: { title?: string; fields: Field[] }[];
   
  note?: string;
  extra?: "undo" | "station" | "copilot";
   
  top?: "copilot";
}

const opt = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const num = (key: string, label?: string): Field => ({ key, label: label ?? SETTINGS_DOC[key] ?? key, type: "number" });
const bool = (key: string, label?: string): Field => ({ key, label: label ?? SETTINGS_DOC[key] ?? key, type: "boolean" });
const setting = (key: string) => useRC.getState().settings[key] ?? DEFAULT_SETTINGS[key];

 
const NAV = opt(["robocraft", "Enginuity"], ["0", "Classic"], ["1", "TopSolid"], ["2", "Rhinoceros"], ["3", "Alphacam"], ["4", "WorkNC"], ["5", "Mastercam"], ["6", "SolidWorks"], ["7", "Customized"]);

 
interface Ui {
  customProvider: boolean;
  setCustomProvider: (on: boolean) => void;
}

const saveAll = async (values: Record<string, unknown>) => {
  const message = await saveSettings(values);
  if (message) useRC.getState().toast({ kind: "error", title: "Options", body: message });
};

 
function copilotTab(ui: Ui): Tab {
  const base = String(setting("RC_AGENT_BASE_URL") ?? "");
  const provider = ui.customProvider ? "custom" : providerOf(base);
  const preset = PROVIDERS.find((p) => p.id === provider);
  const model = String(setting("RC_AGENT_MODEL") ?? "");
  const isMetaModel = (id: string) => META_MODELS.some((m) => m.id.toLowerCase() === id.toLowerCase());
  const metaOptions = META_MODELS.map((m) => ({ value: m.id, label: `${m.label} — ${m.blurb}${m.id === DEFAULT_MODEL ? " (default)" : ""}` }));
  if (model && !isMetaModel(model)) metaOptions.push({ value: model, label: model });
  const guardOptions = GUARD_MODELS.map((m) => ({ value: m.id, label: `${m.label}${m.id === DEFAULT_GUARD_MODEL ? " (default)" : ""}` }));
  const guardModel = String(setting("RC_AGENT_GUARD_MODEL") || DEFAULT_GUARD_MODEL);
  if (!guardOptions.some((o) => o.value === guardModel)) guardOptions.push({ value: guardModel, label: guardModel });
  return {
    title: "Copilot",
    top: "copilot",
    sections: [
      {
        title: "Model",
        fields: [
          {
            key: "_provider",
            label: "Provider",
            type: "select",
            options: PROVIDERS.map((p) => ({ value: p.id, label: p.id === "meta" ? `${p.label} (default)` : p.label })),
            hint: provider === "custom" ? "Any OpenAI-compatible endpoint: type its base URL below" : undefined,
            get: () => provider,
            set: (v) => {
              const p = PROVIDERS.find((x) => x.id === v);
              ui.setCustomProvider(v === "custom");
              if (!p || !p.baseURL) return;
               
              void saveAll({ RC_AGENT_BASE_URL: p.baseURL, ...(p.id === "meta" && !isMetaModel(model) ? { RC_AGENT_MODEL: DEFAULT_MODEL } : {}) });
            },
          },
          { key: "RC_AGENT_BASE_URL", label: "Base URL", type: "text", placeholder: "https://…/v1", hint: provider === "custom" ? undefined : `${preset?.label ?? "Provider"} endpoint (OpenAI-compatible)` },
          providerOf(base) === "meta"
            ? { key: "RC_AGENT_MODEL", label: "Model", type: "select", options: metaOptions, hint: "Meta Muse models, served by Meta Model API" }
            : { key: "RC_AGENT_MODEL", label: "Model", type: "text", placeholder: "model id" },
          {
            key: "RC_AGENT_REASONING",
            label: "Reasoning effort",
            type: "select",
            options: opt(
              ["default", "Model default"],
              ["minimal", "Minimal (fastest)"],
              ["low", "Low"],
              ["medium", "Medium"],
              ["high", "High"],
              ["xhigh", "Extra high"],
              ["max", "Max (Muse Wonder and Muse Spark 1.3)"],
            ),
            hint: "Muse Spark and Muse Wonder always reason; minimal is the shortest pass",
            get: () => String(setting("RC_AGENT_REASONING") || "default"),
          },
          { key: "RC_AGENT_API_KEY", label: "API key", type: "secret", hint: preset?.keyEnv ? `Leave empty to use ${preset.keyEnv} from the server environment` : "Stored on the Enginuity server only" },
          { key: "RC_AGENT_API", label: "API flavour", type: "select", options: opt(["chat_completions", "chat_completions"], ["responses", "responses"]) },
        ],
      },
      {
        title: "Web search and photos",
        fields: [
          { key: "RC_AGENT_WEB_SEARCH", label: "Web search (Meta)", type: "boolean", hint: "Meta search grounding finds datasheets, specs and standards and cites its sources; uses the Meta Model API key", get: () => flag(setting("RC_AGENT_WEB_SEARCH"), true) },
          { key: "RC_AGENT_SAM", label: "Find objects in photos (SAM 3.1)", type: "boolean", hint: "SAM 3.1 locates the objects in photos you attach so the Copilot can lay out a matching cell", get: () => flag(setting("RC_AGENT_SAM"), true) },
        ],
      },
      {
        title: "Guardrails",
        fields: [
          { key: "RC_AGENT_GUARD", label: "Guardrails", type: "boolean", hint: "Muse Spark checks every request for scope and every web result for prompt injection", get: () => flag(setting("RC_AGENT_GUARD"), true) },
          { key: "RC_AGENT_GUARD_MODEL", label: "Guard model", type: "select", options: guardOptions, hint: "Runs on Meta Model API with structured output", get: () => guardModel },
        ],
      },
    ],
    extra: "copilot",
  };
}

 
function CopilotStatus() {
  const [info] = useAgentInfo();
  const key =
    !info || info.derived ? null : info.keySource === "settings" ? "API key saved in Options" : info.keySource === "env" ? `API key from the server environment${info.keyEnv ? ` (${info.keyEnv})` : ""}` : "No API key yet";
  return (
    <section>
      <div className="g-label" style={{ marginBottom: 8 }}>
        In use
      </div>
      <div className="glass-inset" style={{ padding: 12, display: "grid", gap: 10 }}>
        <ModelBadge info={info} />
        <CapabilityChips info={info} />
        {key && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: "500 11px var(--font-ui)", color: info?.keySource === "none" ? "var(--warn)" : "var(--ink-2)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: info?.keySource === "none" ? "var(--warn)" : "var(--good)" }} />
            {key}
            {info?.reasoning && info.reasoning !== "default" && <span style={{ color: "var(--ink-3)" }}>· reasoning {info.reasoning}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function tabs(view: ReturnType<typeof useViewState>, ui: Ui): Tab[] {
  return [
    {
      title: "General",
      sections: [
        {
          fields: [
            {
              key: "Dark_Theme",
              label: "Theme",
              type: "select",
              options: opt(["0", "Default"], ["1", "Light"], ["2", "Dark"]),
              set: async (v) => {
                await cmd("settings.set", { key: "Dark_Theme", value: Number(v) });
                await cmd("settings.set", { key: "RC_THEME", value: v === "2" ? "dark" : "light" });
              },
            },
            {
              key: "_tree",
              label: "Display tree preference",
              type: "select",
              options: opt(["inside", "Main window (transparent)"], ["docked", "Docked beside the 3D view"]),
              get: () => (view.treeInside ? "inside" : "docked"),
              set: (v) => void cmd("view.setDisplay", { treeInside: v === "inside", treeVisible: true }),
            },
            {
              key: "_nav",
              label: "Mouse 3D navigation",
              type: "select",
              options: NAV,
              hint: "Enginuity: drag items to move them and empty space to pan, right-drag orbits. Classic and the CAD presets use their own mouse mappings.",
              get: () => (navStyle({ RC_NAV_STYLE: setting("RC_NAV_STYLE") }) === "classic" ? String(setting("Mouse3D_Type")) : "robocraft"),
              set: async (v) => {
                if (v === "robocraft") return void (await cmd("view.setMouse", { navStyle: "robocraft" }));
                await cmd("settings.set", { key: "Mouse3D_Type", value: Number(v) });
                await cmd("view.setMouse", { navStyle: "classic" });
              },
            },
            {
              key: "_left",
              label: "Left click action",
              type: "select",
              options: opt(["select", "Select items"], ["rotate", "Rotate"], ["pan", "Pan"], ["zoom", "Zoom"], ["none", "No selection"]),
              get: () => view.leftAction,
              set: (v) => void cmd("view.setMouse", { left: v }),
            },
            bool("ZoomInvert"),
            bool("KeepRotationAligned", "Keep rotation aligned"),
            num("SliderIncrMM", "Position increment (mm)"),
            num("SliderIncrDeg", "Orientation increment (deg)"),
          ],
        },
         
        { title: "Text/icon size", fields: [{ ...num("TreeTextSize", "Text size (tree):"), hint: "Use ⌘/Ctrl + mouse wheel over the tree" }, num("TreeIconSize", "Icon size (tree):")] },
        { title: "Mouse", fields: [num("Mouse3D_SpeedRotate"), num("Mouse3D_SpeedZoom"), num("Mouse3D_ZoomSpeed"), bool("MouseFeedback", "Highlight items under the cursor"), bool("AllowTouch3D", "Touch navigation in the 3D view")] },
        { title: "Undo/Redo", fields: [num("UndoStackLimit")] },
        { title: "Auto backup", fields: [bool("AutoBackup_On", "Auto backup the active station"), num("AutoBackup_Min")] },
      ],
      extra: "undo",
    },
    {
      title: "Display",
      sections: [
        { title: "Reference sizes", fields: [num("FrameSizesRef"), num("FrameSizesTarget"), num("FrameSizesPath"), num("FrameSizesOther")] },
        { title: "Display text for", fields: [bool("TextFor_Frames", "Reference frames"), bool("TextFor_Robots", "Robots"), bool("TextFor_Objects", "Objects"), bool("TextFor_Tools", "Tools"), bool("TextFor_Targets", "Targets"), bool("TextFor_Programs", "Programs")] },
        {
          title: "3D view",
          fields: [
            bool("ShowRef_NewObjects"),
            bool("ShowHiddenSelected"),
            num("ViewAngle"),
            num("NearPlane"),
            num("FarPlane"),
            { key: "Trace_Render_Style", label: "Trace style", type: "select", options: opt(["0", "References"], ["1", "Line"], ["2", "Dots"], ["3", "Points"], ["4", "Spheres"]) },
            { key: "ColorBgTop", label: "Background top colour", type: "text", placeholder: "#RRGGBB", hint: "Empty follows the appearance", set: (v) => void cmd("view.setDisplay", { background: { top: String(v).trim() } }) },
            { key: "ColorBgBottom", label: "Background bottom colour", type: "text", placeholder: "#RRGGBB", hint: "Empty follows the appearance", set: (v) => void cmd("view.setDisplay", { background: { bottom: String(v).trim() } }) },
          ],
        },
        {
          title: "Curves and points",
          fields: [
            bool("DisplayCurves", "Display curves"),
            num("SizeRatioCurves", "Curve size"),
            bool("DisplayPoints", "Display points"),
            bool("ShowCurveNormals", "Display curve normals"),
            bool("DisplayCurveNormalsOnSelect", "Display curve normals on selection"),
            bool("ShowCurvePoints", "Display curve points"),
            num("SizeCurvePoints", "Curve point size"),
            bool("ShowPointNormals", "Display point normals"),
            bool("ShowSelectedPointNormals", "Display point normals on selection"),
            num("SizeNormals", "Normal size"),
            num("SizeCurveArrow", "Arrow size (curve/point)"),
            num("TolerancePickCurve", "Pick curve sensibility (mm)"),
            num("TolerancePickPoint", "Pick point sensibility (mm)"),
          ],
        },
      ],
    },
    {
      title: "Motion",
      sections: [
        {
          fields: [
            num("SimRatioNormal", "Simulation speed ratio"),
            num("SimRatioFast", "Fast simulation speed ratio"),
            num("RobotPathUpdateMS", "Update robot path rate (period in ms)"),
            {
              key: "MoveTimeCalc",
              label: "Move time calculation (linear vs. joint speed)",
              type: "select",
              options: opt(["0", "Strictest constraint"], ["1", "Linear constrained"], ["2", "Joint constrained"], ["3", "Linear for MoveL, Joint for MoveJ"], ["4", "Shortest time"]),
            },
            num("PathStepMM", "Maximum path step (mm)"),
            num("PathStepDeg", "Maximum path step (deg)"),
            num("ToleranceSmoothMove", "Angle tolerance for smooth movements (deg)"),
            num("ToleranceSingularityWrist"),
            num("ToleranceSingularityElbow", "Tolerance to avoid Elbow singularity (deg)"),
            num("ToleranceSingularityBack", "Tolerance to avoid Front/Back singularity (deg)"),
            num("ToleranceTurn180", "Tolerance for 180 deg joint turns (deg)"),
          ],
        },
        {
          title: "Collisions",
          fields: [
            num("PathStepCollisionMM", "Collision check step along paths (mm)"),
            num("PathStepCollisionDeg", "Collision check step for joint moves (deg)"),
            num("Collision_Clearance", "Clearance for collisions (mm)"),
          ],
        },
      ],
    },
    {
      title: "CAD",
      sections: [
        {
          title: "3D file import settings",
          fields: [
            {
              key: "ImportStepAction",
              label: "Action when importing a STEP file (object vs. assembly)",
              type: "select",
              options: opt(["0", "Ask"], ["1", "Load as one object"], ["2", "Load as assembly"]),
              hint: "Assembly: the file is divided into reference frames and objects the same way it was assembled. Part: the file is loaded as one single object.",
            },
          ],
        },
      ],
    },
    { title: "CAM", sections: [], note: "Enginuity has no global CAM options." },
    {
      title: "Program",
      sections: [
        { fields: [num("MoveL_Split_MM"), num("MAX_DECIMALS_POST"), num("ProgMaxLines"), bool("ProgMoveNames", "Pass target names to the post processor"), bool("ProgRecalc", "Recalculate joints of Cartesian targets before generating"), bool("Prog_InlineSubPrograms", "Inline called programs")] },
        {
          title: "Splitting and subprograms",
          fields: [
            num("MoveL_Split_MM_Min", "Minimum length of split linear segments (mm)"),
            num("Prog_InlineSubProgramDepth", "Maximum depth of inlined programs"),
          ],
        },
      ],
    },
    {
      title: "Python",
      sections: [{ fields: [{ key: "Path_PythonRun2", label: "Python interpreter", type: "text", placeholder: "python3", hint: "Runs Python programs and scripts; they connect to Enginuity through the Enginuity Python API (included)" }] }],
    },
    { title: "Drivers", sections: [], note: "Enginuity simulates robots: it has no robot drivers to configure." },
    { title: "Accuracy", sections: [], note: "Enginuity has no robot calibration, so there are no accuracy options." },
    {
      title: "Other",
      sections: [
        { fields: [bool("PlaceAtOrigin", "Place new robots at the origin"), num("PlaceSpacingMM", "Spacing between new robots (mm)"), bool("CopyPasteKeepLinks")] },
        { title: "Station tree", fields: [bool("TreeSizePercentSet", "Set tree size as a % of the screen"), num("TreeSizePercent", "Tree size (% of the screen)")] },
         
        { title: "Robot library", fields: [{ ...bool("RC_SHOW_LIBRARY_STATIONS"), hint: "Lists the robot library's example stations below Enginuity's examples" }] },
      ],
    },
    { title: "Station", sections: [], extra: "station" },
    { title: "Appearance", sections: [{ fields: [{ key: "RC_THEME", label: "Appearance", type: "select", options: opt(["light", "Light"], ["dark", "Dark"]) }, bool("RC_SHADOWS", "Soft shadows"), bool("RC_REFLECTIONS", "Floor reflections"), bool("RC_EE_VIEW", "End effector close-up")] }] },
     
    {
      title: "Physics",
      sections: [
        {
          title: "Rigid-body physics",
          fields: [
            { ...bool("RC_PHYSICS", "Physics"), hint: "Released parts fall, settle, stack and are pushed by robots. Off: objects stay where they are placed.", set: (v) => void cmd("physics.enable", { on: v === true }) },
            { ...num("RC_PHYSICS_GRAVITY", "Gravity (m/s²)"), set: (v) => void cmd("physics.configure", { gravity: Math.max(0, Number(v)) }) },
            { ...num("RC_PHYSICS_SUBSTEPS", "Solver substeps per 1/60 s frame"), hint: "More substeps: stiffer stacks and robot pushes, more CPU", set: (v) => void cmd("physics.configure", { substeps: Math.max(1, Math.min(16, Math.round(Number(v)))) }) },
          ],
        },
      ],
    },
    copilotTab(ui),
  ];
}

const shown = (f: Field, value: unknown) => (f.type === "secret" ? (value ? "••••" : "") : String(value ?? ""));

 
function FieldRow({ f, value, apply }: { f: Field; value: unknown; apply: (v: unknown) => void }) {
  const [text, setText] = useState(shown(f, value));
  const on = value === true || value === 1;
  const commit = () => {
    if (text === shown(f, value)) return;
    if (f.type !== "number") return apply(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) apply(n);
    else setText(shown(f, value));
  };
  return (
    <label style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 240px)", alignItems: "center", gap: 10 }}>
      <span>
        <div style={{ font: "600 12.5px var(--font-ui)" }}>{f.label}</div>
        {f.hint && <div style={{ color: "var(--ink-3)", font: "500 10.5px var(--font-ui)", marginTop: 2 }}>{f.hint}</div>}
      </span>
      {f.type === "boolean" ? (
        <button type="button" className="g-switch" role="switch" aria-checked={on} aria-label={f.label} data-on={String(on)} onClick={() => apply(!on)} style={{ justifySelf: "end" }} />
      ) : f.type === "select" ? (
        <select className="g-input" aria-label={f.label} value={String(value ?? "")} onChange={(e) => apply(e.target.value)}>
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={`g-input ${f.type === "number" ? "num" : ""}`}
          aria-label={f.label}
          type={f.type === "secret" ? "password" : "text"}
          placeholder={f.placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key !== "Escape") e.stopPropagation();
          }}
        />
      )}
    </label>
  );
}

 
function ShortcutEditor({ onDone }: { onDone: () => void }) {
  const settings = useRC((s) => s.settings);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const overrides = shortcutOverrides(settings);
  const save = (next: Record<string, string>) => void cmd("settings.set", { key: "Shortcuts", value: JSON.stringify(next) });
  const rows = useMemo(() => MAIN_ACTIONS.filter((a) => `${a.text} ${a.name}`.toLowerCase().includes(q.toLowerCase())), [q]);
  const assign = (name: string, keys: string) => {
    const other = keys ? MAIN_ACTIONS.find((a) => a.name !== name && effectiveShortcut(a, settings) === keys) : undefined;
    if (other) useRC.getState().toast({ kind: "info", title: "Customize shortcuts", body: `${prettyKeys(keys)} was used by ${other.text}; it now runs the new action only.` });
    save({ ...overrides, [name]: keys, ...(other ? { [other.name]: "" } : {}) });
    setEditing(null);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="g-input" placeholder="Filter actions" aria-label="Filter actions" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key !== "Escape" && e.stopPropagation()} />
        <button className="g-btn" onClick={() => save({})}>
          Reset
        </button>
        <button className="g-btn primary" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="g-scroll glass-inset" style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2, maxHeight: "48vh", overflow: "auto" }}>
        {rows.map((a) => {
          const sc = effectiveShortcut(a, settings);
          return (
            <div key={a.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 6px", borderRadius: 8, background: editing === a.name ? "var(--accent-soft)" : "transparent" }}>
              <span style={{ flex: 1, font: "500 12px var(--font-ui)" }}>{a.text}</span>
              <button
                className="g-btn ghost"
                style={{ height: 24, minWidth: 120, justifyContent: "flex-end" }}
                title="Click, then press the new shortcut (Delete removes it, Esc cancels)"
                onClick={() => setEditing(a.name)}
                onBlur={() => editing === a.name && setEditing(null)}
                onKeyDown={(e) => {
                  if (editing !== a.name) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === "Escape") return setEditing(null);
                  if (e.key === "Delete" || e.key === "Backspace") return assign(a.name, "");
                  const keys = eventKeys(e.nativeEvent);
                  if (keys) assign(a.name, keys);  
                }}
              >
                {editing === a.name ? <span style={{ color: "var(--accent-ink)" }}>Press keys…</span> : sc ? <span className="g-kbd">{prettyKeys(sc)}</span> : <span style={{ color: "var(--ink-3)" }}>None</span>}
                {overrides[a.name] !== undefined && (
                  <span style={{ color: "var(--accent-ink)", marginLeft: 4 }} title="Customized">
                    •
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SettingsDialog() {
  const open = useRC((s) => s.settingsOpen);
  return open ? <SettingsBody /> : null;
}

function SettingsBody() {
  const settings = useRC((s) => s.settings);
  const undoCount = useRC((s) => s.undo.undo.length);
  const ws = useRC((s) => s.ws);
  const view = useViewState();
   
  const [tab, setTab] = useState(() => peekOptionsTab() ?? "General");
  useEffect(() => clearOptionsTab(), []);
  const [shortcuts, setShortcuts] = useState(false);
  const [customProvider, setCustomProvider] = useState(false);
  const close = () => useRC.setState({ settingsOpen: false });
  const all = tabs(view, { customProvider, setCustomProvider });
  const current = all.find((t) => t.title === tab) ?? all[0];
  const apply = async (key: string, v: unknown) => {
    const message = await saveSettings({ [key]: v });
    if (message) useRC.getState().toast({ kind: "error", title: "Options", body: message });
  };
  const params = Object.entries(ws ? stationParams(ws) : {});
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 75, display: "grid", placeItems: "center", background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="glass glass-strong liquid rc-pop" role="dialog" aria-label="Options" style={{ width: 760, maxWidth: "calc(100vw - 32px)", height: "min(86vh, 760px)", borderRadius: 26, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 10px" }}>
          <Icon.Settings size={18} />
          <div style={{ font: "700 16px var(--font-ui)" }}>{shortcuts ? "Customize shortcuts" : "Options"}</div>
          <button className="g-btn icon ghost" style={{ marginLeft: "auto" }} onClick={close} aria-label="Close" title="Close">
            <Icon.Close />
          </button>
        </div>
        {!shortcuts && (
          <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: "0 14px 10px", borderBottom: "1px solid var(--hair)" }}>
            {all.map((t) => (
              <button key={t.title} role="tab" aria-selected={t.title === current.title} className={`g-btn ghost ${t.title === current.title ? "active" : ""}`} style={{ height: 26, padding: "0 9px" }} onClick={() => setTab(t.title)}>
                {t.title}
              </button>
            ))}
          </div>
        )}
        <div className="g-scroll" style={{ flex: 1, minHeight: 0, padding: 18, display: "grid", alignContent: "start", gap: 16, overflow: "auto" }}>
          {shortcuts ? (
            <ShortcutEditor onDone={() => setShortcuts(false)} />
          ) : (
            <>
              {current.note && <div style={{ font: "500 12.5px/1.5 var(--font-ui)", color: "var(--ink-1)" }}>{current.note}</div>}
              {current.top === "copilot" && <CopilotStatus />}
              {current.sections.map((sec, i) => (
                <section key={`${current.title}-${i}`}>
                  {sec.title && (
                    <div className="g-label" style={{ marginBottom: 8 }}>
                      {sec.title}
                    </div>
                  )}
                  <div className="glass-inset" style={{ padding: 12, display: "grid", gap: 10 }}>
                    {sec.fields.map((f) => {
                      const value = f.get ? f.get() : (settings[f.key] ?? DEFAULT_SETTINGS[f.key]);
                       
                      return <FieldRow key={`${f.key}=${String(value)}`} f={f} value={value} apply={(v) => (f.set ? f.set(v) : void apply(f.key, v))} />;
                    })}
                  </div>
                </section>
              ))}
              {current.extra === "undo" && (
                <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, font: "500 12.5px var(--font-ui)" }}>
                  <span>Available Undo actions: {undoCount}</span>
                  <button className="g-btn" onClick={() => void cmd("edit.clearUndo", {})}>
                    Clear Undo Stack
                  </button>
                  <button className="g-btn" onClick={() => void recoverBackupUI()}>
                    Recover Auto Backup
                  </button>
                </div>
              )}
              {current.extra === "station" && (
                <section>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
                    <div className="g-label">Station parameters</div>
                    <button className="g-btn" style={{ marginLeft: "auto" }} disabled={!ws?.activeStation} onClick={() => stationParamsUI(ws?.activeStation ?? undefined)}>
                      Station Parameters…
                    </button>
                  </div>
                  <div className="glass-inset" style={{ padding: 12, display: "grid", gap: 6, font: "500 12px var(--font-ui)" }}>
                    {params.length === 0 && <span style={{ color: "var(--ink-3)" }}>The active station has no parameters.</span>}
                    {params.map(([k, v]) => (
                      <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                        <span className="mono">{k}</span>
                        <span className="mono" style={{ color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {current.extra === "copilot" && <DecisionModelsSection />}
            </>
          )}
        </div>
        {!shortcuts && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--hair)" }}>
            <button className="g-btn" onClick={() => void cmd("settings.reset", {})}>
              Set default settings
            </button>
            <button className="g-btn" onClick={() => setShortcuts(true)}>
              Customize shortcuts
            </button>
            <button className="g-btn ghost" onClick={() => void runAction("actionHelp")}>
              <Icon.Help size={14} /> Help
            </button>
            <button className="g-btn primary" style={{ marginLeft: "auto", minWidth: 72 }} onClick={close}>
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
