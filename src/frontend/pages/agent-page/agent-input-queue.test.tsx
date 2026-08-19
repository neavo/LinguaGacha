import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@dnd-kit/core", () => {
  const mocked = {
    DndContext: (props: { children: ReactNode; onDragEnd: (event: unknown) => void }) => (
      <div>
        {props.children}
        <button
          type="button"
          data-drag-end
          onClick={() => props.onDragEnd({ active: { id: "queue-1" }, over: { id: "queue-2" } })}
        />
      </div>
    ),
    KeyboardSensor: class {},
    PointerSensor: class {},
    closestCenter: vi.fn(),
    useSensor: vi.fn(() => ({})),
    useSensors: vi.fn(() => []),
  };
  return { ...mocked, default: mocked };
});
vi.mock("@dnd-kit/sortable", () => {
  const mocked = {
    SortableContext: (props: { children: ReactNode }) => <>{props.children}</>,
    arrayMove: (items: string[], from: number, to: number) => {
      const next = [...items];
      const [item] = next.splice(from, 1);
      if (item !== undefined) next.splice(to, 0, item);
      return next;
    },
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
    }),
    verticalListSortingStrategy: vi.fn(),
  };
  return { ...mocked, default: mocked };
});
vi.mock("@dnd-kit/utilities", () => {
  const mocked = { CSS: { Transform: { toString: () => undefined } } };
  return { ...mocked, default: mocked };
});
vi.mock("@frontend/app/locale/locale-provider", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));
vi.mock("@frontend/shadcn/tooltip", () => ({
  Tooltip: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipTrigger: (props: { children: ReactNode }) => <>{props.children}</>,
  TooltipContent: (props: { children: ReactNode }) => <>{props.children}</>,
}));

import { AgentInputQueue } from "./agent-input-queue";

describe("AgentInputQueue", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root !== null) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("转发编辑、删除、立即发送与重排", async () => {
    const on_edit = vi.fn();
    const on_delete = vi.fn();
    const on_reorder = vi.fn();
    const on_send_now = vi.fn();
    const first = {
      id: "queue-1",
      text: "检查第一章",
      attachments: [],
      status: "queued" as const,
      createdAt: 1,
    };
    const second = {
      id: "queue-2",
      text: "检查第二章",
      attachments: [],
      status: "queued" as const,
      createdAt: 2,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <AgentInputQueue
          queue={{ paused: true, canSendNow: true, items: [first, second] }}
          disabled={false}
          on_edit={on_edit}
          on_delete={on_delete}
          on_reorder={on_reorder}
          on_send_now={on_send_now}
        />,
      ),
    );

    const buttons = [...container.querySelectorAll<HTMLButtonElement>("button")];
    await act(async () =>
      buttons
        .find((button) => button.getAttribute("aria-label") === "agent_page.queue.send_now")
        ?.click(),
    );
    await act(async () =>
      buttons
        .find((button) => button.getAttribute("aria-label") === "agent_page.action.edit")
        ?.click(),
    );
    await act(async () =>
      buttons
        .find((button) => button.getAttribute("aria-label") === "agent_page.queue.delete")
        ?.click(),
    );
    await act(async () => container?.querySelector<HTMLButtonElement>("[data-drag-end]")?.click());

    expect(on_send_now).toHaveBeenCalledWith("queue-1");
    expect(on_edit).toHaveBeenCalledWith(first);
    expect(on_delete).toHaveBeenCalledWith("queue-1");
    expect(on_reorder).toHaveBeenCalledWith(["queue-2", "queue-1"]);
  });

  it("sending 项把主操作切为 busy 并禁用全部操作", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <AgentInputQueue
          queue={{
            paused: false,
            canSendNow: false,
            items: [
              { id: "queue-1", text: "插队", attachments: [], status: "sending", createdAt: 1 },
            ],
          }}
          disabled={false}
          on_edit={vi.fn()}
          on_delete={vi.fn()}
          on_reorder={vi.fn()}
          on_send_now={vi.fn()}
        />,
      ),
    );

    const send_action = container.querySelector<HTMLButtonElement>('button[aria-busy="true"]');
    expect(send_action?.disabled).toBe(true);
    expect(
      [...container.querySelectorAll<HTMLButtonElement>(".agent-input-queue__item button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
  });
});
