import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { run_boundary_rules } from "./core.mjs";
import { create_frontend_boundary_rules } from "./frontend-rules.mjs";

describe("前端边界规则", () => {
  it("允许 renderer 通过 desktop-api 和 GUI 契约白名单接入外部边界", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(
        project_root,
        "src/frontend/app/desktop/desktop-api.ts",
        `
          import { normalize_backend_api_base_url } from "@backend/api/api-base-url";
          export async function api_fetch() {
            return fetch(normalize_backend_api_base_url("http://127.0.0.1:1"));
          }
          export function open_event_stream(url) {
            return new EventSource(url);
          }
        `,
      );
      write_project_file(
        project_root,
        "src/frontend/app/index.tsx",
        `
          import type { DesktopShellInfo } from "@gui/bridge-types";
          export function App(props: { shell: DesktopShellInfo }) {
            // 中文注释不是用户可见文本，不应触发 i18n 门闩。
            return <main>{props.shell.platform}</main>;
          }
        `,
      );
      write_project_file(
        project_root,
        "src/frontend/app/state/desktop-state-context.tsx",
        `
          const [project_snapshot, write_project_snapshot] = useState({});
          const [settings_snapshot, write_settings_snapshot] = useState({});
          task_snapshot_store_ref.current.applySnapshot(snapshot);
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
        "src/frontend/pages/bad-page.tsx",
        `
          import fs from "node:fs";
          import { shell } from "electron";
          import { NativeFs } from "../../native/native-fs";
          import { ApiGatewayServer } from "../../backend/api/api-gateway-server";
          import { create_main_window } from "../../gui/shell/desktop-window-host";

          export function BadPage() {
            const write_project_snapshot = () => {};
            write_project_snapshot();
            task_store.applySnapshot(next_snapshot);
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
      expect(messages).toContain("renderer 不能读取 native 实现");
      expect(messages).toContain("renderer 不能通过相对路径访问后端内部实现");
      expect(messages).toContain("renderer 读取 GUI 宿主契约必须使用 @gui/* 白名单别名");
      expect(messages).toContain("renderer 访问后端 API 必须先收口到 desktop-api.ts");
      expect(messages).toContain(
        "共享 project/settings snapshot 裸 setter 只能留在 DesktopStateProvider 内部",
      );
      expect(messages).toContain(
        "TaskSnapshotStore.applySnapshot 只能由 DesktopStateProvider 同步后端 task 载荷",
      );
      expect(messages).toContain("JSX 可见属性文案必须从 src/shared/i18n 解析");
      expect(messages).toContain("JSX 可见中文文案必须从 src/shared/i18n 解析");
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("拦截 frontend 废弃技术分组目录回潮", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(
        project_root,
        "src/frontend/hooks/use-legacy.ts",
        `
          export function useLegacy() {}
        `,
      );
      write_project_file(
        project_root,
        "src/frontend/lib/misc.ts",
        `
          export const misc = {};
        `,
      );

      const messages = run_frontend_rules(project_root).map((error) => error.message);

      expect(messages).toContain(
        "src/frontend/hooks 是已废弃按技术形态分组目录；请按所有权放入 widgets/interactions、app/state、pages 或 shared",
      );
      expect(messages).toContain(
        "src/frontend/lib 是已废弃通用工具桶；请按所有权放入 app、widgets、ui、pages 或 shared",
      );
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("拦截 widgets interactions 越权访问 app 和桌面 API", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(
        project_root,
        "src/frontend/widgets/interactions/use-bad-action.ts",
        `
          import { api_fetch } from "@frontend/app/desktop/desktop-api";
          export function useBadAction() {
            void api_fetch("/api/health");
            fetch("/api/health");
            window.desktopApp.quitApp();
          }
        `,
      );

      const messages = run_frontend_rules(project_root).map((error) => error.message);

      expect(messages).toContain(
        "widgets/interactions 只能承接通用 UI 交互行为，不能依赖 app 运行态或页面领域",
      );
      expect(messages).toContain(
        "widgets/interactions 不能接触桌面桥、后端 API 或 SSE；请把能力收口到 app/desktop 或 app/state",
      );
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("拦截 renderer token 和 rem 尺寸越权", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(project_root, "src/frontend/index.css", ":root { --ui-accent: #f97316; }");
      write_project_file(
        project_root,
        "src/frontend/pages/bad-page.css",
        `
          .bad-page {
            --ui-local: #fff;
            width: 1rem;
          }
        `,
      );

      const messages = run_frontend_rules(project_root).map((error) => error.message);

      expect(messages).toContain(
        "违规则使用了 rem 尺寸字面量；请改用 px，或回到 DESIGN.md 判断是否需要沉淀新的长期设计语义",
      );
      expect(messages).toContain("违规定义了 --ui-* token，请改到 src/frontend/index.css");
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });

  it("拦截 renderer 圆角语义字面量回潮", () => {
    const project_root = create_temp_project();
    try {
      write_project_file(
        project_root,
        "src/frontend/pages/bad-radius.css",
        `
          .bad-card {
            border-radius: 4px;
          }
          .bad-button {
            border-radius: 8px;
          }
          .bad-pill {
            border-radius: 999px;
          }
        `,
      );
      write_project_file(
        project_root,
        "src/frontend/shadcn/bad-radius.tsx",
        `
          export const badRadiusClassName = "rounded-4xl rounded-[4px] rounded-[8px] rounded-[999px]";
        `,
      );
      write_project_file(
        project_root,
        "src/frontend/widgets/good-radius.css",
        `
          .good-card {
            border-radius: var(--ui-radius-card);
          }
          .good-button {
            border-radius: var(--ui-radius-button);
          }
          .good-pill {
            border-radius: var(--ui-radius-pill);
          }
          .good-geometry {
            border-radius: 2px;
          }
        `,
      );

      const errors = run_frontend_rules(project_root).filter((error) => {
        return error.rule_name === "renderer 圆角语义边界";
      });

      expect(errors).toHaveLength(7);
      expect(new Set(errors.map((error) => error.message))).toEqual(
        new Set([
          "违规则使用了圆角语义字面量；请改用 --ui-radius-card、--ui-radius-button 或 --ui-radius-pill",
        ]),
      );
      expect(errors.map((error) => error.relative_path)).toEqual([
        "src/frontend/pages/bad-radius.css",
        "src/frontend/pages/bad-radius.css",
        "src/frontend/pages/bad-radius.css",
        "src/frontend/shadcn/bad-radius.tsx",
        "src/frontend/shadcn/bad-radius.tsx",
        "src/frontend/shadcn/bad-radius.tsx",
        "src/frontend/shadcn/bad-radius.tsx",
      ]);
    } finally {
      rmSync(project_root, { force: true, recursive: true });
    }
  });
});

function run_frontend_rules(project_root) {
  return run_boundary_rules({
    project_root,
    roots: [path.join(project_root, "src/frontend")],
    rules: create_frontend_boundary_rules(),
  });
}

function create_temp_project() {
  return mkdtempSync(path.join(os.tmpdir(), "linguagacha-check-frontend-"));
}

// 每个用例写独立临时文件，保证规则只验证当前 Arrange 场景。
function write_project_file(project_root, relative_path, content) {
  const file_path = path.join(project_root, relative_path);
  mkdirSync(path.dirname(file_path), { recursive: true });
  writeFileSync(file_path, content, "utf8");
}
