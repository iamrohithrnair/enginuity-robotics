// Normalizes station filenames and recognizes supported station extensions.
 
 
 
 

 
export const STATION_FILE_EXT = ".mech";
 
export const LEGACY_STATION_FILE_EXT = ".rcstation.json";

const STATION_FILE_RE = /\.(mech|rcstation\.json)$/i;

 
export function isStationFile(nameOrPath: string): boolean {
  return STATION_FILE_RE.test(nameOrPath);
}

 
export function isLegacyStationFile(nameOrPath: string): boolean {
  return /\.rcstation\.json$/i.test(nameOrPath);
}

 
export function stationFileBase(nameOrPath: string): string {
  return nameOrPath.replace(/^.*[\\/]/, "").replace(STATION_FILE_RE, "");
}

 
export function stationFileName(name: string): string {
  return `${name}${STATION_FILE_EXT}`;
}

 
export function toStationFilePath(p: string): string {
  return isLegacyStationFile(p) ? p.replace(/\.rcstation\.json$/i, STATION_FILE_EXT) : p;
}
