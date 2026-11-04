 
 
 
import { expect, test, type Page } from "@playwright/test";

const mod = process.platform === "darwin" ? "Meta" : "Control";

const tree = (page: Page) => page.getByRole("complementary", { name: "Station tree" });
const statusBar = (page: Page) => page.getByRole("status");

async function fresh(page: Page) {
  await page.request.post("/api/test/reset");
  await page.goto("/");
  await expect(tree(page).getByText("New Station (1)")).toBeVisible();
}

async function command(page: Page, name: string, params: Record<string, unknown> = {}) {
  const r = await page.request.post("/api/command", { data: { name, params } });
  return (await r.json()).result;
}

async function state(page: Page) {
  return (await (await page.request.get("/api/state")).json()) as { ws: { simulationSpeed: number; selection: string[]; items: Record<string, { name: string; visible: boolean; parent: string | null; type: string; robot?: { joints: number[] } }> }; undo: { undo: string[] } };
}

const canvasPoint = { x: 800, y: 520 };

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

test("R-IM-2: ⌘/Ctrl+N creates 'New Station (2)' (setupUi FUN_10036c2a8)", async ({ page }) => {
  await fresh(page);
  await page.mouse.click(canvasPoint.x, canvasPoint.y);
  await page.keyboard.press(`${mod}+n`);
  await expect(tree(page).getByText("New Station (2)")).toBeVisible();
});

test("R-TREE-24: F2 in the tree edits the name in place; empty text leaves the name unchanged", async ({ page }) => {
  await fresh(page);
  await command(page, "item.addFrame", { name: "Frame A" });
  await tree(page).getByText("Frame A").click();
  await page.keyboard.press("F2");
   
  const field = tree(page).getByRole("textbox", { name: "Item name" });
  await expect(field).toHaveValue("Frame A");
  await field.fill("");
  await page.keyboard.press("Enter");
  await expect(tree(page).getByText("Frame A")).toBeVisible();
  await page.keyboard.press("F2");
  await tree(page).getByRole("textbox", { name: "Item name" }).fill("Frame B");
  await page.keyboard.press("Enter");
  await expect(tree(page).getByText("Frame B")).toBeVisible();
});

test("R-IM-6 / R-IM-31: Delete removes without confirmation; ⌘Z undoes 'Delete: <name>'", async ({ page }) => {
  await fresh(page);
  await command(page, "item.addFrame", { name: "Doomed" });
  await tree(page).getByText("Doomed").click();
  await page.keyboard.press("Delete");
  await expect(tree(page).getByText("Doomed")).toHaveCount(0);
  await expect.poll(async () => (await state(page)).undo.undo.at(-1)).toBe("Delete: Doomed");
  await page.keyboard.press(`${mod}+z`);
  await expect(tree(page).getByText("Doomed")).toBeVisible();
});

test("R-TREE-21: F7 toggles the selected item only; children stay visible", async ({ page }) => {
  await fresh(page);
  const parent = await command(page, "item.addFrame", { name: "Parent" });
  const child = await command(page, "item.addFrame", { name: "Kid", parent: parent.id });
  await tree(page).getByText("Parent").click();
  await page.keyboard.press("F7");
  await expect.poll(async () => (await state(page)).ws.items[parent.id].visible).toBe(false);
  expect((await state(page)).ws.items[child.id].visible).toBe(true);
});

test("R-IM-8: Escape clears the selection and reports 'Cleared selection'", async ({ page }) => {
  await fresh(page);
  await command(page, "item.addFrame", { name: "Picked" });
  await tree(page).getByText("Picked").click();
  await expect.poll(async () => (await state(page)).ws.selection.length).toBe(1);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await state(page)).ws.selection.length).toBe(0);
  await expect(statusBar(page)).toContainText("Cleared selection");
});

