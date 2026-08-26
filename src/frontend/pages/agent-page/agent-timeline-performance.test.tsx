import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentEntry } from "@shared/agent";

const markdown_render = vi.hoisted(() => vi.fn());
const translate = vi.hoisted(() => (key: string) => key);

vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({ t: translate }),
}));
vi.mock("./agent-markdown", () => ({
  AgentMarkdown: (props: { text: string }) => {
    markdown_render(props.text);
    return <div>{props.text}</div>;
  },
}));

import { AgentTimeline } from "./agent-timeline";

describe("AgentTimeline 渲染边界", () => {
  let container: HTMLDivElement | null = null;
  let root: ReturnType<typeof createRoot> | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    container = null;
    root = null;
    markdown_render.mockReset();
  });

  it("历史条目在 command 控制态变化时不重新提交 Markdown", async () => {
    const entries = build_rounds(2);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const on_continue = () => {};
    const on_edit = () => {};
    const on_add_annotation = () => {};
    const render = async (next_entries: readonly AgentEntry[], command_active: boolean) => {
      await act(async () =>
        root?.render(
          <AgentTimeline
            entries={next_entries}
            mention_tokens={[]}
            follow_reset_revision={0}
            on_continue={on_continue}
            on_edit={on_edit}
            on_add_annotation={on_add_annotation}
            revision_disabled={command_active}
            continue_disabled={command_active}
            annotation_disabled={command_active}
          />,
        ),
      );
    };

    await render(entries, false);
    const initial_render_count = markdown_render.mock.calls.length;
    expect(initial_render_count).toBeGreaterThan(0);

    await render(entries, true);
    expect(markdown_render).toHaveBeenCalledTimes(initial_render_count);

    const updated = [...entries];
    const last = updated.at(-1);
    if (last?.kind !== "assistant_message") throw new Error("缺少最后一条 assistant");
    updated[updated.length - 1] = {
      ...last,
      parts: [{ kind: "text", text: "最新一轮流式更新" }],
      status: "running",
    };
    await render(updated, true);
    expect(markdown_render).toHaveBeenCalledTimes(initial_render_count + 1);
  });
});

function build_rounds(count: number): AgentEntry[] {
  return Array.from({ length: count }, (_, index): AgentEntry[] => {
    const number = index + 1;
    return [
      {
        kind: "user_message",
        id: `user-${number.toString()}`,
        delivery: "round",
        text: `第 ${number.toString()} 轮`,
        attachments: [],
        status: "success",
        createdAt: number * 2,
        endedAt: number * 2 + 1,
      },
      {
        kind: "assistant_message",
        id: `assistant-${number.toString()}`,
        parts: [{ kind: "text", text: `第 ${number.toString()} 轮答复` }],
        status: "success",
        createdAt: number * 2 + 1,
      },
    ];
  }).flat();
}
