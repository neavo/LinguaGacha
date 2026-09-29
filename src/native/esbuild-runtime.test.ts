import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { configure_packaged_esbuild } from "./esbuild-runtime";

afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "custom-esbuild"])("开发态保留原环境 %s", (binary) => {
  vi.stubEnv("ESBUILD_BINARY_PATH", binary);
  configure_packaged_esbuild(path.resolve("build/dist-electron"));
  expect(process.env.ESBUILD_BINARY_PATH).toBe(binary);
});
