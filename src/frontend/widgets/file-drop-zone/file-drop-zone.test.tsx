import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileDropZone } from "@frontend/widgets/file-drop-zone/file-drop-zone";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

describe("FileDropZone", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: { getPathForFile: (file) => file.name },
      }),
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

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
        <FileDropZone
          label="拖入文件"
          disabled={disabled}
          {...(batch ? { on_paths_drop } : { on_path_drop })}
          on_drop_issue={on_drop_issue}
        >
          <span>文件内容</span>
        </FileDropZone>,
      );
    });
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: {
        files: paths.map((path) => new File([], path)),
        types: ["Files"],
        getData: () => "",
      },
    });
    await act(async () => container.querySelector(".file-drop-zone")!.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(on_path_drop.mock.calls).toEqual(single_calls);
    expect(on_paths_drop.mock.calls).toEqual(batch_calls);
    expect(on_drop_issue.mock.calls).toEqual(issue_calls);
  });
});
