import { expect, it, vi } from "vitest";

it("绑定只接受一次并固定配置，未绑定进程无法取得配置", async () => {
  vi.resetModules();
  const { bind_uv, uv_configuration } = await import("./runtime");
  expect(() => uv_configuration()).toThrow("not bound");
  const input = { pythonRoot: "shared-python", uvExecutable: "application-uv" };
  bind_uv(input);
  input.pythonRoot = "changed"; // 调用方后续修改不能改变根脚本的执行位置。
  expect(uv_configuration().pythonRoot).toBe("shared-python");
  expect(() => bind_uv(input)).toThrow("already bound");
  expect(() => Object.assign(uv_configuration(), input)).toThrow(TypeError);
});
