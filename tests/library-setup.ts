// Warns at test startup when no offline library mirror is available.
 
import { libraryMirrorNote } from "./library";

export default function setup() {
  const note = libraryMirrorNote();
  if (note) console.warn(`[library] ${note}`);
}
