// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { createReadonlyBeancountEditor } from "@gadgets/workshop-shared/beancount-editor";

describe("read-only Beancount review editor", () => {
  const mounted: Array<{ host: HTMLDivElement; destroy(): void }> = [];

  afterEach(() => {
    for (const item of mounted.splice(0)) {
      item.destroy();
      item.host.remove();
    }
  });

  it("uses CodeMirror's Beancount language in a non-editable view", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const editor = createReadonlyBeancountEditor({
      parent: host,
      value: '2026-09-02 * "Starbucks"\n  Expenses:Food  450.00 INR',
      mode: "light",
      ariaLabel: "Proposed Beancount",
    });
    mounted.push({ host, destroy: editor.destroy });

    const content = host.querySelector<HTMLElement>(".cm-content");
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(content?.getAttribute("aria-readonly")).toBe("true");
    expect(content?.getAttribute("aria-label")).toBe("Proposed Beancount");
    expect(content?.textContent).toContain("Starbucks");
    expect(content?.querySelectorAll("span").length).toBeGreaterThan(0);

    expect(() => editor.setMode("dark")).not.toThrow();
  });
});
