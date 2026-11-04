 
 
import { describe, expect, it } from "vitest";

describe("File menu", () => {
  it("has 'Import robot station (.rdk)...' and 'Export as robot station (.rdk)...'", async () => {
    await import("@/components/contrib/wpk2");
    const { mainMenuEntries } = await import("@/components/menuContrib");
    const labels = mainMenuEntries("File").map((e) => ("label" in e ? e.label : null));
    expect(labels).toContain("Import robot station (.rdk)...");
    expect(labels).toContain("Export as robot station (.rdk)...");
    expect(labels).not.toContain("Save Station As .rdk...");
    expect(labels.join(" ")).not.toMatch(/robo\s*dk/i);
  });
});
