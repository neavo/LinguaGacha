import { afterEach, describe, expect, it, vi } from "vitest";

import {
  has_path_drop_payload,
  resolve_dropped_path,
  resolve_dropped_paths,
} from "@frontend/app/desktop/file-drop-paths";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

function create_data_transfer(args: {
  files?: File[];
  types?: string[];
  uri_list?: string;
}): DataTransfer {
  return {
    files: args.files ?? [],
    types: args.types ?? [],
    getData: (type: string) => (type === "text/uri-list" ? (args.uri_list ?? "") : ""),
  } as unknown as DataTransfer;
}

describe("file drop paths", () => {
  afterEach(() => vi.restoreAllMocks());

  it("优先读取桌面桥返回的全部本地文件路径", () => {
    const files = [new File([], "a.lg"), new File([], "b.lg")];
    const get_path_for_file = vi
      .fn()
      .mockReturnValueOnce("E:\\demo\\a.lg")
      .mockReturnValueOnce("E:\\demo\\b.lg");
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: { getPathForFile: get_path_for_file },
      }),
    });
    const data_transfer = create_data_transfer({ files, types: ["Files"] });

    expect(has_path_drop_payload(data_transfer)).toBe(true);
    expect(resolve_dropped_path(data_transfer)).toEqual({
      path: "E:\\demo\\a.lg",
      paths: ["E:\\demo\\a.lg", "E:\\demo\\b.lg"],
      has_multiple_paths: true,
    });
  });

  it("本地文件路径不可用时解析 URI 列表并忽略注释与非文件 URL", () => {
    Object.defineProperty(window, "desktopApp", {
      configurable: true,
      value: create_desktop_bridge_api_mock({
        methods: {
          getPathForFile: () => {
            throw new Error("路径不可用");
          },
        },
      }),
    });
    const data_transfer = create_data_transfer({
      files: [new File([], "unknown.lg")],
      types: ["text/uri-list"],
      uri_list: [
        "# Chromium metadata",
        "file:///C:/My%20Book/demo.lg",
        "file:///tmp/other.lg",
        "https://example.com/not-a-file",
      ].join("\n"),
    });

    expect(resolve_dropped_paths(data_transfer)).toEqual({
      path: "C:\\My Book\\demo.lg",
      paths: ["C:\\My Book\\demo.lg", "/tmp/other.lg"],
      has_multiple_paths: true,
    });
  });
});
