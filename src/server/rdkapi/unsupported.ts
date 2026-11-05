// Consumes unsupported API requests and returns structured protocol errors.
 
 
 
 
 

import { ApiError } from "./bridge";
import type { WireReader } from "./codec";
import { COMMANDS, def } from "./context";

 
async function consume(r: WireReader, schema: string) {
  for (const f of schema) {
    if (f === "L") await r.line();
    else if (f === "I") await r.int();
    else if (f === "P") await r.handle();
    else if (f === "H") await r.pose();
    else if (f === "A") await r.array();
    else if (f === "M") await r.matrix();
    else if (f === "B") await r.bytes();
    else if (f === "X") await r.xyz();
    else if (f === "N") {
      const n = await r.int();
      for (let i = 0; i < n; i++) await r.handle();
    }
  }
}

 
const UNSUPPORTED: Record<string, [string, string]> = {
  Connect2: ["PLI", "I"],
  setConnectParams: ["PLILLL", ""],
  ConnectedState: ["P", "IL"],
  Disconnect: ["P", "I"],
   
   
   
  S_ValueMat: ["PLM", "M"],
  S_Gen_Str: ["PLL", ""],
  FilterProg2: ["PL", "IL"],
  Proj2d3d: ["II", "ITX"],
  MeasLT2: ["XI", "A"],
  MeasPose4: ["A", "HA"],
};

export const UNSUPPORTED_COMMANDS = Object.keys(UNSUPPORTED).filter((n) => !COMMANDS.has(n));

for (const [name, [req, resp]] of Object.entries(UNSUPPORTED)) {
  if (COMMANDS.has(name)) continue;
  def(name, `${resp}S`, async (c) => {
    await consume(c.r, req);
    throw new ApiError(3, `Enginuity does not support the API command ${name}`);
  });
}
