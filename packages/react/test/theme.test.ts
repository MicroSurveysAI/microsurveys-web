import { describe, expect, it } from "vitest";
import { resolveTheme, resolvePlacement, resolveLauncher, isModalPlacement } from "../src/theme";

const vars = (theme: Parameters<typeof resolveTheme>[0]) => resolveTheme(theme).vars as Record<string, string>;

describe("resolveTheme", () => {
  it("uses real theme values as given", () => {
    const v = vars({ accent: "#2E7272", text: "rgba(0, 0, 0, 0.8)", cornerRadius: 16, font: "Open Sans" });
    expect(v["--ms-accent"]).toBe("#2E7272");
    expect(v["--ms-text"]).toBe("rgba(0, 0, 0, 0.8)");
    expect(v["--ms-card-radius"]).toBe("16px");
    expect(v["--ms-font"]).toContain("'Open Sans'");
  });

  it("falls back to defaults for values that would make the browser fetch something", () => {
    const v = vars({ surface: "url(https://evil.example/t.gif)", accent: "red; background: url(x)", font: "Inter', url(x)" });
    expect(v["--ms-surface"]).toBe("#FFFFFF");
    expect(v["--ms-accent"]).toBe("#2E7272");
    expect(v["--ms-font"]).not.toContain("url(");
  });

  it("bounds absurd sizes", () => {
    expect(vars({ spacing: 1e9 })["--ms-spacing"]).toBe("200px");
  });
});

describe("resolvePlacement", () => {
  it("uses the survey's placement first, then the theme's", () => {
    expect(resolvePlacement({ webPlacement: "top-left", presentation: "dialog" }, { webPlacement: "bottom-right" })).toBe("top-left");
    expect(resolvePlacement({ webPlacement: null, presentation: "dialog" }, { webPlacement: "bottom-right" })).toBe("bottom-right");
  });

  it("falls back to the presentation, then the theme position, as before placements existed", () => {
    expect(resolvePlacement({ presentation: "dialog" }, null)).toBe("center");
    expect(resolvePlacement({ presentation: "sheet" }, { position: "center" })).toBe("bottom");
    expect(resolvePlacement({ presentation: null }, { position: "center" })).toBe("center");
    expect(resolvePlacement({}, null)).toBe("bottom");
  });

  it("ignores placements it doesn't know", () => {
    expect(resolvePlacement({ webPlacement: "middle-ish" }, { webPlacement: "nowhere" })).toBe("bottom");
  });

  it("treats only bottom and center as modal", () => {
    expect(isModalPlacement("bottom")).toBe(true);
    expect(isModalPlacement("center")).toBe(true);
    expect(isModalPlacement("bottom-right")).toBe(false);
  });
});

describe("resolveLauncher", () => {
  it("uses the survey's choice, else the theme's, else open", () => {
    expect(resolveLauncher({ webLauncher: false }, { webLauncher: true })).toBe(false);
    expect(resolveLauncher({ webLauncher: null }, { webLauncher: true })).toBe(true);
    expect(resolveLauncher({}, null)).toBe(false);
  });
});
