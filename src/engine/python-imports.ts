// Rewrites Python module references while preserving source layout.
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 
 





const OLD_PKG = ["robo", "dk"].join("");
const OLD_PRODUCT = ["Robo", "DK"].join("");

 
const SUBMODULES: Record<string, string> = { robolink: "robolink", robomath: "robomath", robodialogs: "dialogs", robofileio: "fileio", robolinkutils: "utils" };
const PRELUDE = "enginuity.prelude";

 
const RENAMED: Record<string, string> = Object.fromEntries(["Show", "Hide", "Close", "setFlags", "getPath"].map((p) => [p + OLD_PRODUCT, p + "Enginuity"]));
const OLD_FLAG = `FLAG_${OLD_PRODUCT.toUpperCase()}_`;
 
const RENAMED_KWARGS: Record<string, string> = { [`${OLD_PKG}_ip`]: "ip", [`${OLD_PKG}_path`]: "app_path" };



export const isOriginalPackage = (module: string) => module === OLD_PKG;

const QUICK = new RegExp(`${OLD_PKG}|${OLD_PRODUCT}|${OLD_FLAG}|\\b(?:${Object.keys(SUBMODULES).join("|")})\\b`);

type Kind = "name" | "op" | "str" | "comment" | "nl" | "newline" | "num";
interface Tok {
  kind: Kind;
  s: number;
  e: number;
  text: string;
  depth: number;
  line: number;
}

const OPS3 = ["**=", "//=", ">>=", "<<=", "..."];
const OPS2 = ["==", "!=", "<=", ">=", "->", "**", "//", "<<", ">>", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=", ":="];
const STRING_PREFIX = /^(?:r|u|f|b|br|rb|fr|rf)$/i;
const isIdStart = (c: string) => /[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127;
const isIdChar = (c: string) => /\w/.test(c) || c.charCodeAt(0) > 127;

 
function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let depth = 0;
  let line = 1;
  let significant = false;  
  const push = (kind: Kind, s: number, e: number) => {
    toks.push({ kind, s, e, text: src.slice(s, e), depth, line });
    if (kind !== "comment" && kind !== "nl" && kind !== "newline") significant = true;
  };
  const countLines = (s: number, e: number) => {
    for (let k = s; k < e; k++) if (src[k] === "\n" || (src[k] === "\r" && src[k + 1] !== "\n")) line++;
  };
  const readString = (start: number, quoteAt: number) => {
    const q = src[quoteAt];
    const triple = src.startsWith(q.repeat(3), quoteAt);
    let k = quoteAt + (triple ? 3 : 1);
    while (k < src.length) {
      const c = src[k];
      if (c === "\\") {
        k += 2;
        continue;
      }
      if (triple ? src.startsWith(q.repeat(3), k) : c === q) {
        k += triple ? 3 : 1;
        break;
      }
      if (!triple && (c === "\n" || c === "\r")) break;  
      k++;
    }
    k = Math.min(k, src.length);
    push("str", start, k);
    countLines(start, k);
    i = k;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\f") {
      i++;
    } else if (c === "\\" && (src[i + 1] === "\n" || src[i + 1] === "\r")) {
      i += src.startsWith("\r\n", i + 1) ? 3 : 2;  
      line++;
    } else if (c === "\n" || c === "\r") {
      const len = src.startsWith("\r\n", i) ? 2 : 1;
      if (depth === 0 && significant) {
        push("newline", i, i + len);
        significant = false;
      } else push("nl", i, i + len);
      line++;
      i += len;
    } else if (c === "#") {
      let k = i;
      while (k < src.length && src[k] !== "\n" && src[k] !== "\r") k++;
      push("comment", i, k);
      i = k;
    } else if (c === "'" || c === '"') {
      readString(i, i);
    } else if (isIdStart(c)) {
      let k = i + 1;
      while (k < src.length && isIdChar(src[k])) k++;
      if ((src[k] === "'" || src[k] === '"') && STRING_PREFIX.test(src.slice(i, k))) readString(i, k);
      else {
        push("name", i, k);
        i = k;
      }
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let k = i + 1;
      while (k < src.length && (/[\w.]/.test(src[k]) || ((src[k] === "+" || src[k] === "-") && /[eE]/.test(src[k - 1]) && !/^0[xX]/.test(src.slice(i, k))))) k++;
      push("num", i, k);
      i = k;
    } else {
      const op = OPS3.find((o) => src.startsWith(o, i)) ?? OPS2.find((o) => src.startsWith(o, i)) ?? c;
      if (op === "(" || op === "[" || op === "{") {
        push("op", i, i + 1);
        depth++;
      } else if (op === ")" || op === "]" || op === "}") {
        depth = Math.max(0, depth - 1);
        push("op", i, i + 1);
      } else push("op", i, i + op.length);
      i += op.length;
    }
  }
  return toks;
}

