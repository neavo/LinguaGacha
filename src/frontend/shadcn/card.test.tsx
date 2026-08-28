import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Card } from "./card";

describe("Card", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("通过 render 使用原生按钮并保留交互卡片标记", async () => {
    const on_click = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(
        <Card render={<button type="button" />} onClick={on_click}>
          内容
        </Card>,
      ),
    );

    const card = container.querySelector("button");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-slot")).toBe("card");
    expect(card?.getAttribute("data-interactive")).toBe("true");

    await act(async () => card?.click());
    expect(on_click).toHaveBeenCalledTimes(1);
  });
});
