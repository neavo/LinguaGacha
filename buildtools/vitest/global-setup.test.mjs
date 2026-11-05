import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { build_resources } from "../resources/build.mjs";
import setup from "./global-setup.mjs";

vi.mock("../resources/build.mjs", () => ({ build_resources: vi.fn() }));

it("构建失败清理半成品，不发布可供测试使用的路径", async () => {
  vi.stubEnv("LINGUAGACHA_TEST_WORKSPACE_RUNTIME", undefined);
  const failure = new Error("build failed");
  let output;
  vi.mocked(build_resources).mockImplementationOnce(async (options) => {
    output = options.output;
    throw failure;
  });
  const provide = vi.fn();
  await expect(
    setup({ name: "integration", config: { root: path.resolve(".") }, provide }),
  ).rejects.toBe(failure);
  expect(provide).not.toHaveBeenCalled();
  await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it("发行验收使用指定资源，生命周期仍由调用者拥有", async () => {
  const deployed = await mkdtemp(path.join(os.tmpdir(), "lg-test-deployed-"));
  vi.stubEnv("LINGUAGACHA_TEST_WORKSPACE_RUNTIME", deployed);
  const provide = vi.fn();
  try {
    const cleanup = await setup({ name: "integration", provide });
    expect(provide).toHaveBeenCalledWith("workspaceRuntimeDirectory", deployed);
    expect(cleanup).toBeUndefined();
    expect((await stat(deployed)).isDirectory()).toBe(true);
  } finally {
    await rm(deployed, { recursive: true, force: true });
  }
});
