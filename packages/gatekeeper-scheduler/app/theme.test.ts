import { afterEach, describe, expect, it } from "vitest";
import { applyAppTheme } from "./theme";

describe("applyAppTheme", () => {
  it("defaults legacy hosts to paper and clears stale accent overrides when switching skins", () => {
    applyAppTheme({ mode: "light", accentColor: "#ff4801", skin: "base" });
    applyAppTheme({ mode: "dark", accentColor: "#ff4801" });
    expect(document.documentElement.dataset.skin).toBe("paper");
    expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("");
    applyAppTheme({ mode: "light", accentColor: "#123456", skin: "paper" });
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-mode");
    document.documentElement.removeAttribute("data-skin");
    document.documentElement.removeAttribute("style");
  });

  it("applies the host mode and accent and can restore the base accent", () => {
    applyAppTheme({ mode: "dark", accentColor: "#3b82f6", skin: "base" });

    expect(document.documentElement.dataset.mode).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--color-kumo-brand"))
      .toContain("#3b82f6");

    applyAppTheme({ mode: "light", accentColor: null, skin: "base" });

    expect(document.documentElement.dataset.mode).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.style.getPropertyValue("--color-kumo-brand")).toBe("");
  });
});
