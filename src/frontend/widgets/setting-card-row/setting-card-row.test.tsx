import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { SettingCardRow } from "@frontend/widgets/setting-card-row/setting-card-row";

describe("SettingCardRow", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function render(embedded: boolean): Promise<void> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <SettingCardRow
          embedded={embedded}
          title="标题"
          description="说明"
          action={<button type="button">操作</button>}
        />,
      ),
    );
  }

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("默认形态只保留一层内容容器，复制区与操作区是它的直接子节点", async () => {
    await render(false);

    expect(container?.querySelector('[data-slot="card"]')).not.toBeNull();
    const content = container?.querySelector('[data-slot="card-content"]');
    expect(content?.classList.contains("setting-card-row__content")).toBe(true);
    expect(content?.children[0]?.classList.contains("setting-card-row__copy")).toBe(true);
    expect(content?.children[1]?.classList.contains("setting-card-row__action")).toBe(true);
    expect(container?.querySelectorAll(".setting-card-row__content")).toHaveLength(1);
  });

  it("嵌入形态不带卡片外框，直接由内容容器承载排版", async () => {
    await render(true);

    expect(container?.querySelector('[data-slot="card"]')).toBeNull();
    const content = container?.querySelector(".setting-card-row__content");
    expect(content?.classList.contains("setting-card-row--embedded")).toBe(true);
    expect(content?.children[0]?.classList.contains("setting-card-row__copy")).toBe(true);
    expect(content?.children[1]?.classList.contains("setting-card-row__action")).toBe(true);
  });
});