const COMPOUND = new Set(["if", "elif", "else", "try", "except", "finally", "for", "while", "with", "def", "class", "async"]);

 
function statements(toks: Tok[]): Tok[][] {
  const out: Tok[][] = [];
  let lineToks: Tok[] = [];
  const flush = () => {
    if (!lineToks.length) return;
    let cur: Tok[] = [];
    let headerOpen = lineToks[0].kind === "name" && COMPOUND.has(lineToks[0].text);
    for (const t of lineToks) {
      if (t.kind === "op" && t.text === ";" && t.depth === lineToks[0].depth) {
        out.push(cur);
        cur = [];
      } else if (headerOpen && t.kind === "op" && t.text === ":" && t.depth === lineToks[0].depth) {
         
        headerOpen = false;
        out.push(cur);
        cur = [];
      } else cur.push(t);
    }
    out.push(cur);
    lineToks = [];
  };
  for (const t of toks) {
    if (t.kind === "newline") flush();
    else if (t.kind !== "comment" && t.kind !== "nl") lineToks.push(t);
  }
  flush();
  return out.filter((s) => s.length);
}

 
function mapModule(parts: string[]): string | null {
  if (parts[0] === OLD_PKG) return parts.length === 1 ? "PKG" : ["enginuity", SUBMODULES[parts[1]] ?? parts[1], ...parts.slice(2)].join(".");
  if (parts[0] in SUBMODULES) return ["enginuity", SUBMODULES[parts[0]], ...parts.slice(1)].join(".");
  return null;
}

