import { expect, it, vi } from "vitest";

import { normalize_source_paths, read_file_paths } from "@frontend/app/desktop/source-paths";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

it("过滤空值并按准确路径去重，保留路径中的空格", () => {
  expect(normalize_source_paths([" b.txt ", "", "a.txt", "b.txt", "  "])).toEqual([
    " b.txt ",
    "a.txt",
    "b.txt",
  ]);
});

it("路径读取保留原值和顺序，虚拟文件与桥接异常归入跳过列表", () => {
  const get_path = vi
    .fn()
    .mockReturnValueOnce(" E:/a.txt ")
    .mockReturnValueOnce("")
    .mockImplementationOnce(() => {
      throw new Error("unavailable");
    })
    .mockReturnValueOnce("E:/b.txt");
  vi.stubGlobal(
    "desktopApp",
    create_desktop_bridge_api_mock({ methods: { getPathForFile: get_path } }),
  );
  try {
    expect(
      read_file_paths(
        ["a.txt", "virtual.txt", "broken.txt", "b.txt"].map((name) => new File([], name)),
      ),
    ).toEqual({
      paths: [" E:/a.txt ", "E:/b.txt"],
      skipped: ["virtual.txt", "broken.txt"],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
