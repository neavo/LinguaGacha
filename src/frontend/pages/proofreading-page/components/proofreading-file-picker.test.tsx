import { TooltipProvider } from "@frontend/shadcn/tooltip";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProofreadingFilePicker } from "./proofreading-file-picker";
import type { ProofreadingFilterChoice } from "../proofreading-filter-state";

vi.mock("@frontend/app/locale/locale-context", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

it("文件搜索只影响候选，全选覆盖整个工程，空选择保持为空且全选跟随新文件", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let selected: ProofreadingFilterChoice<string> = { mode: "default" };
  const files = [
    { file_path: "chapter.txt", kind: "item" as const, count: 3 },
    { file_path: "appendix.pdf", kind: "page" as const, count: 2 },
  ];
  /** 受控选择随用户勾选更新，模拟页面拥有文件范围。 */
  function Probe() {
    const [choice, set_choice] = useState<ProofreadingFilterChoice<string>>(selected);
    selected = choice;
    return (
      <TooltipProvider>
        <ProofreadingFilePicker
          files={files}
          selection={choice}
          disabled={false}
          on_change={set_choice}
        />
      </TooltipProvider>
    );
  }
  try {
    await act(async () => root.render(<Probe />));
    const trigger = container.querySelector("button")!;
    expect(trigger.textContent).toBe("proofreading_page.action.files");
    expect(trigger.getAttribute("data-active")).toBe("true");
    await act(async () => trigger.click());
    const popup = document.querySelector(".proofreading-page__file-picker");
    expect(popup?.querySelector("[title]")).toBeNull();
    const search = document.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "appendix",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    const all = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => all.click());
    expect(selected).toEqual({ mode: "selected", values: [] });
    expect(trigger.hasAttribute("data-active")).toBe(false);
    expect(trigger.textContent).toBe("proofreading_page.action.files");
    await act(async () => all.click());
    expect(selected).toEqual({ mode: "default" });
    files.push({ file_path: "new.txt", kind: "item", count: 1 });
    await act(async () => root.render(<Probe />));
    expect(all.checked).toBe(true);
    const pdf = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    vi.useFakeTimers();
    const row = pdf.closest("label")!;
    await act(async () => {
      row.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      vi.runAllTimers();
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("appendix.pdf");
    vi.useRealTimers();

    await act(async () => row.click());
    expect(all.indeterminate).toBe(true);
    expect(trigger.hasAttribute("data-active")).toBe(false);
    expect(selected).toEqual({ mode: "selected", values: ["chapter.txt", "new.txt"] });
    await act(async () => pdf.click());
    expect(selected.mode).toBe("selected");
    expect(trigger.getAttribute("data-active")).toBe("true");
    files.splice(0);
    await act(async () => root.render(<Probe />));
    expect(trigger.hasAttribute("data-active")).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  }
});
