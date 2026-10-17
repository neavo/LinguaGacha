import { describe, expect, it, vi } from "vitest";

import {
  has_path_drop_payload,
  resolve_dropped_paths,
} from "@frontend/app/desktop/file-drop-paths";
import { create_desktop_bridge_api_mock } from "../../../test/desktop-bridge-mock";

/** 只提供路径解析实际消费的载荷，避免依赖浏览器拖放实现。 */
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
    expect(resolve_dropped_paths(data_transfer)).toEqual(["E:\\demo\\a.lg", "E:\\demo\\b.lg"]);
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

    expect(resolve_dropped_paths(data_transfer)).toEqual(["C:\\My Book\\demo.lg", "/tmp/other.lg"]);
  });

  it("无可用本地路径时返回空数组", () => {
    expect(
      resolve_dropped_paths(
        create_data_transfer({ uri_list: "https://example.com/file\ninvalid" }),
      ),
    ).toEqual([]);
  });
});
