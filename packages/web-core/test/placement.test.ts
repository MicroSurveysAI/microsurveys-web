import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/types";

// Web placement settings must survive config parsing: the renderer reads them off the parsed
// survey, so a field dropped here means the survey falls back to the sheet.
describe("web placement in config", () => {
  const parse = (survey: Record<string, unknown>) =>
    parseConfig(JSON.stringify({ projectId: "p1", surveys: [{ id: "s1", name: "S", questions: [], ...survey }] }))!
      .surveys[0]!;

  it("keeps a survey's webPlacement and webLauncher", () => {
    const s = parse({ presentation: "sheet", webPlacement: "top-right", webLauncher: true });
    expect(s.webPlacement).toBe("top-right");
    expect(s.webLauncher).toBe(true);
  });

  it("reads missing or malformed values as inherit (null)", () => {
    const s = parse({ webPlacement: 7, webLauncher: "yes" });
    expect(s.webPlacement).toBeNull();
    expect(s.webLauncher).toBeNull();
    const t = parse({});
    expect(t.webPlacement).toBeNull();
    expect(t.webLauncher).toBeNull();
  });

  it("keeps webLauncher: false, which overrides a project that starts minimized", () => {
    expect(parse({ webLauncher: false }).webLauncher).toBe(false);
  });
});
