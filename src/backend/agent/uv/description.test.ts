import path from "node:path";
import { it } from "vitest";
import { check_typescript } from "../../../test/typescript-fixture";
import { format_uv_typescript_api } from "./description";

it("模型声明与公共 API 双向兼容，示例及错误参数可编译", () => {
  const source = path.resolve("src/backend/agent/uv/types.ts").replaceAll("\\", "/");
  check_typescript([
    `
import type { UvApi as ActualApi } from "${source}";
${format_uv_typescript_api()}
declare const actual: ActualApi;
const described: UvApi = actual;
const implementation: ActualApi = uv;
const directory: string = uv.directory;
await uv.run(["add", "Pillow"]);
await uv.run(["run", "python", "work/process.py"]);
// @ts-expect-error 参数必须是数组。
uv.run("add Pillow");
// @ts-expect-error run 不返回捕获的输出。
const output: string = await uv.run(["--version"]);
// @ts-expect-error 共享目录只读。
uv.directory = "elsewhere";
`,
  ]);
});
