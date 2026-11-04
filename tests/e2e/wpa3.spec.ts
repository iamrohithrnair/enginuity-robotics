 
 
 
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function command(request: APIRequestContext, name: string, params: Record<string, unknown> = {}) {
  const r = await request.post("/api/command", { data: { name, params } });
  const j = await r.json();
  if (!j.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
}
type WS = { activeStation: string | null; view?: { cinema?: boolean }; items: Record<string, { name: string; params?: Record<string, string> }> };
const ws = async (request: APIRequestContext) => ((await (await request.get("/api/state")).json()) as { ws: WS }).ws;

let station = "";
test.beforeEach(async ({ request }) => {
  station = (await command(request, "station.new", { name: `WP-A3 e2e ${Date.now()}` })).id;
});
test.afterEach(async ({ request }) => {
  if (station) await command(request, "station.close", { station, ifUnsaved: "discard" }).catch(() => undefined);
});

async function open(page: Page) {
  await page.goto("/");
   
   
  await page.addStyleTag({ content: '[style*="var(--scrim)"]{display:none!important}' });
  await expect(page.getByRole("complementary", { name: "Station tree" })).toBeVisible();
}

test("B-FILE-08: Export Simulation records, saves one self-contained HTML file and plays it offline", async ({ page, request }, info) => {
  const box = await command(request, "object.addShape", { shape: "box", name: "Crate", sizeX: 200, sizeY: 200, sizeZ: 200 });
  await open(page);
  await page.mouse.click(800, 520);
  await page.keyboard.press(`${mod}+e`);
  const dlg = page.getByRole("dialog", { name: "Export simulation" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("status", { name: "Recording state" })).toHaveText("Press START to record");
  await expect(dlg.getByText("Custom simulation")).toBeVisible();
  await expect(dlg.getByText("Existing program")).toBeVisible();
  await dlg.getByRole("button", { name: "Start" }).click();
  await expect(dlg.getByRole("status", { name: "Recording state" })).toHaveText("Recording...");
  for (let x = 0; x <= 600; x += 150) {
    await command(request, "item.setPose", { item: box.id, xyzrpw: [x, 0, 0, 0, 0, 0], relativeTo: "station" });
    await page.waitForTimeout(200);
  }
  await dlg.getByRole("button", { name: "Stop" }).click();
  await expect(dlg.getByRole("status", { name: "Recording state" })).toHaveText(/^Simulation of \d+\.\d seconds recorded\.$/);
  const [download] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Save" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^WP-A3-e2e-\d+\.html$/);
  const file = info.outputPath("sim.html");
  await download.saveAs(file);
  const html = readFileSync(file, "utf8");
  expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  await expect(dlg.getByText(/^Simulation saved successfully: /)).toBeVisible();

   
  const player = await page.context().newPage();
  const remote: string[] = [];
  player.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) remote.push(r.url());
  });
  await player.goto(`file://${file}`);
  await expect.poll(() => player.evaluate(() => (window as unknown as { __mbSim?: { samples: number; bodies: number } }).__mbSim?.samples ?? 0)).toBeGreaterThan(5);
  expect(await player.evaluate(() => (window as unknown as { __mbSim: { bodies: number } }).__mbSim.bodies)).toBe(1);
  await expect(player.locator("canvas")).toBeVisible();
  await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(remote).toEqual([]);
  await player.close();
});

test("B-PANEL-07: the robot panel's WorkSpace combo and Show Frames boxes drive the robot", async ({ page, request }) => {
  const robot = await command(request, "library.load", { file: "ABB-IRB-120-3-0-6.robot" });
  await open(page);
  await page.getByRole("complementary", { name: "Station tree" }).getByText(robot.name, { exact: true }).click();
  const combo = page.getByRole("combobox", { name: "WorkSpace" });
  await expect(combo).toBeVisible();
  await expect(combo.locator("option")).toHaveText(["Do not show", "Show for wrist center", "Show for robot flange", "Show for current tool"]);
  await combo.selectOption({ label: "Show for robot flange" });
  await expect.poll(async () => (await ws(request)).items[robot.id].params?.ShowWorkspace).toBe("2");
  await page.getByRole("checkbox", { name: "Base (0)" }).click();
  await expect.poll(async () => (await ws(request)).items[robot.id].params?.ShowLinkFrames).toBe("0");
  await page.getByRole("checkbox", { name: "Robot Flange" }).click();
  await expect.poll(async () => (await ws(request)).items[robot.id].params?.ShowFlange).toBe("0");
});

test("B-KEY-06: F10 pops up the menus at the cursor in cinema mode", async ({ page, request }) => {
  await open(page);
  await command(request, "view.setDisplay", { cinema: true });
  try {
    await page.mouse.move(700, 400);
    const menu = page.getByRole("menu").first();
     
    await expect(async () => {
      await page.keyboard.press("F10");
      await expect(menu).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    for (const m of ["File", "Edit", "Program", "View", "Tools", "Utilities", "Connect", "Help"]) await expect(menu.getByText(m, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await command(request, "view.setDisplay", { cinema: false });
  }
   
  await page.keyboard.press("F10");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("B-KEY-10: ⌘/Ctrl + wheel over the tree changes the tree text and icon size", async ({ page, request }) => {
  await open(page);
  const tree = page.getByRole("tree");
  const before = (await command(request, "settings.get", { key: "TreeTextSize" })) as { value?: number } | number;
  try {
    await tree.hover();
    await page.keyboard.down(mod);
    await page.mouse.wheel(0, -100);
    await page.keyboard.up(mod);
    await expect.poll(async () => JSON.stringify(await command(request, "settings.get", { key: "TreeTextSize" }))).not.toBe(JSON.stringify(before));
  } finally {
    await command(request, "settings.set", { key: "TreeTextSize", value: 12.5 });
    await command(request, "settings.set", { key: "TreeIconSize", value: 15 });
  }
});

test("B-FILE-09: Make a Demo Station writes a zip with the station and an offline player", async ({ request }) => {
  await command(request, "object.addShape", { shape: "box", name: "Crate", sizeX: 100, sizeY: 100, sizeZ: 100 });
  const r = await command(request, "station.makeDemo", { fileName: `wpa3-e2e-demo-${Date.now()}` });
  expect(r.html).toMatch(/^Demo file generated successfully:<br><a href="file:\/\//);
  const zip = Buffer.from(r.base64, "base64").toString("latin1");
  expect(zip).toContain("/startup.mech");
  expect(zip).toContain("/index.html");
});
