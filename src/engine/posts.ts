// Resolves post-processor choices, filenames and missing-processor suggestions.
 
 
 

export interface PostInfo {
  name: string;
   
  kind: "builtin" | "user";
   
  base: string | null;
   
  author: "user" | "agent" | null;
   
  needsApproval: boolean;
   
  robots: number;
}

export interface PostSource {
  name: string;
  kind: "builtin" | "user";
   
  file: string;
  source: string;
   
  variables?: Record<string, string | number | boolean>;
  base: string | null;
  author: "user" | "agent" | null;
  needsApproval: boolean;
   
  hash: string | null;
}

export interface PostService {
   
  folder(): string;
  list(): Promise<PostInfo[]>;
  get(name: string): Promise<PostSource>;
   
  template(name: string, base: string): Promise<string>;
  save(name: string, source: string, author: "user" | "agent"): Promise<{ name: string; file: string; base: string | null; needsApproval: boolean; hash: string }>;
  remove(name: string): void;
  approve(name: string, hash: string): void;
   
  pick?(req: PostPick): Promise<string | null>;
   
  answerPick?(id: string, post: string | null): boolean;
   
  pendingPicks?(): { type: "post-pick"; id: string }[];
}

 
export interface PostPickItem {
   
  name: string;
   
  text: string;
   
  tooltip: string;
   
  valid: boolean;
}

 
export interface PostPick {
  title: string;
  label: string;
  robot: string;
  items: PostPickItem[];
   
  selected: number;
}













export function postPick(robotName: string, robotPost: string, posts: { name: string; path: string }[]): PostPick {
   
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  const sorted = [...posts].sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.name, b.name));
  const items = sorted.map((p): PostPickItem => {
    const text = p.name.replace(/_/g, " ");
    const file = p.name.replace(/ /g, "_");
    if (!/^[a-zA-Z0-9_]+$/.test(file)) return { name: p.name, text, valid: false, tooltip: "The post processor file name should only have alphanumeric characters or underscore characters" };
    if (/^[0-9]/.test(file)) return { name: p.name, text, valid: false, tooltip: "The post processor file name should not start with a number" };
    return { name: p.name, text, valid: true, tooltip: `Post processor file: ${p.path}` };
  });
  const want = robotPost.replace(/_/g, " ").toLowerCase();
  return {
    title: "Select one item",
    label: `Select a Post Processor for the robot ${robotName}`,
    robot: robotName,
    items,
    selected: want ? items.findIndex((i) => i.text.toLowerCase() === want) : -1,
  };
}

 
export function storedPostName(name: string): string {
  return name.replace(/ /g, "_").replace(/\.py$/, "");
}

 
export function postFileName(name: string): string {
  return name.replace(/[-`~!@#$%^&*()_?+=| :;<>,.?/{}'"[\]\\]/g, "_");
}



export const LIBRARY_DEFAULT_POSTS: Record<string, number> = {
  Post_Generic: 144, KUKA_KRC2: 143, Fanuc_RJ3: 113, ABB_RAPID_IRC5: 105, Motoman: 102, Kawasaki: 60, Comau_C5G: 57, Estun_RCS3: 50,
  Staubli_VAL3: 44, Mitsubishi: 43, Techman: 30, KUKA_KRC4: 28, Omron: 28, Precise: 28, Hyundai: 27, Epson_RC: 26, Siasun: 26,
  Nachi_AX_FD: 25, JAKA: 23, AUBO: 18, Doosan_Robotics: 18, Toshiba: 17, Leantec: 16, OTC: 14, Rokae: 13, Universal_Robots: 13,
  Denso_RC8: 12, GSK: 11, Hans: 11, Rokae_RL: 11, Dobot_V3: 9, Adept_Vplus: 8, Dobot_V4: 8, Kassow: 8, RainbowRobotics: 8,
  Robotphoenix: 8, Fanuc_R30i: 7, HIWIN_HRSS: 7, Comau_MyCo: 6, Elite_Robots_CS: 6, Elite_Robots_EC_V3: 6, KAIRO: 6, KEBA_KAIRO: 6,
  Neura: 6, Panasonic_G3_CSR: 6, QJAR: 6, Schneider: 6, Denso_RC9: 5, HCR: 5, IIMT: 5, Siemens_Sinumerik: 5, Borunte: 4, Dobot: 4,
  Flexiv: 4, KUKA_KRC5: 4, Kinova: 4, Yamaha: 4, xArm: 4, KEBA_Kairo: 3, KUKA_IIWA: 3, Mecademic: 3, Niryo: 3, Robostar: 3, Wlkata: 3,
  ABB_IRC5: 2, Annin_Robotics: 2, ESI: 2, Foxbot: 2, MyCobot: 2, AR: 1, AUBO_ARCS: 1, Agile_Robots: 1, Automata: 1, CLOOS: 1, CPR: 1,
  CRS: 1, Dobot_CR: 1, EFort: 1, Franka_Emika: 1, Gcode: 1, IGUS: 1, Inexbot: 1, Kinova_Link6: 1, MIP: 1, Mitsubishi_Movemaster_EX: 1,
  NEWKer_i6: 1, NRMK_to_py: 1, Productive_Robotics: 1, Turin: 1, uArm: 1, uFactory: 1,
};

 
export const POST_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;




export function nearestPosts(missing: string, available: string[], max = 3): string[] {
  const maker = (n: string) => n.split("_")[0].toLowerCase();
  const common = (a: string) => {
    let i = 0;
    while (i < a.length && i < missing.length && a[i].toLowerCase() === missing[i].toLowerCase()) i++;
    return i;
  };
  const lead = (s: string) => Number(/^\d+/.exec(s)?.[0] ?? NaN);
  const gap = (a: string) => Math.abs(lead(a.slice(common(a))) - lead(missing.slice(common(a)))) || Infinity;
  const same = available
    .filter((a) => a.toLowerCase() !== missing.toLowerCase() && maker(a) === maker(missing))
    .sort((a, b) => common(b) - common(a) || gap(a) - gap(b) || (LIBRARY_DEFAULT_POSTS[b] ?? 0) - (LIBRARY_DEFAULT_POSTS[a] ?? 0) || a.localeCompare(b));
  if (same.length) return same.slice(0, max);
  return available.includes("Post_Generic") ? ["Post_Generic"] : [];
}

 
export function missingPostMessage(missing: string, available: string[]): string {
  const near = nearestPosts(missing, available);
  const offer = near.length === 1 && near[0] === "Post_Generic" ? "Post_Generic (a generic program to adapt by hand)" : near.join(", ");
  return (
    `Enginuity does not include the post processor ${missing}.` +
    (near.length ? ` Nearest available: ${offer}.` : "") +
    " Choose another post processor for the robot, or customize one in Program ▸ Add/Edit Post Processor."
  );
}
