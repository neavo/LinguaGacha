import path from "node:path";

import {
  find_import_specifiers,
  find_pattern_errors,
  is_test_file,
  is_typescript_source,
  resolve_relative_specifier,
} from "./core.mjs";

const ALLOWED_GUI_CONTRACT_IMPORTS = new Set([
  "@gui/bridge-api",
  "@gui/bridge-types",
  "@backend/api/api-base-url",
  "@gui/external-url-policy",
  "@gui/ipc-contract",
  "@gui/shell-contract",
]);

const DESKTOP_API_RELATIVE_PATH = "src/frontend/app/desktop/desktop-api.ts";
const TOKEN_OWNER_RELATIVE_PATH = "src/frontend/index.css";
const PX_FIRST_SCOPE_PREFIXES = [
  "src/frontend/app/",
  "src/frontend/pages/",
  "src/frontend/widgets/",
];
const RENDERER_RADIUS_SCOPE_PREFIXES = [
  "src/frontend/app/",
  "src/frontend/pages/",
  "src/frontend/widgets/",
  "src/frontend/shadcn/",
];

const JSX_VISIBLE_TEXT_PATTERN = />[^<>{]*\p{Script=Han}[^<>{]*</gu;
const JSX_VISIBLE_PROP_PATTERN =
  /\b(?:title|aria-label|placeholder|alt|label|description)\s*=\s*["'][^"']*\p{Script=Han}[^"']*["']/gu;
const RENDERER_RADIUS_LITERAL_PATTERN =
  /\bborder-radius\s*:\s*(?:4px|8px|999px)\b|rounded-(?:4xl|\[(?:4px|8px|999px)\])/g;

// DesktopStateContext 是渲染进程 project change 运行态的唯一落点。
const DESKTOP_STATE_CONTEXT_RELATIVE_PATH = "src/frontend/app/state/desktop-state-context.tsx";
// TaskSnapshotStore 是渲染进程 task snapshot 运行态的唯一落点。
const TASK_SNAPSHOT_STORE_RELATIVE_PATH = "src/frontend/app/state/task-snapshot-store.ts";

/**
 * 前端边界规则只表达可稳定静态判定的渲染进程约束。
 */
export function create_frontend_boundary_rules() {
  return [
    create_legacy_frontend_project_directory_rule(),
    create_renderer_import_boundary_rule(),
    create_frontend_interactions_boundary_rule(),
    create_desktop_api_boundary_rule(),
    create_desktop_runtime_snapshot_write_rule(),
    create_renderer_visible_text_rule(),
    create_renderer_px_first_literal_rule(),
    create_renderer_radius_literal_rule(),
    create_renderer_token_owner_rule(),
  ];
}

function create_legacy_frontend_project_directory_rule() {
  return {
    name: "frontend 旧混合目录边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files) {
        const relative_path = context.relative_path(file_path);
        if (relative_path.startsWith("src/frontend/hooks/")) {
          errors.push({
            message:
              "src/frontend/hooks 是已废弃按技术形态分组目录；请按所有权放入 widgets/interactions、app/state、pages 或 shared",
            relative_path,
          });
        }
        if (relative_path.startsWith("src/frontend/lib/")) {
          errors.push({
            message:
              "src/frontend/lib 是已废弃通用工具桶；请按所有权放入 app、widgets、ui、pages 或 shared",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_frontend_interactions_boundary_rule() {
  return {
    name: "frontend interactions 所有权边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const relative_path = context.relative_path(file_path);
        if (!relative_path.startsWith("src/frontend/widgets/interactions/")) {
          continue;
        }
        const content = context.read_file(file_path);
        for (const import_entry of find_import_specifiers(content)) {
          if (
            import_entry.specifier.startsWith("@frontend/app/") ||
            import_entry.specifier.startsWith("@frontend/pages/")
          ) {
            errors.push({
              line: import_entry.line,
              message:
                "widgets/interactions 只能承接通用 UI 交互行为，不能依赖 app 运行态或页面领域",
              relative_path,
            });
          }
        }
        const matches = find_pattern_errors(
          content,
          /\b(?:window\.desktopApp|api_fetch|fetch\s*\(|new\s+EventSource\s*\()/g,
          () => {
            return "widgets/interactions 不能接触桌面桥、后端 API 或 SSE；请把能力收口到 app/desktop 或 app/state";
          },
        );
        for (const match of matches) {
          errors.push({
            ...match,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_renderer_import_boundary_rule() {
  return {
    name: "renderer 导入边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const content = context.read_file(file_path);
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(content)) {
          const message = validate_renderer_import(
            context.project_root,
            file_path,
            import_entry.specifier,
          );
          if (message === null) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_desktop_api_boundary_rule() {
  return {
    name: "后端 API 接入边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const relative_path = context.relative_path(file_path);
        if (relative_path === DESKTOP_API_RELATIVE_PATH) {
          continue;
        }
        const content = context.read_file(file_path);
        const matches = find_pattern_errors(
          content,
          /\b(?:fetch\s*\(|new\s+EventSource\s*\()/g,
          () => {
            return "renderer 访问后端 API 必须先收口到 desktop-api.ts";
          },
        );
        for (const match of matches) {
          errors.push({
            ...match,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

/**
 * 共享 snapshot 的私有写入口只留在运行态内部，页面只能消费受控同步函数。
 */
function create_desktop_runtime_snapshot_write_rule() {
  return {
    name: "renderer 共享状态写入口边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const relative_path = context.relative_path(file_path);
        const content = context.read_file(file_path);
        if (relative_path !== DESKTOP_STATE_CONTEXT_RELATIVE_PATH) {
          const matches = find_pattern_errors(
            content,
            /\bwrite_(?:project|settings)_snapshot\b/g,
            () => {
              return "共享 project/settings snapshot 裸 setter 只能留在 DesktopStateProvider 内部";
            },
          );
          for (const match of matches) {
            errors.push({
              ...match,
              relative_path,
            });
          }
        }

        if (
          relative_path !== DESKTOP_STATE_CONTEXT_RELATIVE_PATH &&
          relative_path !== TASK_SNAPSHOT_STORE_RELATIVE_PATH
        ) {
          const matches = find_pattern_errors(content, /\.applySnapshot\s*\(/g, () => {
            return "TaskSnapshotStore.applySnapshot 只能由 DesktopStateProvider 同步后端 task 载荷";
          });
          for (const match of matches) {
            errors.push({
              ...match,
              relative_path,
            });
          }
        }
      }
      return errors;
    },
  };
}

function create_renderer_visible_text_rule() {
  return {
    name: "renderer 可见文案边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_tsx)) {
        const content = strip_comments_preserving_lines(context.read_file(file_path));
        const relative_path = context.relative_path(file_path);
        const matches = [
          ...find_pattern_errors(content, JSX_VISIBLE_TEXT_PATTERN, () => {
            return "JSX 可见中文文案必须从 src/shared/i18n 解析";
          }),
          ...find_pattern_errors(content, JSX_VISIBLE_PROP_PATTERN, () => {
            return "JSX 可见属性文案必须从 src/shared/i18n 解析";
          }),
        ];
        for (const match of matches) {
          errors.push({
            ...match,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_renderer_px_first_literal_rule() {
  return {
    name: "renderer px-first 尺寸边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files) {
        const relative_path = context.relative_path(file_path);
        if (!is_px_first_literal_scope(relative_path)) {
          continue;
        }
        const content = context.read_file(file_path);
        const matches = find_pattern_errors(content, /\d+(?:\.\d+)?rem\b/g, () => {
          return "违规则使用了 rem 尺寸字面量；请改用 px，或回到 DESIGN.md 判断是否需要沉淀新的长期设计语义";
        });
        for (const match of matches) {
          errors.push({
            ...match,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_renderer_radius_literal_rule() {
  return {
    name: "renderer 圆角语义边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files) {
        const relative_path = context.relative_path(file_path);
        if (!is_renderer_radius_semantic_scope(relative_path, file_path)) {
          continue;
        }
        const content = context.read_file(file_path);
        const matches = find_pattern_errors(content, RENDERER_RADIUS_LITERAL_PATTERN, () => {
          return "违规则使用了圆角语义字面量；请改用 --ui-radius-card、--ui-radius-button 或 --ui-radius-pill";
        });
        for (const match of matches) {
          errors.push({
            ...match,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_renderer_token_owner_rule() {
  return {
    name: "renderer 全局 token 边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files) {
        const relative_path = context.relative_path(file_path);
        if (relative_path === TOKEN_OWNER_RELATIVE_PATH) {
          continue;
        }
        const content = context.read_file(file_path);
        const matches = find_pattern_errors(content, /--ui-[a-z0-9-]+\s*:/g, () => {
          return `违规定义了 --ui-* token，请改到 ${TOKEN_OWNER_RELATIVE_PATH}`;
        });
        for (const match of matches) {
          errors.push({
            ...match,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function strip_comments_preserving_lines(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (match, prefix) => {
      return `${prefix}${" ".repeat(match.length - prefix.length)}`;
    });
}

function validate_renderer_import(project_root, file_path, specifier) {
  if (specifier === "electron" || specifier.startsWith("electron/")) {
    return "renderer 不能直接导入 Electron，只能通过 window.desktopApp 接入宿主能力";
  }
  if (specifier.startsWith("node:")) {
    return "renderer 不能直接导入 Node 能力，只能通过 preload 暴露的窄桥接";
  }
  if (specifier.startsWith("@native/")) {
    return "renderer 不再通过 @native 读取桌面契约；请使用 @gui/* 或 @backend/api/api-base-url 白名单";
  }
  if (specifier.startsWith("@gui/") && !ALLOWED_GUI_CONTRACT_IMPORTS.has(specifier)) {
    return "renderer 只能通过 @gui/* 白名单读取桌面宿主契约";
  }
  if (specifier.startsWith("@backend/") && specifier !== "@backend/api/api-base-url") {
    return "renderer 只能通过 @backend/api/api-base-url 读取后端 API 地址契约";
  }

  const resolved_path = resolve_relative_specifier(file_path, specifier);
  if (resolved_path === null) {
    return null;
  }

  const backend_root = path.join(project_root, "src/backend");
  const gui_root = path.join(project_root, "src/gui");
  const preload_root = path.join(project_root, "src/gui/preload");
  const native_root = path.join(project_root, "src/native");

  if (is_inside(resolved_path, backend_root)) {
    return "renderer 不能通过相对路径访问后端内部实现";
  }
  if (is_inside(resolved_path, preload_root)) {
    return "renderer 不能通过相对路径访问 preload 实现";
  }
  if (is_inside(resolved_path, gui_root)) {
    return "renderer 读取 GUI 宿主契约必须使用 @gui/* 白名单别名";
  }
  if (is_inside(resolved_path, native_root)) {
    return "renderer 不能读取 native 实现";
  }

  return null;
}

function is_frontend_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    file_path.includes(`${path.sep}src${path.sep}frontend${path.sep}`) &&
    !is_test_file(file_path)
  );
}

function is_frontend_production_tsx(file_path) {
  return file_path.endsWith(".tsx") && is_frontend_production_source(file_path);
}

function is_px_first_literal_scope(relative_path) {
  return (
    relative_path === TOKEN_OWNER_RELATIVE_PATH ||
    PX_FIRST_SCOPE_PREFIXES.some((prefix) => relative_path.startsWith(prefix))
  );
}

function is_renderer_radius_semantic_scope(relative_path, file_path) {
  return (
    !is_test_file(file_path) &&
    /\.(css|ts|tsx)$/.test(file_path) &&
    RENDERER_RADIUS_SCOPE_PREFIXES.some((prefix) => relative_path.startsWith(prefix))
  );
}

function is_inside(file_path, directory_path) {
  const relative_path = path.relative(directory_path, file_path);
  return (
    relative_path === "" || (!relative_path.startsWith("..") && !path.isAbsolute(relative_path))
  );
}
