import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_error_contract_rules } from "./error-rules.mjs";

describe("error contract rules", () => {
  it("报告生产抛错中文与基于 message 的错误分支", () => {
    const errors = run_rules({
      "src/backend/example.ts": [
        'throw new TypeError("中文错误");',
        'const failure = new Error("中文回调错误");',
        'const direct = Error("中文直接调用错误");',
        'if (error.message.startsWith("prefix")) return;',
        'if ("failed" === operation_error.message) return;',
        "switch (cause.message) { default: break; }",
      ].join("\n"),
    });

    expect(errors).toEqual([
      expect.objectContaining({ rule_name: "异常文本语言", line: 1 }),
      expect.objectContaining({ rule_name: "异常文本语言", line: 2 }),
      expect.objectContaining({ rule_name: "异常文本语言", line: 3 }),
      expect.objectContaining({ rule_name: "错误控制流", line: 4 }),
      expect.objectContaining({ rule_name: "错误控制流", line: 5 }),
      expect.objectContaining({ rule_name: "错误控制流", line: 6 }),
    ]);
  });

  it("允许英文异常、按类型或 code 分支、普通 message 字段与测试夹具", () => {
    expect(
      run_rules({
        "src/backend/example.test.ts": 'throw new Error("测试中文");',
        "src/backend/example.ts": [
          '// if (error.message === "注释不参与检查") return;',
          'const example = "new Error(\\"普通中文字符串\\")";',
          "throw new Error(`Request ${request_id} failed.`);",
          "if (error instanceof Error) return;",
          'if (app_error.code === "runtime.busy") return;',
          "if (log_decision.message !== summary) return;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });
});

function run_rules(files) {
  const project_root = path.resolve("error-rule-test-project");
  const source_by_path = new Map(
    Object.entries(files).map(([relative_path, content]) => [
      path.join(project_root, ...relative_path.split("/")),
      content,
    ]),
  );
  const context = {
    files: [...source_by_path.keys()],
    project_root,
    read_file: (file_path) => source_by_path.get(file_path) ?? "",
    relative_path: (file_path) => path.relative(project_root, file_path).replaceAll(path.sep, "/"),
  };

  return create_error_contract_rules().flatMap((rule) =>
    rule.check(context).map((error) => ({ rule_name: rule.name, ...error })),
  );
}
