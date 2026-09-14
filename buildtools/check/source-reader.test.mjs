import { describe, expect, it } from "vitest";

import { create_source_reader } from "./source-reader.mjs";

describe("source reader", () => {
  it("同次读取共享源码快照，新读取器消费最新内容", () => {
    let content = 'import "./before";';
    let reads = 0;
    const read = () => {
      reads += 1;
      return content;
    };
    const reader = create_source_reader(read);
    expect(reader.read_file("example.ts")).toBe(content);
    content = 'import "./after";';
    expect(reader.read_imports("example.ts")).toEqual([{ line: 1, specifier: "./before" }]);
    expect(reads).toBe(1);
    expect(create_source_reader(read).read_imports("example.ts")).toEqual([
      { line: 1, specifier: "./after" },
    ]);
    expect(reads).toBe(2);
  });

  it("按源码顺序提取类型、静态、动态和转发导入，并定位到实际语句行", () => {
    const source = [
      'import type { A } from "./a";',
      'import "./side-effect";',
      'const lazy = import("./lazy");',
      'export type { B } from "./b";',
      'export * from "./all";',
      'export { named } from "./named";',
      'const 前缀 = "😀"; const view = <div>{import("./view")}</div>;',
      "export { view };",
    ].join("\r\n");
    const reader = create_source_reader(() => source);

    expect(reader.read_imports("example.tsx")).toEqual([
      { line: 1, specifier: "./a" },
      { line: 2, specifier: "./side-effect" },
      { line: 3, specifier: "./lazy" },
      { line: 4, specifier: "./b" },
      { line: 5, specifier: "./all" },
      { line: 6, specifier: "./named" },
      { line: 7, specifier: "./view" },
    ]);
  });

  it("忽略说明和注释中的 import 示例，识别模板表达式内的真实导入", () => {
    const source = [
      `const description = 'await import("node:fs/promises")';`,
      '// import "node:fs";',
      'const text = `example import("ignored") ${await import("./actual")}`;',
      "const computed = import(module_name);",
    ].join("\n");
    expect(create_source_reader(() => source).read_imports("example.mjs")).toEqual([
      { line: 3, specifier: "./actual" },
    ]);
  });

  it("解析失败携带源码位置和原始诊断，阻止使用部分导入结果", () => {
    const reader = create_source_reader(() => 'import "./valid"; const 前缀 = "😀";\r\nconst =');
    expect(() => reader.read_imports("broken.ts")).toThrow(
      expect.objectContaining({
        name: "SyntaxError",
        message: expect.stringContaining("broken.ts:2:7"),
        cause: expect.any(Array),
      }),
    );
  });
});
