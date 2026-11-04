 
 
 
 
 
import { expect, test, type APIRequestContext } from "@playwright/test";

async function command(request: APIRequestContext, name: string, params: Record<string, unknown> = {}) {
  const r = await request.post("/api/command", { data: { name, params } });
  const j = await r.json();
  if (!j.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
}
type WS = { items: Record<string, { name: string; type: string; robot?: { postProcessor: string } }> };
const ws = async (request: APIRequestContext) => ((await (await request.get("/api/state")).json()) as { ws: WS }).ws;

let station = "";
let robot = "";
let program = "";
test.beforeEach(async ({ request }) => {
  station = (await command(request, "station.new", { name: `WP-F2 e2e ${Date.now()}` })).id;
  robot = (await command(request, "library.load", { file: "ABB-IRB-120-3-0-6.robot" })).id;
  await command(request, "robot.setPostProcessor", { robot, post: "Leantec" });
  program = (await command(request, "program.add", { name: "PickProg", robot })).id;
  await command(request, "program.addMoveJ", { program, joints: [0, -10, 20, 0, 30, 0] });
});
test.afterEach(async ({ request }) => {
   
  const { picks } = (await (await request.get("/api/postpick")).json()) as { picks: { id: string }[] };
  for (const p of picks) await request.post("/api/postpick", { data: { id: p.id, post: null } });
  if (station) await command(request, "station.close", { station, ifUnsaved: "discard" }).catch(() => undefined);
});

test("POST-PickList: OK stores the chosen post on the robot and generates with it", async ({ page, request }, info) => {
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Station tree" })).toBeVisible();
  const gen = request.post("/api/command", { data: { name: "program.generate", params: { program } } });
  const dlg = page.getByRole("dialog", { name: "Select one item" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText("Select a Post Processor for the robot ABB IRB 120-3/0.6")).toBeVisible();
  const list = dlg.getByRole("listbox", { name: "Post processors" });
  await expect(list.getByRole("option", { name: "KUKA KRC4" })).toBeVisible();
   
  await expect(list.getByRole("option", { selected: true })).toHaveCount(0);
  await list.getByRole("option", { name: "KUKA KRC4" }).click();
  await page.screenshot({ path: info.outputPath("post-picker.png") });
  await dlg.getByRole("button", { name: "OK" }).click();
  const res = await (await gen).json();
  expect(res.ok).toBe(true);
  expect(res.result.post).toBe("KUKA_KRC4");
  expect((await ws(request)).items[robot].robot!.postProcessor).toBe("KUKA_KRC4");
  await expect(dlg).toBeHidden();
});

test("POST-PickList: Cancel keeps the robot's post and generation fails", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("complementary", { name: "Station tree" })).toBeVisible();
  const gen = request.post("/api/command", { data: { name: "program.generate", params: { program } } });
  const dlg = page.getByRole("dialog", { name: "Select one item" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  const res = await (await gen).json();
  expect(res.ok).toBe(false);
  expect(res.error).toContain("Select a Post Processor for the robot ABB IRB 120-3/0.6 (post processor Leantec was not found)");
  expect((await ws(request)).items[robot].robot!.postProcessor).toBe("Leantec");
   
  const out = page.getByRole("dialog", { name: /Python Post Processor output/ });
  if (await out.isVisible().catch(() => false)) await out.getByRole("button", { name: "OK" }).click();
});
