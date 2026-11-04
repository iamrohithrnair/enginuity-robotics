 
 
 
 

import { AmbientLight, Box3, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface Payload {
  format: string;
  version: number;
  title: string;
  geometries: string[];
  bodies: { name: string; meshes: { g: number; color: [number, number, number, number] }[] }[];
  times: [number, number][];
  poses: string;
}

const $ = (id: string) => document.getElementById(id)!;

function bytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function fail(text: string) {
  const e = $("mb-error");
  e.textContent = text;
  e.style.display = "flex";
}

function start() {
  let p: Payload;
  try {
    p = JSON.parse($("mb-sim").textContent ?? "");
  } catch {
    return fail("This file holds no simulation.");
  }
  if (p.format !== "enginuity-sim") return fail("Unknown simulation format.");

  const host = $("mb-view");
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.appendChild(renderer.domElement);
  const scene = new Scene();
   
  const camera = new PerspectiveCamera(30, 1, 5, 200000);
  camera.up.set(0, 0, 1);
  scene.add(new HemisphereLight(0xffffff, 0xd8dade, 1.4), new AmbientLight(0xffffff, 0.35));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(1, -1.4, 2.2);
  scene.add(key);

  const geoms = p.geometries.map((g) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(bytes(g)), 3));
    geo.computeVertexNormals();
    return geo;
  });
  const bodies = p.bodies.map((b) => {
    const grp = new Group();
    grp.matrixAutoUpdate = false;
    for (const m of b.meshes) {
      const [r, g, bl, a] = m.color;
      const mat = new MeshStandardMaterial({ color: new Color(r, g, bl), roughness: 0.55, metalness: 0.08, side: DoubleSide, transparent: a < 1, opacity: a });
      grp.add(new Mesh(geoms[m.g], mat));
    }
    scene.add(grp);
    return grp;
  });

  const poses = new Float32Array(bytes(p.poses));
  const n = p.bodies.length;
  const times = p.times;
  const duration = times.length ? times[times.length - 1][0] : 0;
  const m4 = new Matrix4();
  const show = (s: number) => {
    bodies.forEach((g, b) => {
      const o = (s * n + b) * 12;
      const v = poses.subarray(o, o + 12);
      if (Number.isNaN(v[0])) {
        g.visible = false;
        return;
      }
      g.visible = true;
      m4.set(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], v[10], v[11], 0, 0, 0, 1);
      g.matrix.copy(m4);
      g.matrixWorldNeedsUpdate = true;
    });
  };

   
  show(0);
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const center = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  const radius = box.isEmpty() ? 1000 : Math.max(200, box.getSize(new Vector3()).length() / 2);
  const dist = radius / Math.sin((camera.fov * Math.PI) / 360);
  camera.position.copy(center).add(new Vector3(1, -1, 0.8).normalize().multiplyScalar(dist));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableDamping = true;
  controls.update();

  const resize = () => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

   
  const play = $("mb-play") as HTMLButtonElement;
  const seek = $("mb-seek") as HTMLInputElement;
  const label = $("mb-time");
  let playing = times.length > 1;
  let t = 0;
  let last = performance.now();
  let sample = 0;
  const sampleAt = (time: number) => {
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid][0] <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const sync = () => {
    play.textContent = playing ? "Pause" : "Play";
    seek.value = String(duration > 0 ? Math.round((t / duration) * 1000) : 0);
    const sim = times[sample]?.[1] ?? 0;
    label.textContent = `${t.toFixed(1)} s / ${duration.toFixed(1)} s · simulated ${sim.toFixed(1)} s`;
  };
  play.onclick = () => {
    playing = !playing;
    if (playing && t >= duration) t = 0;
    sync();
  };
  seek.oninput = () => {
    t = (Number(seek.value) / 1000) * duration;
    sample = sampleAt(t);
    show(sample);
    sync();
  };
  const frame = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    if (playing && duration > 0) {
      t += dt;
      if (t > duration) t = 0;
      const s = sampleAt(t);
      if (s !== sample) {
        sample = s;
        show(sample);
      }
      sync();
    }
    controls.update();
    renderer.render(scene, camera);
    (window as unknown as { __mbSim?: object }).__mbSim = { samples: times.length, bodies: n, sample, playing };
    requestAnimationFrame(frame);
  };
  sync();
  requestAnimationFrame(frame);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
