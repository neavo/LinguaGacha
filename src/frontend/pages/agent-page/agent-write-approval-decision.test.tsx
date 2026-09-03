import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@frontend/app/locale/locale-provider";
import { AgentWriteApprovalDecision } from "./agent-write-approval-decision";

describe("AgentWriteApprovalDecision", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("只展示非零写入摘要并提交选中的权限", async () => {
    const on_resolve = vi.fn(async () => undefined);
    await act(async () =>
      root.render(
        <LocaleProvider locale="zh-CN">
          <AgentWriteApprovalDecision
            decision={{
              kind: "write_approval",
              id: "apply-1",
              expiresAt: Date.now() + 300_000,
              summary: {
                items: 12,
                glossary: 3,
                textPreserve: 1,
                preReplacement: 0,
                postReplacement: 0,
                prompts: 0,
              },
            }}
            on_resolve={on_resolve}
          />
        </LocaleProvider>,
      ),
    );
    const actions = [...container.querySelectorAll<HTMLButtonElement>(".agent-decision-action")];

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const description = container.querySelector<HTMLElement>(".agent-decision__description");
    expect(dialog?.getAttribute("aria-describedby")).toBe(description?.id);
    expect(actions).toHaveLength(3);
    expect(container.querySelectorAll(".agent-write-summary__item")).toHaveLength(3);
    expect(
      [...container.querySelectorAll(".agent-write-summary__value")].map(
        (value) => value.textContent,
      ),
    ).toEqual(["12", "3", "1"]);

    await act(async () => actions[1]?.click());
    expect(on_resolve).toHaveBeenCalledWith("allow_once");
  });
});
