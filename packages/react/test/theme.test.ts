import { describe, expect, it } from "vitest";
import { resolveTheme } from "../src/theme";

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
