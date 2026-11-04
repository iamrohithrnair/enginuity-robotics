 
 
 
 
import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const mod = process.platform === "darwin" ? "Meta" : "Control";

async function command(request: APIRequestContext, name: string, params: Record<string, unknown> = {}) {
  const r = await request.post("/api/command", { data: { name, params } });
  const j = await r.json();
  if (!j.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
}
type Info = { id: string; name: string; file: string | null }[];

let opened: string[] = [];
let written: string[] = [];
test.beforeEach(async ({ request }) => {
  opened = [(await command(request, "station.new", { name: `WP-M2 e2e ${Date.now()}` })).id];
  written = [];
});
test.afterEach(async ({ request }) => {
  for (const id of opened) await command(request, "station.close", { station: id, ifUnsaved: "discard" }).catch(() => undefined);
  for (const f of written) if (existsSync(f)) rmSync(f);
});

async function open(page: Page, hideQuestions = true) {
  await page.goto("/");
   
   
  if (hideQuestions) await page.addStyleTag({ content: '[style*="var(--scrim)"]{display:none!important}' });
  await expect(page.getByRole("complementary", { name: "Station tree" })).toBeVisible();
}

test("File menu: .rdk is Import / Export as robot station; no vendor name in the menu", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "File", exact: true }).click();
  const menu = page.getByRole("menu").first();
  await expect(menu.getByRole("menuitem", { name: "Import robot station (.rdk)..." })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Export as robot station (.rdk)..." })).toBeVisible();
  await expect(menu.getByText("Save Station As .rdk...")).toHaveCount(0);
  expect(await menu.innerText()).not.toMatch(/robo\s*dk/i);
  await page.keyboard.press("Escape");
});

test("Save As writes <name>.mech; File ▸ Open offers .mech first and opens it as a new station", async ({ page, request }) => {
  await open(page, false);
  const name = `WP-M2 cell ${Date.now()}`;
  await command(request, "item.addFrame", { name: "Mark" });
  await page.mouse.click(800, 520);
  await page.keyboard.press(`${mod}+Shift+s`);
  const field = page.getByRole("textbox", { name: "File name" });
  await expect(field).toBeVisible();
  await field.fill(name);
  await field.press("Enter");
  let file = "";
  await expect(async () => {
    const info = (await command(request, "station.info")) as Info;
    file = info.find((s) => s.id === opened[0])?.file ?? "";
    expect(file.endsWith(`/${name}.mech`)).toBe(true);
  }).toPass({ timeout: 10_000 });
  written.push(file);
  expect(JSON.parse(readFileSync(file, "utf8")).format).toBe("enginuity-station");
  expect((await command(request, "station.listFiles")) as string[]).toContain(`${name}.mech`);

   
  await page.getByRole("button", { name: "File", exact: true }).click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("menuitem", { name: /^Open…/ }).first().click()]);
  const accept = (await chooser.element().getAttribute("accept")) ?? "";
  expect(accept.split(",")[0]).toBe(".mech");
  expect(accept.split(",")).toEqual(expect.arrayContaining([".rdk", ".robot", ".stl"]));
  const before = ((await command(request, "station.info")) as Info).map((s) => s.id);
  await chooser.setFiles(file);
  await expect(async () => {
    const now = ((await command(request, "station.info")) as Info).map((s) => s.id);
    const added = now.filter((id) => !before.includes(id));
    expect(added.length).toBe(1);
    opened.push(added[0]);
  }).toPass({ timeout: 15_000 });
});
