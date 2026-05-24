import { describe, expect, it } from "vitest";

import {
  create_desktop_bridge_api_mock,
  DESKTOP_BRIDGE_TEST_BASE_URL,
} from "./desktop-bridge-mock";

describe("create_desktop_bridge_api_mock", () => {
  it("生成可被 renderer 测试覆写的桌面桥接快照", async () => {
    const bridge = create_desktop_bridge_api_mock({
      shell: {
        platform: "darwin",
      },
      coreApi: {
        baseUrl: "http://127.0.0.1:4567",
      },
      methods: {
        pickProjectFilePath: async () => ({ canceled: false, paths: ["E:/demo/demo.lg"] }),
      },
    });

    await expect(bridge.pickProjectFilePath()).resolves.toEqual({
      canceled: false,
      paths: ["E:/demo/demo.lg"],
    });
    expect(bridge.shell.platform).toBe("darwin");
    expect(bridge.coreApi.baseUrl).toBe("http://127.0.0.1:4567");
    expect(create_desktop_bridge_api_mock().coreApi.baseUrl).toBe(DESKTOP_BRIDGE_TEST_BASE_URL);
  });
});
