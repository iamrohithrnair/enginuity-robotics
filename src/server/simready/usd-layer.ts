// Parses text and binary USD layers into prims, properties and composition arcs.
 
 
 

import { USDCParser } from "three/examples/jsm/loaders/usd/USDCParser.js";

 
export interface Arc {
  assetPath: string;
  primPath?: string;
}
export interface PropSpec {
  type?: string;
  value?: unknown;
   
  targets?: string[];
  meta?: Record<string, unknown>;
}
export interface PrimSpec {
  specifier: "def" | "over" | "class";
  typeName?: string;
   
  meta: Record<string, unknown>;
  props: Map<string, PropSpec>;
  children: Map<string, PrimSpec>;
   
  variantSets: Map<string, Map<string, PrimSpec>>;
}
export interface Layer {
   
  path: string;
  meta: Record<string, unknown>;
  root: PrimSpec;
}

export const newPrim = (specifier: PrimSpec["specifier"] = "over", typeName?: string): PrimSpec => ({ specifier, typeName, meta: {}, props: new Map(), children: new Map(), variantSets: new Map() });

 
export function primAt(layer: Layer, path: string): PrimSpec | undefined {
  let p: PrimSpec | undefined = layer.root;
  for (const name of path.split("/").filter(Boolean)) if (!(p = p.children.get(name))) return undefined;
  return p;
}

 

interface Tok {
  t: "id" | "num" | "str" | "asset" | "path" | "p";
  v: string;
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s+|#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|@@@[\s\S]*?@@@|@[^@\n]*@|<[^>\n]*>|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|-?inf\b|nan\b|[A-Za-z_][\w:.]*|\[\]|[()[\]{}=,;:&]/gy;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while (re.lastIndex < text.length && (m = re.exec(text))) {
    const s = m[0];
    const c = s[0];
    if (c === " " || c === "\n" || c === "\t" || c === "\r" || c === "#") continue;
    if (c === '"' || c === "'") out.push({ t: "str", v: s.startsWith('"""') || s.startsWith("'''") ? s.slice(3, -3) : s.slice(1, -1).replace(/\\(.)/g, "$1") });
    else if (c === "@") out.push({ t: "asset", v: s.startsWith("@@@") ? s.slice(3, -3) : s.slice(1, -1) });
    else if (c === "<") out.push({ t: "path", v: s.slice(1, -1) });
    else if (/[\d.+-]/.test(c) && s !== "-inf" && s !== "-" && /\d/.test(s)) out.push({ t: "num", v: s });
    else if (/[A-Za-z_]/.test(c) || s === "-inf") out.push({ t: "id", v: s });
    else out.push({ t: "p", v: s });
  }
  if (re.lastIndex < text.length) throw new Error(`USDA: unexpected character at ${re.lastIndex}: ${JSON.stringify(text.slice(re.lastIndex, re.lastIndex + 20))}`);
  return out;
}

