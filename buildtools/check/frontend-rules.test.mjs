import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_frontend_boundary_rules } from "./frontend-rules.mjs";

const EXPECTED_RULE_NAMES = new Set([
  "frontend interactions 所有权边界",
  "frontend page 所有权边界",
  "frontend 旧混合目录边界",
  "renderer px-first 尺寸边界",
  "renderer 共享状态写入口边界",
  "renderer 可见文案边界",
  "renderer 圆角语义边界",
  "renderer 全局 token 边界",
  "renderer 导入边界",
  "后端 API 接入边界",
]);

describe("frontend boundary rules", () => {
  it("每条 renderer 边界都能从公开规则入口报告对应违规", () => {
    const errors = run_rules({
      "src/frontend/hooks/legacy.ts": 'import "electron";',
      "src/frontend/pages/alpha/page.tsx": [
        'import "@frontend/pages/beta/page";',
        'import { Button } from "@frontend/shadcn/button";',
        "write_project_snapshot(next);",
        "fetch('/api/direct');",
        "export const Page = () => <div>可见中文</div>;",
      ].join("\n"),
      "src/frontend/pages/alpha/style.css": [
        ".card {",
        "  --ui-local: red;",
        "  border-radius: 8px;",
        "  width: 1rem;",
        "}",
      ].join("\n"),
      "src/frontend/widgets/interactions/action.ts": "api_fetch('/api/direct');",
    });

    expect(new Set(errors.map((error) => error.rule_name))).toEqual(EXPECTED_RULE_NAMES);
    expect(errors.every((error) => error.relative_path.startsWith("src/frontend/"))).toBe(true);
  });

  it("允许桌面 API、全局 token 所有者和同页实现使用各自合法入口", () => {
    expect(
      run_rules({
        "src/frontend/app/desktop/desktop-api.ts": [
          'import type { DesktopBridgeApi } from "@gui/bridge-api";',
          "export const request = () => fetch('/api/ok');",
        ].join("\n"),
        "src/frontend/index.css": ":root { --ui-accent: red; }",
        "src/frontend/pages/alpha/page.test.tsx": [
          'import "electron";',
          "export const fixture = <div>测试中文</div>;",
        ].join("\n"),
        "src/frontend/pages/alpha/page.tsx": [
          'import "./types";',
          "export const Page = () => <div>{t('page.title')}</div>;",
        ].join("\n"),
        "src/frontend/widgets/app-button.tsx": 'import { Button } from "@frontend/shadcn/button";',
        "src/frontend/shadcn/sheet.tsx": 'import { Button } from "@frontend/shadcn/button";',
      }),
    ).toEqual([]);
  });
});

function run_rules(files) {
  const project_root = path.resolve("boundary-test-project");
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

  return create_frontend_boundary_rules().flatMap((rule) =>
    rule.check(context).map((error) => ({ rule_name: rule.name, ...error })),
  );
}
