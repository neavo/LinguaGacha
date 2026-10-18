import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { FileDropZone } from "./file-drop-zone";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

it("覆盖层随拖入开启，落下后传递路径并收起", async () => {
  Object.defineProperty(window, "desktopApp", {
    configurable: true,
    value: create_desktop_bridge_api_mock({ methods: { getPathForFile: (file) => file.name } }),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const on_path_drop = vi.fn();
  try {
    await act(async () =>
      root.render(
        <FileDropZone label="拖入文件" on_path_drop={on_path_drop}>
          <span />
        </FileDropZone>,
      ),
    );
    const overlay = container.querySelector<HTMLElement>("[aria-hidden]")!;
    for (const type of ["dragenter", "drop"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: { types: ["Files"], files: [new File([], "E:/source.txt")] },
      });
      await act(async () => container.firstElementChild!.dispatchEvent(event));
      expect(overlay.getAttribute("aria-hidden")).toBe(type === "drop" ? "true" : "false");
    }
    expect(on_path_drop).toHaveBeenCalledWith("E:/source.txt");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
