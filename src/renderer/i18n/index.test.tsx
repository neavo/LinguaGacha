import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { render_rich_text } from "@/i18n";

describe("render_rich_text", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
  });

  async function render_to_text(source_text: string): Promise<string> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <p>
          {render_rich_text(source_text, {
            emphasis: (children) => <strong>{children}</strong>,
          })}
        </p>,
      );
    });
    return container.textContent ?? "";
  }

  it("保留未注册标签的字面文本", async () => {
    await expect(render_to_text("<ruby>漢字<rt>かんじ</rt></ruby>")).resolves.toBe(
      "<ruby>漢字<rt>かんじ</rt></ruby>",
    );
  });

  it("继续渲染已注册的富文本标签", async () => {
    await expect(render_to_text("翻译 <emphasis>GalGame</emphasis> 文本")).resolves.toBe(
      "翻译 GalGame 文本",
    );
    expect(container?.querySelector("strong")?.textContent).toBe("GalGame");
  });
});