interface Edit {
  s: number;
  e: number;
  text: string;
}

 
function dotted(st: Tok[], k: number): { parts: string[]; next: number } | null {
  if (st[k]?.kind !== "name") return null;
  const parts = [st[k].text];
  let j = k + 1;
  while (st[j]?.text === "." && st[j + 1]?.kind === "name") {
    parts.push(st[j + 1].text);
    j += 2;
  }
  return { parts, next: j };
}

 
function sameLines(original: string, text: string): string {
  const breaks = original.match(/\r\n|\r|\n/g) ?? [];
  return text + breaks.map((b) => ` \\${b}`).join("");
}

 
function rewriteFrom(st: Tok[], src: string, edits: Edit[]): void {
  if (st[1]?.kind !== "name") return;  
  const mod = dotted(st, 1);
  if (!mod || st[mod.next]?.text !== "import") return;
  const target = mapModule(mod.parts);
  if (!target) return;
  const modSpan = { s: st[1].s, e: st[mod.next - 1].e };
  const rest = st.slice(mod.next + 1);
  if (target !== "PKG") {
    edits.push({ ...modSpan, text: sameLines(src.slice(modSpan.s, modSpan.e), target) });
    return;
  }
  if (rest.length === 1 && rest[0].text === "*") {
    edits.push({ ...modSpan, text: PRELUDE });
    return;
  }
   
  const names: { tok: Tok; aliased: boolean }[] = [];
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k];
    if (t.kind !== "name") continue;
    if (t.text === "as") {
      k++;
      continue;
    }
    names.push({ tok: t, aliased: rest[k + 1]?.text === "as" });
  }
  if (names.length && names.every((n) => n.tok.text in SUBMODULES)) {
    edits.push({ ...modSpan, text: "enginuity" });
    for (const n of names) {
      const sub = SUBMODULES[n.tok.text];
      if (sub !== n.tok.text) edits.push({ s: n.tok.s, e: n.tok.e, text: n.aliased ? sub : `${sub} as ${n.tok.text}` });
    }
  } else edits.push({ ...modSpan, text: PRELUDE });
}

 
function rewriteImport(st: Tok[], src: string, edits: Edit[]): boolean {
  interface Clause {
    parts: string[];
    alias: string | null;
  }
  const clauses: Clause[] = [];
  let k = 1;
  while (k < st.length) {
    const d = dotted(st, k);
    if (!d) return false;  
    let alias: string | null = null;
    k = d.next;
    if (st[k]?.text === "as" && st[k + 1]?.kind === "name") {
      alias = st[k + 1].text;
      k += 2;
    }
    clauses.push({ parts: d.parts, alias });
    if (st[k]?.text === ",") k++;
    else if (k < st.length) return false;
  }
  if (!clauses.some((c) => mapModule(c.parts))) return false;
  let binds = false;
  const out: string[] = [];
  let plain: string[] = [];
  const flushPlain = () => {
    if (plain.length) out.push(`import ${plain.join(", ")}`);
    plain = [];
  };
  for (const c of clauses) {
    const target = mapModule(c.parts);
    if (!target) {
      plain.push(c.parts.join(".") + (c.alias ? ` as ${c.alias}` : ""));
      continue;
    }
    flushPlain();
    if (c.parts[0] === OLD_PKG) {
      const mod = target === "PKG" ? PRELUDE : target;
      if (c.alias) out.push(`import ${mod} as ${c.alias}`);
      else {
         
        if (!binds) out.push(`import ${PRELUDE}`);
        binds = true;
      }
    } else {
      const sub = SUBMODULES[c.parts[0]];
      if (c.alias && c.parts.length > 1) out.push(`import ${target} as ${c.alias}`);
      else {
        const name = c.alias ?? c.parts[0];
        out.push(`from enginuity import ${sub}${name !== sub ? ` as ${name}` : ""}`);
      }
    }
  }
  flushPlain();
  const s = st[0].s;
  const e = st[st.length - 1].e;
  edits.push({ s, e, text: sameLines(src.slice(s, e), out.join("; ")) });
  return binds;
}





export function rewritePythonImports(code: string): string {
  if (!code || !QUICK.test(code)) return code;
  const toks = tokenize(code);
  const edits: Edit[] = [];
  const inImport = new Set<Tok>();
  let binds = false;
  for (const st of statements(toks)) {
    const head = st[0];
    if (head.kind !== "name" || (head.text !== "import" && head.text !== "from")) continue;
    for (const t of st) inImport.add(t);
    if (head.text === "from") rewriteFrom(st, code, edits);
    else binds = rewriteImport(st, code, edits) || binds;
  }
  const sig = toks.filter((t) => t.kind !== "comment" && t.kind !== "nl" && t.kind !== "newline");
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    if (t.kind !== "name") continue;
    const prev = sig[k - 1];
    const next = sig[k + 1];
    if (t.text in RENAMED) edits.push({ s: t.s, e: t.e, text: RENAMED[t.text] });
    else if (t.text.startsWith(OLD_FLAG)) edits.push({ s: t.s, e: t.e, text: "FLAG_ENGINUITY_" + t.text.slice(OLD_FLAG.length) });
    else if (t.text in RENAMED_KWARGS && next?.text === "=" && t.depth > 0 && (prev?.text === "(" || prev?.text === ",")) edits.push({ s: t.s, e: t.e, text: RENAMED_KWARGS[t.text] });
    else if (binds && t.text === OLD_PKG && !inImport.has(t) && prev?.text !== ".") {
       
      const attr = sig[k + 2];
      if (next?.text === "." && attr?.kind === "name" && attr.line === t.line && attr.text in SUBMODULES) {
        edits.push({ s: t.s, e: attr.e, text: `enginuity.${SUBMODULES[attr.text]}` });
        k += 2;
      } else edits.push({ s: t.s, e: t.e, text: PRELUDE });
    }
  }
  if (!edits.length) return code;
  edits.sort((a, b) => a.s - b.s);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    if (ed.s < at) continue;  
    out += code.slice(at, ed.s) + ed.text;
    at = ed.e;
  }
  return out + code.slice(at);
}
