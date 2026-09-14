import path from "node:path";

import { describe, expect, it } from "vitest";

import { create_check_context } from "./core.mjs";
import { create_source_reader } from "./source-reader.mjs";
import { create_frontend_boundary_rules } from "./frontend-rules.mjs";

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

    expect(
      errors.map(({ relative_path, line }) => `${relative_path}:${line ?? "-"}`).sort(),
    ).toEqual(
      [
        "src/frontend/hooks/legacy.ts:-",
        "src/frontend/hooks/legacy.ts:1",
        "src/frontend/pages/alpha/page.tsx:1",
        "src/frontend/pages/alpha/page.tsx:2",
        "src/frontend/pages/alpha/page.tsx:3",
        "src/frontend/pages/alpha/page.tsx:4",
        "src/frontend/pages/alpha/page.tsx:5",
        "src/frontend/pages/alpha/style.css:2",
        "src/frontend/pages/alpha/style.css:3",
        "src/frontend/pages/alpha/style.css:4",
        "src/frontend/widgets/interactions/action.ts:1",
      ].sort(),
    );
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

/** 用内存源码执行真实规则，避免测试依赖当前工作区内容。 */
function run_rules(files) {
  const project_root = path.resolve("boundary-test-project");
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

  return create_frontend_boundary_rules().flatMap((rule) => rule.check(context));
}
