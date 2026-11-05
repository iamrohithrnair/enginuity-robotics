// Parses JavaScript literal values without evaluating source code.
 
 
 

export function parseJsLiteral(src: string, start: number): { value: unknown; end: number } {
  let i = start;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const fail = (msg: string): never => {
    throw new Error(`${msg} at ${i}: ${JSON.stringify(src.slice(i, i + 30))}`);
  };
  const parseString = (): string => {
    const q = src[i++];
    let out = "";
    while (i < src.length && src[i] !== q) {
      const c = src[i++];
      if (c === "\\") {
        const e = src[i++];
        if (e === "n") out += "\n";
        else if (e === "t") out += "\t";
        else if (e === "r") out += "\r";
        else if (e === "u") {
          out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16));
          i += 4;
        } else if (e === "x") {
          out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16));
          i += 2;
        } else out += e;
      } else out += c;
    }
    if (src[i] !== q) fail("unterminated string");
    i++;
    return out;
  };
  const parseValue = (): unknown => {
    ws();
    const c = src[i];
    if (c === "{") {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      if (src[i] === "}") {
        i++;
        return obj;
      }
      for (;;) {
        ws();
        let key: string;
        if (src[i] === '"' || src[i] === "'") key = parseString();
        else {
          const m = /^[A-Za-z_$0-9][\w$]*/.exec(src.slice(i, i + 200));
          if (!m) fail("bad key");
          key = m![0];
          i += key.length;
        }
        ws();
        if (src[i] !== ":") fail("expected :");
        i++;
        obj[key] = parseValue();
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "}") {
          i++;
          return obj;
        }
        fail("expected , or }");
      }
    }
    if (c === "[") {
      i++;
      const arr: unknown[] = [];
      ws();
      if (src[i] === "]") {
        i++;
        return arr;
      }
      for (;;) {
        arr.push(parseValue());
        ws();
        if (src[i] === ",") {
          i++;
          continue;
        }
        if (src[i] === "]") {
          i++;
          return arr;
        }
        fail("expected , or ]");
      }
    }
    if (c === '"' || c === "'") return parseString();
    if (src.startsWith("!0", i)) {
      i += 2;
      return true;
    }
    if (src.startsWith("!1", i)) {
      i += 2;
      return false;
    }
    for (const [lit, v] of [["true", true], ["false", false], ["null", null], ["void 0", undefined]] as const) {
      if (src.startsWith(lit, i)) {
        i += lit.length;
        return v;
      }
    }
    const m = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 40));
    if (m) {
      i += m[0].length;
      return Number(m[0]);
    }
    return fail("unexpected token");
  };
  const value = parseValue();
  return { value, end: i };
}

 
export function extractLiterals(src: string, name: string): unknown[] {
  const out: unknown[] = [];
  let from = 0;
  for (;;) {
    const k = src.indexOf(`${name}:`, from);
    if (k < 0) break;
    const start = k + name.length + 1;
    try {
      const { value, end } = parseJsLiteral(src, start);
      out.push(value);
      from = end;
    } catch {
      from = start;
    }
  }
  return out;
}
