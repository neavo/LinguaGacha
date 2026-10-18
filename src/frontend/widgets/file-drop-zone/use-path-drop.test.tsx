import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type PathDropOptions, usePathDrop } from "@frontend/widgets/file-drop-zone/use-path-drop";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

/** 用最小容器观察拖放状态和事件分发，布局由组件测试负责。 */
function DropProbe(props: PathDropOptions) {
  const { drop_active, drop_handlers } = usePathDrop(props);
  return (
    <div data-testid="zone" data-drop-active={drop_active ? "true" : undefined} {...drop_handlers}>
      <span data-testid="child">文件内容</span>
    </div>
  );
}

/** 构造携带宿主文件的拖放事件，路径由桌面桥替身按文件名返回。 */
function create_drag_event(type: string, paths: string[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: paths.map((path) => new File([], path)),
      types: ["Files"],
      getData: () => "",
      dropEffect: "",
    },
  });
  return event;
}

describe("usePathDrop", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({ methods: { getPathForFile: (file) => file.name } }),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** 只查询当前挂载容器，子元素事件仍沿真实 DOM 冒泡。 */
  function query(test_id: string): HTMLElement {
    return container.querySelector(`[data-testid="${test_id}"]`)!;
  }

  it.each([
    {
      name: "单选接收一个路径",
      paths: ["E:/a.txt"],
      batch: false,
      disabled: false,
      single_calls: [["E:/a.txt"]],
      batch_calls: [],
      issue_calls: [],
    },
    {
      name: "单选拒绝多个路径",
      paths: ["E:/a.txt", "E:/b.md"],
      batch: false,
      disabled: false,
      single_calls: [],
      batch_calls: [],
      issue_calls: [["multiple"]],
    },
    {
      name: "批量传递完整路径",
      paths: ["E:/a.txt", "E:/b.md"],
      batch: true,
      disabled: false,
      single_calls: [],
      batch_calls: [[["E:/a.txt", "E:/b.md"]]],
      issue_calls: [],
    },
    {
      name: "无路径时提示不可用",
      paths: [],
      batch: true,
      disabled: false,
      single_calls: [],
      batch_calls: [],
      issue_calls: [["unavailable"]],
    },
    {
      name: "禁用时忽略拖入",
      paths: ["E:/a.txt"],
      batch: false,
      disabled: true,
      single_calls: [],
      batch_calls: [],
      issue_calls: [],
    },
  ])("$name", async ({ paths, batch, disabled, single_calls, batch_calls, issue_calls }) => {
    const on_path_drop = vi.fn();
    const on_paths_drop = vi.fn();
    const on_drop_issue = vi.fn();
    await act(async () => {
      root.render(
        <DropProbe
          disabled={disabled}
          {...(batch ? { on_paths_drop } : { on_path_drop })}
          on_drop_issue={on_drop_issue}
        />,
      );
    });
    const event = create_drag_event("drop", paths);
    await act(async () => query("zone").dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(on_path_drop.mock.calls).toEqual(single_calls);
    expect(on_paths_drop.mock.calls).toEqual(batch_calls);
    expect(on_drop_issue.mock.calls).toEqual(issue_calls);
  });

  it("经过子元素时保持高亮，离开最外层或落下后清除", async () => {
    await act(async () => root.render(<DropProbe on_path_drop={vi.fn()} />));
    await act(async () => query("zone").dispatchEvent(create_drag_event("dragenter")));
    await act(async () => query("child").dispatchEvent(create_drag_event("dragenter")));
    await act(async () => query("child").dispatchEvent(create_drag_event("dragleave")));
    expect(query("zone").dataset.dropActive).toBe("true");
    await act(async () => query("zone").dispatchEvent(create_drag_event("dragleave")));
    expect(query("zone").dataset.dropActive).toBeUndefined();

    await act(async () => query("zone").dispatchEvent(create_drag_event("dragenter")));
    await act(async () => query("zone").dispatchEvent(create_drag_event("drop", ["E:/a.txt"])));
    expect(query("zone").dataset.dropActive).toBeUndefined();
  });

  it("禁用时拦截宿主默认打开并禁止落下", async () => {
    await act(async () => root.render(<DropProbe disabled on_path_drop={vi.fn()} />));
    const event = create_drag_event("dragover");
    await act(async () => query("zone").dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect((event as DragEvent).dataTransfer!.dropEffect).toBe("none");
    expect(query("zone").dataset.dropActive).toBeUndefined();
  });
});
