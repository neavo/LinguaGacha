import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_check_context } from "./core.mjs";
import { create_source_reader } from "./source-reader.mjs";
import { create_error_contract_rules } from "./error-rules.mjs";

describe("error contract rules", () => {
  it("识别可选链和括号内的错误分支，并定位跨行异常字面量", () => {
    const errors = run_rules({
      "src/backend/example.ts": [
        'const 前缀 = "😀"; if ((error?.message) === "failed") {}',
        'if ((cause?.message)?.includes("failed")) {}',
        'if (operation_error.message?.startsWith("failed")) {}',
        "throw new Error(`Request failed:\n中文${request_id}\n后续中文`);",
        'const failure = new Error("Request failed:\\\n中文");',
      ].join("\r\n"),
    });
    expect(errors.map((error) => error.line)).toEqual([5, 6, 8, 1, 2, 3]);
  });

  it("报告生产抛错中文与基于 message 的错误分支", () => {
    const errors = run_rules({
      "src/backend/example.ts": [
        'throw new TypeError("中文错误");',
        'const failure = new Error("中文回调错误");',
        'const direct = Error("中文直接调用错误");',
        'if (error.message.startsWith("prefix")) {}',
        'if ("failed" === operation_error.message) {}',
        "switch (cause.message) { default: break; }",
      ].join("\n"),
    });

    expect(errors.map((error) => error.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("允许英文异常、按类型或 code 分支、普通 message 字段与测试夹具", () => {
    expect(
      run_rules({
        "src/backend/example.test.ts": 'throw new Error("测试中文");',
        "src/backend/example.ts": [
          '// if (error.message === "注释不参与检查") {}',
          'const example = "new Error(\\"普通中文字符串\\")";',
          "throw new Error(`Request ${request_id} failed.`);",
          "if (error instanceof Error) {}",
          'if (app_error.code === "runtime.busy") {}',
          "if (log_decision.message !== summary) {}",
          'const failure = lookup("业务名称").Error("Request failed.");',
        ].join("\n"),
      }),
    ).toEqual([]);
  });
});

/** 用内存源码执行真实规则，避免测试依赖当前工作区内容。 */
function run_rules(files) {
  const project_root = path.resolve("error-rule-test-project");
  const source_by_path = new Map(
    Object.entries(files).map(([relative_path, content]) => [
      path.join(project_root, ...relative_path.split("/")),
      content,
    ]),
  );
  const context = create_check_context({
    files: [...source_by_path.keys()],
    project_root,
    source_reader: create_source_reader((file_path) => source_by_path.get(file_path)),
  });

  return create_error_contract_rules().flatMap((rule) => rule.check(context));
}
