import { describe, expect, it } from "vitest";

import {
  build_backend_api_base_url,
  build_backend_api_base_url_argument,
  normalize_backend_api_base_url,
  resolve_backend_api_base_url_from_argv,
} from "./api-base-url";

describe("Backend API 地址契约", () => {
  it("构造、标准化并通过启动参数传递本机地址", () => {
    const base_url = build_backend_api_base_url(38191);
    const argument = build_backend_api_base_url_argument(` ${base_url}/// `);

    expect(base_url).toBe("http://127.0.0.1:38191");
    expect(normalize_backend_api_base_url(` ${base_url}/// `)).toBe(base_url);
    expect(resolve_backend_api_base_url_from_argv(["electron", argument])).toBe(
      "http://127.0.0.1:38191",
    );
  });

  it("缺少或留空启动参数时直接失败", () => {
    expect(() => {
      resolve_backend_api_base_url_from_argv(["electron"]);
    }).toThrow("Backend API base URL launch argument is missing.");
    expect(() => {
      resolve_backend_api_base_url_from_argv(["electron", "--backend-api-base-url=   "]);
    }).toThrow("Backend API base URL launch argument is empty.");
  });
});
