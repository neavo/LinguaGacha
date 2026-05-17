import { describe, expect, it } from "vitest";

import {
  build_core_api_base_url,
  build_core_api_base_url_argument,
  normalize_core_api_base_url,
  resolve_core_api_base_url_from_argv,
} from "./core-api-endpoint";

describe("Core API 地址契约", () => {
  it("构造本机 Core API base URL", () => {
    expect(build_core_api_base_url(38191)).toBe("http://127.0.0.1:38191");
  });

  it("标准化 base URL 末尾斜杠", () => {
    expect(normalize_core_api_base_url(" http://127.0.0.1:38191/// ")).toBe(
      "http://127.0.0.1:38191",
    );
  });

  it("通过启动参数传递 preload 可读取的 Core API 地址", () => {
    const argument = build_core_api_base_url_argument("http://127.0.0.1:38191/");

    expect(resolve_core_api_base_url_from_argv(["electron", argument])).toBe(
      "http://127.0.0.1:38191",
    );
  });

  it("缺少启动参数时直接失败", () => {
    expect(() => {
      resolve_core_api_base_url_from_argv(["electron"]);
    }).toThrow("Core API base URL launch argument is missing.");
  });

  it("启动参数为空时直接失败", () => {
    expect(() => {
      resolve_core_api_base_url_from_argv(["electron", "--core-api-base-url=   "]);
    }).toThrow("Core API base URL launch argument is empty.");
  });
});
