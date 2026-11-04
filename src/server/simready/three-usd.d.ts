 
declare module "three/examples/jsm/loaders/usd/USDCParser.js" {
  export class USDCParser {
    version: { major: number; minor: number; patch: number };
    tokens: string[];
    strings: number[];
    paths: string[];
    reader: { position: number; readUint8(): number; readUint32(): number; readUint64(): number; readFloat64(): number; readInt64(): number };
    parseData(buffer: ArrayBuffer): { specsByPath: Record<string, { specType: number; fields: Record<string, unknown> }> };
    _readScalarValue(type: number): unknown;
  }
}