const LISTOPS = new Set(["prepend", "append", "add", "delete", "reorder"]);
const MODIFIERS = new Set(["custom", "uniform", "varying", "config"]);

 
export function parseUSDA(text: string, path: string): Layer {
  if (!/^#usda\s/.test(text)) throw new Error(`${path}: not a USDA layer`);
  const tok = tokenize(text.replace(/^#usda[^\n]*/, ""));
  let i = 0;
  const peek = (o = 0) => tok[i + o];
  const is = (v: string, o = 0) => tok[i + o]?.v === v && tok[i + o].t !== "str";
  const expect = (v: string) => {
    if (!is(v)) throw new Error(`${path}: expected '${v}' near token ${i} (${tok[i]?.v})`);
    i++;
  };
  const value = (): unknown => {
    const t = tok[i++];
    if (!t) throw new Error(`${path}: unexpected end`);
    if (t.t === "num") return Number(t.v);
    if (t.t === "str") return t.v;
    if (t.t === "path") return { path: t.v };
    if (t.t === "asset") {
      const a: Arc = { assetPath: t.v };
      if (peek()?.t === "path") a.primPath = tok[i++].v;
      if (is("(")) skipGroup();
      return a;
    }
    if (t.t === "id") {
      if (t.v === "None") return null;
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "inf" || t.v === "-inf" || t.v === "nan") return t.v === "inf" ? Infinity : t.v === "-inf" ? -Infinity : NaN;
      return t.v;
    }
    if (t.v === "[" || t.v === "(") {
      const close = t.v === "[" ? "]" : ")";
      const arr: unknown[] = [];
      while (!is(close)) {
         
        if (peek()?.t === "path" && close === "]") {
          arr.push({ assetPath: "", primPath: tok[i++].v } as Arc);
          if (is("(")) skipGroup();
        } else arr.push(value());
        if (is(",")) i++;
      }
      i++;
      return arr;
    }
    if (t.v === "{") return dict();
    if (t.v === "[]") return [];
    throw new Error(`${path}: unexpected '${t.v}'`);
  };
  const skipGroup = () => {
     
    let depth = 0;
    do {
      const v = tok[i++]?.v;
      if (v === "(" || v === "[" || v === "{") depth++;
      else if (v === ")" || v === "]" || v === "}") depth--;
    } while (depth > 0 && i < tok.length);
  };
   
  const dict = (): Record<string, unknown> => {
    const d: Record<string, unknown> = {};
    while (!is("}")) {
      if (peek().t === "num") {
        const k = tok[i++].v;
        expect(":");
        d[k] = value();
      } else {
        i++;  
        if (is("[]")) i++;
        const key = tok[i++].v;
        expect("=");
        d[key] = value();
      }
      if (is(",")) i++;
    }
    i++;
    return d;
  };
   
  const meta = (into: Record<string, unknown>) => {
    while (!is(")")) {
      if (peek().t === "str") {
        into.doc = tok[i++].v;
        continue;
      }
      let op = "";
      if (LISTOPS.has(peek().v) && peek(1)?.t === "id" && !is("=", 1)) op = tok[i++].v;
      const key = tok[i++].v;
      if (!is("=")) continue;
      i++;
      let v = value();
      if (op === "delete" || op === "reorder") continue;
      if (key === "variants") {
        into.variantSelection = { ...(into.variantSelection as object), ...(v as object) };
        continue;
      }
      const arcs = key === "references" || key === "payload" || key === "inherits" || key === "specializes" || key === "subLayers";
      if (arcs) v = asList(v).map((x) => (x && typeof x === "object" && "path" in x ? { assetPath: "", primPath: (x as { path: string }).path } : x));
      if ((arcs || key === "apiSchemas" || key === "variantSets") && (op === "prepend" || op === "append" || op === "add") && Array.isArray(into[key])) into[key] = op === "prepend" ? [...asList(v), ...(into[key] as unknown[])] : [...(into[key] as unknown[]), ...asList(v)];
      else into[key] = v;
    }
    i++;
  };
  const asList = (v: unknown): unknown[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);
  const prim = (parent: PrimSpec) => {
    const specifier = tok[i++].v as PrimSpec["specifier"];
    let typeName: string | undefined;
    if (peek().t === "id") typeName = tok[i++].v;
    const name = tok[i++].v;
    const p = parent.children.get(name) ?? newPrim(specifier, typeName);
    p.specifier = specifier;
    if (typeName) p.typeName = typeName;
    parent.children.set(name, p);
    if (is("(")) {
      i++;
      meta(p.meta);
    }
    expect("{");
    body(p);
  };
   
  const body = (p: PrimSpec) => {
    while (!is("}")) {
      const t = peek();
      if (t.t === "id" && (t.v === "def" || t.v === "over" || t.v === "class") && (peek(1)?.t === "str" || (peek(1)?.t === "id" && peek(2)?.t === "str"))) prim(p);
      else if (t.v === "variantSet" && peek(1)?.t === "str") {
        i++;
        const set = tok[i++].v;
        expect("=");
        expect("{");
        const vs = p.variantSets.get(set) ?? new Map<string, PrimSpec>();
        p.variantSets.set(set, vs);
        while (!is("}")) {
          const vname = tok[i++].v;
          const v = vs.get(vname) ?? newPrim("over");
          vs.set(vname, v);
          if (is("(")) {
            i++;
            meta(v.meta);
          }
          expect("{");
          body(v);
        }
        i++;
      } else if (t.v === ";" || t.v === ",") i++;
      else property(p);
    }
    i++;
  };
  const property = (p: PrimSpec) => {
    let op = "";
    while (peek().t === "id" && (MODIFIERS.has(peek().v) || LISTOPS.has(peek().v)) && peek(1)?.t === "id") {
      if (LISTOPS.has(peek().v)) op = peek().v;
      i++;
    }
    if (op === "reorder" && (is("nameChildren") || is("properties"))) {
      i++;
      expect("=");
      value();
      return;
    }
    let type = tok[i++].v;
    if (is("[]")) {
      type += "[]";
      i++;
    }
    let name = tok[i++].v;
    let kind = "default";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && /^(connect|timeSamples|spline)$/.test(name.slice(dot + 1))) {
      kind = name.slice(dot + 1);
      name = name.slice(0, dot);
    }
    const prop = p.props.get(name) ?? { type };
    prop.type = type;
    p.props.set(name, prop);
    if (is("=")) {
      i++;
      let v = value();
       
      if (/^quat/.test(type) && Array.isArray(v)) {
        const q = (a: unknown[]) => (a.length === 4 && typeof a[0] === "number" ? [a[1], a[2], a[3], a[0]] : a);
        v = Array.isArray(v[0]) ? v.map((a) => q(a as unknown[])) : q(v);
      }
      if (op !== "delete") {
        if (type === "rel" || kind === "connect") {
          const list = (Array.isArray(v) ? v : [v]).map((x) => (x && typeof x === "object" && "path" in x ? (x as { path: string }).path : (x as Arc)?.primPath)).filter((x): x is string => typeof x === "string");
          prop.targets = op === "append" || op === "add" ? [...(prop.targets ?? []), ...list] : op === "prepend" ? [...list, ...(prop.targets ?? [])] : list;
        } else if (kind === "timeSamples") {
          const keys = Object.keys(v as object).sort((a, b) => Number(a) - Number(b));
          if (prop.value === undefined && keys.length) prop.value = (v as Record<string, unknown>)[keys[0]];
        } else if (kind === "default") prop.value = v;
      }
    }
    if (is("(")) {
      i++;
      meta((prop.meta ??= {}));
    }
  };
  const layer: Layer = { path, meta: {}, root: newPrim("def") };
  if (is("(")) {
    i++;
    meta(layer.meta);
  }
  while (i < tok.length) {
    if (is("def") || is("over") || is("class")) prim(layer.root);
    else i++;
  }
  return layer;
}

 

 
const T_TOKEN_LISTOP = 32, T_STRING_LISTOP = 33, T_REFERENCE_LISTOP = 35, T_PAYLOAD = 47, T_STRING_VECTOR = 50, T_PAYLOAD_LISTOP = 55, T_LAYER_OFFSET_VECTOR = 49;

class CrateParser extends USDCParser {
  _readScalarValue(type: number): unknown {
    const r = this.reader;
    const str = () => this.tokens[this.strings[r.readUint32()]] ?? "";
    const tokenAt = () => this.tokens[r.readUint32()] ?? "";
    const payload = (): Arc => {
      const assetPath = str();
      const primPath = this.paths[r.readUint32()];
      if (this.version.major > 0 || this.version.minor >= 8) r.position += 16;  
      return { assetPath, primPath: primPath && primPath !== "/" ? primPath : undefined };
    };
    const reference = (): Arc => {
      const assetPath = str();
      const primPath = this.paths[r.readUint32()];
      r.position += 16;  
      const n = r.readUint64();  
      r.position += n * 12;
      return { assetPath, primPath: primPath && primPath !== "/" ? primPath : undefined };
    };
     
    const listOp = <T>(item: () => T): T[] => {
      const flags = r.readUint8();
      const vec = () => {
        const n = r.readUint64();
        const out: T[] = [];
        for (let k = 0; k < n; k++) out.push(item());
        return out;
      };
      const explicit = flags & 0x02 ? vec() : [];
      const added = flags & 0x04 ? vec() : [];
      const prepended = flags & 0x20 ? vec() : [];
      const appended = flags & 0x40 ? vec() : [];
      return [...prepended, ...explicit, ...added, ...appended];
    };
    switch (type) {
      case T_REFERENCE_LISTOP:
        return listOp(reference);
      case T_PAYLOAD_LISTOP:
        return listOp(payload);
      case T_PAYLOAD:
        return [payload()];
      case T_TOKEN_LISTOP:
        return listOp(tokenAt);
      case T_STRING_LISTOP:
        return listOp(str);
      case T_STRING_VECTOR: {
        const n = r.readUint64();
        const out: string[] = [];
        for (let k = 0; k < n; k++) out.push(str());
        return out;
      }
      case T_LAYER_OFFSET_VECTOR:
        return null;
      default:
        return super._readScalarValue(type);
    }
  }
}

const SPEC_ATTRIBUTE = 1, SPEC_PRIM = 6, SPEC_RELATIONSHIP = 8, SPEC_PSEUDOROOT = 7;
const SPECIFIERS: PrimSpec["specifier"][] = ["def", "over", "class"];
const PRIM_SKIP = new Set(["primChildren", "properties", "specifier", "typeName", "variantSetChildren", "variantChildren"]);

 
export function parseUSDC(bytes: Uint8Array, path: string): Layer {
  const buf = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? (bytes.buffer as ArrayBuffer) : (bytes.slice().buffer as ArrayBuffer);
  const warn = console.warn;
  console.warn = () => {};  
  let specs: Record<string, { specType: number; fields: Record<string, unknown> }>;
  try {
    specs = new CrateParser().parseData(buf).specsByPath;
  } finally {
    console.warn = warn;
  }
  const layer: Layer = { path, meta: {}, root: newPrim("def") };
   
  const at = (primPath: string): PrimSpec => {
    let p = layer.root;
    for (const seg of primPath.split("/").filter(Boolean)) {
      const m = /^\{([^=]*)=([^}]*)\}$/.exec(seg);
      if (m) {
        const vs = p.variantSets.get(m[1]) ?? new Map<string, PrimSpec>();
        p.variantSets.set(m[1], vs);
        if (!m[2]) continue;
        let v = vs.get(m[2]);
        if (!v) vs.set(m[2], (v = newPrim("over")));
        p = v;
      } else {
        let c = p.children.get(seg);
        if (!c) p.children.set(seg, (c = newPrim("over")));
        p = c;
      }
    }
    return p;
  };
  const paths = Object.keys(specs);
   
  for (const sp of paths) {
    const { specType, fields } = specs[sp];
    if (sp.includes("[")) continue;
    if (specType === SPEC_PSEUDOROOT || sp === "/") {
      Object.assign(layer.meta, fields);
      continue;
    }
    if (specType !== SPEC_PRIM) continue;
    const p = at(sp);
    p.specifier = SPECIFIERS[fields.specifier as number] ?? "over";
    if (fields.typeName) p.typeName = fields.typeName as string;
    for (const k in fields) if (!PRIM_SKIP.has(k) && fields[k] !== null && fields[k] !== undefined) p.meta[k === "inheritPaths" ? "inherits" : k] = fields[k];
    if (Array.isArray(p.meta.inherits)) p.meta.inherits = (p.meta.inherits as string[]).map((x) => ({ assetPath: "", primPath: x }));
  }
  for (const sp of paths) {
    const { specType, fields } = specs[sp];
    if ((specType !== SPEC_ATTRIBUTE && specType !== SPEC_RELATIONSHIP) || sp.includes("[")) continue;
    const slash = sp.lastIndexOf("/");
    const dot = sp.indexOf(".", slash);
    if (dot < 0) continue;
    const p = at(sp.slice(0, dot));
    const prop: PropSpec = { type: specType === SPEC_RELATIONSHIP ? "rel" : (fields.typeName as string) };
    let v = fields.default;
    if (v === undefined && fields.timeSamples) v = (fields.timeSamples as { values?: unknown[] }).values?.[0];
    if (v !== undefined && v !== null) prop.value = v;
    const targets = (fields.targetPaths ?? fields.connectionPaths) as string[] | null | undefined;
    if (targets?.length) prop.targets = targets;
    const meta: Record<string, unknown> = {};
    for (const k of ["interpolation", "elementSize"]) if (fields[k] !== undefined) meta[k] = fields[k];
    if (Object.keys(meta).length) prop.meta = meta;
    p.props.set(sp.slice(dot + 1), prop);
  }
   
  const reorder = (sp: string, p: PrimSpec) => {
    const order = specs[sp]?.fields.primChildren as string[] | undefined;
    if (order?.length && order.every((n) => p.children.has(n))) p.children = new Map(order.map((n) => [n, p.children.get(n)!]));
    for (const [n, c] of p.children) reorder(sp === "/" ? `/${n}` : `${sp}/${n}`, c);
  };
  reorder("/", layer.root);
  return layer;
}

 
export function parseLayer(bytes: Uint8Array, path: string): Layer {
  const head = new TextDecoder().decode(bytes.subarray(0, 8));
  if (head === "PXR-USDC") return parseUSDC(bytes, path);
  if (head.startsWith("#usda")) return parseUSDA(new TextDecoder().decode(bytes), path);
  throw new Error(`${path}: not a USD layer (${/^PK/.test(head) ? "USDZ archives are not supported" : "unknown format"})`);
}
