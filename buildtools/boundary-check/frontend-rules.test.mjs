import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { run_boundary_rules } from "./core.mjs";
import { create_frontend_boundary_rules } from "./frontend-rules.mjs";

describe("frontend boundary rules", () => {
  it("允许 renderer 通过 desktop-api 和 native 根契约白名单接入外部边界", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(
        project_root,
        "src/renderer/app/desktop/desktop-api.ts",
        `
          import { normalize_core_api_base_url } from "@native/core-api-endpoint";
          export async function api_fetch() {
            return fetch(normalize_core_api_base_url("http://127.0.0.1:1"));
          }
          export function open_event_stream(url) {
            return new EventSource(url);
          }
        `,
      );
      write_project_file(
        project_root,
        "src/renderer/app/index.tsx",
        `
          import type { DesktopShellInfo } from "@native/bridge-types";
          export function App(props: { shell: DesktopShellInfo }) {
            // 中文注释不是用户可见文本，不应触发 i18n 门闩。
            return <main>{props.shell.platform}</main>;
          }
        `,
      );

      expect(run_frontend_rules(project_root)).toEqual([]);
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("拦截 renderer 绕过宿主桥接、desktop-api 和 i18n 的行为", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(
        project_root,
        "src/renderer/pages/bad-page.tsx",
        `
          import fs from "node:fs";
          import { shell } from "electron";
          import { NativeFs } from "../../native/platform/native-fs";
          import { ApiGatewayServer } from "../../main/api/api-gateway-server";

          export function BadPage() {
            fetch("/api/health");
            return <button title="打开工程">开始</button>;
          }
        `,
      );

      const messages = run_frontend_rules(project_root).map((error) => error.message);

      expect(messages).toContain("renderer 不能直接导入 Node 能力，只能通过 preload 暴露的窄桥接");
      expect(messages).toContain(
        "renderer 不能直接导入 Electron，只能通过 window.desktopApp 接入宿主能力",
      );
      expect(messages).toContain("renderer 不能读取 native platform/shell 实现");
      expect(messages).toContain("renderer 不能通过相对路径访问 main 内部实现");
      expect(messages).toContain("renderer 访问 Core API 必须先收口到 desktop-api.ts");
      expect(messages).toContain("JSX 可见属性文案必须从 src/shared/i18n 解析");
      expect(messages).toContain("JSX 可见中文文案必须从 src/shared/i18n 解析");
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });
});

function run_frontend_rules(project_root) {
  return run_boundary_rules({
    project_root,
    roots: [path.join(project_root, "src/renderer")],
    rules: create_frontend_boundary_rules(),
  });
}

function create_temp_project() {
  return mkdtempSync(path.join(os.tmpdir(), "linguagacha-boundary-frontend-"));
}

// 每个用例写独立临时文件，保证规则只验证当前 Arrange 场景。
function write_project_file(project_root, relative_path, content) {
  const file_path = path.join(project_root, relative_path);
  mkdirSync(path.dirname(file_path), { recursive: true });
  writeFileSync(file_path, content, "utf8");
}
