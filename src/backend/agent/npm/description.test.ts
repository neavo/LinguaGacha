import path from "node:path";
import { it } from "vitest";
import { check_typescript } from "../../../test/typescript-fixture";
import { format_npm_typescript_api } from "./description";

it("模型声明与公共 API 双向兼容，示例及错误参数可编译", () => {
  const source = path.resolve("src/backend/agent/npm/types.ts").replaceAll("\\", "/");
  check_typescript([
    `
import type { NpmApi as ActualApi } from "${source}";
${format_npm_typescript_api()}
declare const actual: ActualApi;
const described: NpmApi = actual;
const implementation: ActualApi = npm;
const directory: string = npm.directory;
await npm.run(["install", "exceljs"]);
// @ts-expect-error 参数必须是数组。
npm.run("install exceljs");
// @ts-expect-error run 不返回捕获的输出。
const output: string = await npm.run(["--version"]);
// @ts-expect-error 共享目录只读。
npm.directory = "elsewhere";
`,
  ]);
});
