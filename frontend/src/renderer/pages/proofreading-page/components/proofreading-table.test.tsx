import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProofreadingStatusCell } from "@/pages/proofreading-page/components/proofreading-table";
import type { ProofreadingItem } from "@/pages/proofreading-page/types";
import { TooltipProvider } from "@/shadcn/tooltip";

vi.mock("@/i18n", () => {
  return {
    useI18n: () => {
      return {
        t: (key: string) => key,
      };
    },
  };
});

function create_item(): ProofreadingItem {
  return {
    item_id: 1,
    file_path: "chapter01.txt",
    row_number: 1,
    src: "foo",
    dst: "bar",
    status: "PROCESSED",
    warnings: ["GLOSSARY"],
    warning_fragments_by_code: {},
    applied_glossary_terms: [],
    failed_glossary_terms: [],
  };
}

describe("ProofreadingStatusCell", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  async function render_cell(retranslating: boolean): Promise<HTMLDivElement> {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ProofreadingStatusCell item={create_item()} retranslating={retranslating} />
        </TooltipProvider>,
      );
    });

    return container;
  }

  it("重翻中的状态单元格只渲染 Spinner", async () => {
    const rendered = await render_cell(true);

    expect(rendered.querySelector('[role="status"]')).not.toBeNull();
    expect(rendered.querySelectorAll("svg")).toHaveLength(1);
  });

  it("非重翻状态仍按原状态与 warning 图标渲染", async () => {
    const rendered = await render_cell(false);

    expect(rendered.querySelector('[role="status"]')).toBeNull();
    expect(rendered.querySelectorAll("svg")).toHaveLength(2);
  });
});
