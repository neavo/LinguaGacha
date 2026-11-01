import path from "node:path";
import { it } from "vitest";
import { check_typescript } from "../../../test/typescript-fixture";
import { format_python_typescript_api } from "./description";

it("模型声明与公共 API 双向兼容，示例及错误参数可编译", () => {
  const source = path.resolve("src/backend/agent/python/types.ts").replaceAll("\\", "/");
  check_typescript([
    `
import type { PythonApi as ActualApi } from "${source}";
${format_python_typescript_api()}
declare const actual: ActualApi;
const described: PythonApi = actual;
const implementation: ActualApi = python;
const env = python.environment({ version: "3.13" });
await env.ensure();
await env.install(["Pillow", "fonttools"]);
await env.run(["work/process.py", "sources/input.png"]);
const info: PythonInfo = await env.info();
const entries: readonly PythonInstallation[] = await python.list();
await env.upgrade();
await env.remove(["Pillow"]);
// @ts-expect-error 包参数必须是数组。
env.install("Pillow");
// @ts-expect-error 句柄同步选择版本，准备由其方法负责。
const pending: Promise<PythonEnvironment> = python.environment();
// @ts-expect-error run 不返回捕获的输出。
const output: string = await env.run(["-c", "print(1)"]);
`,
  ]);
});