test("R-IM-36/37: ⌘C writes the items marker to the clipboard; ⌘V pastes a same-named copy", async ({ page }) => {
  await fresh(page);
  await command(page, "item.addFrame", { name: "CopyMe" });
  await tree(page).getByText("CopyMe").click();
  await page.keyboard.press(`${mod}+c`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("%Enginuity items%");
  await page.keyboard.press(`${mod}+v`);
  await expect(tree(page).getByText("CopyMe", { exact: true })).toHaveCount(2);
});

test("R-IM-39: ⌘C with nothing selected copies the robot joints as tab-separated text", async ({ page }) => {
  await fresh(page);
  const r = await command(page, "library.load", { file: "ABB-IRB-120-3-0-6.robot" });
  await command(page, "robot.setJoints", { robot: r.id, joints: [1, 2, 3, 4, 5, 6] });
  await command(page, "edit.select", { items: [] });
  await page.mouse.click(canvasPoint.x, 900);
  await page.keyboard.press(`${mod}+c`);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("1.000000\t2.000000\t3.000000\t4.000000\t5.000000\t6.000000");
  await expect(statusBar(page)).toContainText("joints copied to clipboard");
});

test("R-IM-38: pasting 3 numbers per line creates 'Pasted Points'", async ({ page }) => {
  await fresh(page);
  await page.evaluate(() => navigator.clipboard.writeText("1 2 3\n4 5 6\n7 8 9"));
  await page.mouse.click(canvasPoint.x, 900);
  await page.keyboard.press(`${mod}+v`);
  await expect(tree(page).getByText("Pasted Points")).toBeVisible();
});

test("R-IM-7: holding Space with nothing selected runs fast (100) and releasing returns to normal (5)", async ({ page }) => {
  await fresh(page);
  await page.mouse.click(canvasPoint.x, 900);
  await page.keyboard.down(" ");
  await expect.poll(async () => (await state(page)).ws.simulationSpeed).toBe(100);
  await page.keyboard.up(" ");
  await expect.poll(async () => (await state(page)).ws.simulationSpeed).toBe(5);
});

test("R-TREE-30/32: dropping a frame on a frame re-parents it keeping the relative pose", async ({ page }) => {
  await fresh(page);
  await command(page, "item.addFrame", { name: "Parent F", xyzrpw: [0, 500, 0, 0, 0, 0] });
  const child = await command(page, "item.addFrame", { name: "Child F", xyzrpw: [100, 0, 0, 0, 0, 0] });
  await tree(page).getByText("Child F").dragTo(tree(page).getByText("Parent F"));
  await expect.poll(async () => (await command(page, "item.info", { item: child.id })).parent).toBe("Parent F");
  const info = await command(page, "item.info", { item: child.id });
  expect(info.xyzrpw.slice(0, 3)).toEqual([100, 0, 0]);
});

test("R-TREE-37/40: robot menus have Delete but no Rename; frame menus have Rename", async ({ page }) => {
  await fresh(page);
  await command(page, "library.load", { file: "UR5e.robot" });
  await tree(page).getByText("UR5e", { exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Rename/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(canvasPoint.x, 900);
  await tree(page).getByText("UR5e Base").click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /^Rename/ })).toBeVisible();
});

test("R-PROG-37: Pause ≤ 0 asks 'Program … paused. Press OK to continue.'; OK finishes the program", async ({ page }) => {
  await fresh(page);
  const p = await command(page, "program.add", { name: "Waiter" });
  await command(page, "program.addInstruction", { program: p.id, kind: "pause", pauseMs: -1 });
  await command(page, "program.addInstruction", { program: p.id, kind: "print", text: "after pause" });
  await command(page, "program.run", { program: p.id });
  const dlg = page.getByRole("dialog");
  await expect(dlg).toContainText("Program Waiter paused.");
  await expect(dlg).toContainText("Press OK to continue.");
  await dlg.getByRole("button", { name: "OK" }).click();
  await expect(statusBar(page)).toContainText(/Program Waiter finished|Waiter message: after pause/);
});

test("R-IM-4 / palette: ⌘/Ctrl+K runs a command by name", async ({ page }) => {
  await fresh(page);
  await page.mouse.click(canvasPoint.x, 900);
  await page.keyboard.press(`${mod}+k`);
  await page.getByPlaceholder(/Type a command/).fill("add reference frame");
  await page.getByText("Add Reference Frame", { exact: true }).first().click();
   
  const run = page.getByRole("button", { name: "Run", exact: true });
  if (await run.isVisible().catch(() => false)) await run.click();
  await expect(tree(page).getByText("Frame 1")).toBeVisible();
});

test("R-IM-2: ⌘⇧O opens the robot library; Escape closes it", async ({ page }) => {
  await fresh(page);
  await page.mouse.click(canvasPoint.x, 900);
  await page.keyboard.press(`${mod}+Shift+o`);
  await expect(page.getByText("Robot Library", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Robot Library", { exact: true })).toHaveCount(0);
});

test("R-TREE-20: double-clicking a target jumps the robot to it", async ({ page }) => {
  await fresh(page);
  const r = await command(page, "library.load", { file: "ABB-IRB-120-3-0-6.robot" });
  await command(page, "robot.setJoints", { robot: r.id, joints: [20, 10, 10, 0, 40, 0] });
  await command(page, "target.teach", {});
  await command(page, "robot.setJoints", { robot: r.id, joints: [0, 0, 0, 0, 30, 0] });
  await tree(page).getByText("Target 1").dblclick();
  await expect.poll(async () => (await state(page)).ws.items[r.id].robot!.joints.map((v) => Math.round(v))).toEqual([20, 10, 10, 0, 40, 0]);
});
