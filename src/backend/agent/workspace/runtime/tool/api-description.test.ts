import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { format_agent_workspace_typescript_api } from "./api-description";
import { AGENT_WORKSPACE_DATA_TOOLS } from "./registry";

describe("Agent Workspace 工具说明投影", () => {
  it("TypeScript API 在 ws.tool 下公开完整数据工具与 HTML 工具", () => {
    const api = format_agent_workspace_typescript_api();
    const method_names = [...api.matchAll(/^ {4}([A-Za-z_$][A-Za-z0-9_$]*)\(args:/gmu)].map(
      (match) => match[1],
    );

    expect(new Set(method_names)).toEqual(new Set(Object.keys(AGENT_WORKSPACE_DATA_TOOLS)));
    expect(api).toContain("htmlToMarkdown(html: string");
    expect(api).toContain("streamHtmlToMarkdown(");
  });

  it("生成声明保留开放对象的必填字段、联合分支与可执行调用类型", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-api-types-"));
    try {
      const file = path.join(directory, "api.ts");
      fs.writeFileSync(
        file,
        `${format_agent_workspace_typescript_api()}
const glossary = ws.tool.groupQualityRuleEntries({ kind: "glossary", entries: [{ id: "a", src: "A", case_sensitive: false, info: "full record" }] });
const preserve = ws.tool.groupQualityRuleEntries({ kind: "text_preserve", entries: [{ id: "a", src: "A" }] });
// @ts-expect-error glossary entries require case_sensitive
ws.tool.groupQualityRuleEntries({ kind: "glossary", entries: [{ id: "a", src: "A" }] });
// @ts-expect-error entry identity is required
ws.tool.groupQualityRuleEntries({ kind: "text_preserve", entries: [{ src: "A" }] });
ws.tool.queryItemContexts({ item_ids: [1] }).then(result => result.items[0]?.src);
ws.tool.matchLiterals({ patterns: [{ key: "a", text: "A", case_sensitive: false, offset: 1 }], examples_per_pattern: 2 }).then(result => {
  const next: number | null = result.patterns[0]!.next_offset;
});
`,
      );
      execFileSync(
        process.execPath,
        [
          path.resolve("node_modules/typescript/lib/tsc.js"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--target",
          "ESNext",
          "--lib",
          "ESNext,DOM",
          file,
        ],
        { windowsHide: true },
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
