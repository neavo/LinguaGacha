import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { format_agent_workspace_typescript_api } from "./api-description";
import { AGENT_WORKSPACE_DATA_TOOLS } from "./registry";

describe("Agent Workspace 工具说明投影", () => {
  it("生成 API 覆盖注册表中的全部数据工具", () => {
    const api = format_agent_workspace_typescript_api();
    const method_names = [...api.matchAll(/^ {4}([A-Za-z_$][A-Za-z0-9_$]*)\(args:/gmu)].map(
      (match) => match[1],
    );

    expect(new Set(method_names)).toEqual(new Set(Object.keys(AGENT_WORKSPACE_DATA_TOOLS)));
  });

  it("生成声明保留开放对象的必填字段、联合分支与可执行调用类型", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-api-types-"));
    try {
      const file = path.join(directory, "api.ts");
      fs.writeFileSync(
        file,
        `${format_agent_workspace_typescript_api()}
import type { AgentWorkspaceHtmlTools } from ${JSON.stringify(path.resolve("src/backend/agent/workspace/runtime/tool/html-to-markdown").replaceAll("\\", "/"))};
// 两个方向均可赋值，保证手写流接口声明与实际运行时类型保持一致。
declare const runtimeHtml: AgentWorkspaceHtmlTools;
const modelHtml: WorkspaceHtmlTools = runtimeHtml;
const checkedRuntimeHtml: AgentWorkspaceHtmlTools = ws.tool;
// @ts-expect-error selector 参数必须是字符串数组
ws.tool.htmlToMarkdown("<p>text</p>", { include: "p" });
const glossary = ws.tool.groupQualityRuleEntries({ kind: "glossary", entries: [{ id: "a", src: "A", case_sensitive: false, info: "full record" }] });
const preserve = ws.tool.groupQualityRuleEntries({ kind: "text_preserve", entries: [{ id: "a", src: "A" }] });
// @ts-expect-error glossary entries require case_sensitive
ws.tool.groupQualityRuleEntries({ kind: "glossary", entries: [{ id: "a", src: "A" }] });
// @ts-expect-error entry identity is required
ws.tool.groupQualityRuleEntries({ kind: "text_preserve", entries: [{ src: "A" }] });
ws.tool.queryItemContexts({ item_ids: [1] }).then(result => result.items[0]?.src);
ws.tool.matchLiterals({ patterns: [{ key: "a", text: "A", case_sensitive: false }], max_matches_per_pattern: 2 }).then(result => {
  const complete: boolean = result.patterns[0]!.matches_complete;
  const itemId: number | undefined = result.patterns[0]!.matches[0]?.item_id;
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
          "--module",
          "ESNext",
          "--moduleResolution",
          "bundler",
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
