import path from "node:path";

import {
  find_pattern_errors,
  is_test_file,
  is_typescript_source,
  resolve_relative_specifier,
  to_relative_path,
} from "./core.mjs";

const ALLOWED_GUI_CONTRACT_IMPORTS = new Set([
  "@gui/bridge-api",
  "@gui/bridge-types",
  "@backend/api/api-base-url",
  "@gui/ipc-contract",
  "@gui/shell-contract",
]);

const DESKTOP_API_RELATIVE_PATH = "src/frontend/app/desktop/desktop-api.ts";
const TOKEN_OWNER_RELATIVE_PATH = "src/frontend/index.css";
const APP_BUTTON_RELATIVE_PATH = "src/frontend/widgets/app-button.tsx";
const PX_FIRST_SCOPE_PREFIXES = [
  "src/frontend/app/",
  "src/frontend/features/",
  "src/frontend/pages/",
  "src/frontend/widgets/",
];
const RENDERER_RADIUS_SCOPE_PREFIXES = [
  "src/frontend/app/",
  "src/frontend/features/",
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
    create_frontend_page_ownership_rule(),
    create_frontend_interactions_boundary_rule(),
    create_desktop_api_boundary_rule(),
    create_desktop_runtime_snapshot_write_rule(),
    create_renderer_visible_text_rule(),
    create_renderer_px_first_literal_rule(),
    create_renderer_radius_literal_rule(),
    create_renderer_token_owner_rule(),
  ];
}

/** 限制旧技术分类目录回流，前端实现按业务所有权落位。 */
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
              "src/frontend/hooks 是已废弃按技术形态分组目录；请按所有权放入 widgets/interactions、app/state、features、pages 或 shared",
            relative_path,
          });
        }
        if (relative_path.startsWith("src/frontend/lib/")) {
          errors.push({
            message:
              "src/frontend/lib 是已废弃通用工具桶；请按所有权放入 app、features、widgets、ui、pages 或 shared",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

/**
 * 页面只能读取自己的私有实现，features 作为跨页面所有者也不能反向依赖 pages。
 */
function create_frontend_page_ownership_rule() {
  return {
    name: "frontend page 所有权边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const relative_path = context.relative_path(file_path);
        const source_page_owner = resolve_page_owner(context.project_root, file_path);
        const is_feature = relative_path.startsWith("src/frontend/features/");

        if (source_page_owner === null && !is_feature) {
          continue;
        }

        for (const import_entry of context.read_imports(file_path)) {
          const target_page_owner = resolve_imported_page_owner(
            context.project_root,
            file_path,
            import_entry.specifier,
          );
          if (target_page_owner === null) {
            continue;
          }

          if (is_feature) {
            errors.push({
              line: import_entry.line,
              message: "features 不能反向依赖 pages；跨页面能力只能由页面消费",
              relative_path,
            });
          } else if (target_page_owner !== source_page_owner) {
            errors.push({
              line: import_entry.line,
              message: "页面实现属于当前页面私有；跨页面能力请移入 features",
              relative_path,
            });
          }
        }
      }
      return errors;
    },
  };
}

/** 通用交互层只处理 UI 行为，宿主通信与共享运行态由消费方注入。 */
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
        for (const import_entry of context.read_imports(file_path)) {
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

/** 统一检查包名、别名和相对路径，防止通过不同写法越过宿主边界。 */
function create_renderer_import_boundary_rule() {
  return {
    name: "renderer 导入边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of context.read_imports(file_path)) {
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

/** 后端请求与 SSE 统一经桌面 API 入口管理。 */
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

/** JSX 正文和可见属性共用 i18n 文案约束。 */
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

/** 产品布局范围使用 px 尺寸，基础控件按自身样式策略维护。 */
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
          return "违规则使用了 rem 尺寸字面量；请改用 px，或依据当前任务设计输入与既有界面证据判断是否需要新的尺寸语义";
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

/** 产品圆角消费语义 token，测试夹具按统一后缀排除。 */
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

/** 全局 token 定义只由入口样式持有。 */
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

/** 排除注释示例并保留行结构，诊断仍指向原始源码。 */
function strip_comments_preserving_lines(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\r\n]/g, " "))
    .replace(/(^|[^:])\/\/.*$/gm, (match, prefix) => {
      return `${prefix}${" ".repeat(match.length - prefix.length)}`;
    });
}

/** 别名约束先于相对路径解析，避免包名提前返回绕过产品入口。 */
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

  if (
    specifier === "@frontend/shadcn/button" &&
    to_relative_path(project_root, file_path) !== APP_BUTTON_RELATIVE_PATH &&
    !to_relative_path(project_root, file_path).startsWith("src/frontend/shadcn/")
  ) {
    return "业务 renderer 只能通过 widgets/app-button.tsx 使用产品按钮入口";
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

// 别名和相对导入必须落到同一 page owner 口径，避免换一种路径写法绕过边界。
function resolve_imported_page_owner(project_root, file_path, specifier) {
  const alias_prefix = "@frontend/pages/";
  if (specifier.startsWith(alias_prefix)) {
    return specifier.slice(alias_prefix.length).split("/")[0] ?? null;
  }

  const resolved_path = resolve_relative_specifier(file_path, specifier);
  return resolved_path === null ? null : resolve_page_owner(project_root, resolved_path);
}

// page owner 是 pages 下第一层目录名；目录外文件没有页面所有权。
function resolve_page_owner(project_root, file_path) {
  const pages_root = path.join(project_root, "src/frontend/pages");
  if (!is_inside(file_path, pages_root)) {
    return null;
  }

  const [page_owner] = path.relative(pages_root, file_path).split(path.sep);
  return page_owner === undefined || page_owner === "" ? null : page_owner;
}

/** 前端生产源码参与边界检查，测试夹具不作为产品依赖。 */
function is_frontend_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    file_path.includes(`${path.sep}src${path.sep}frontend${path.sep}`) &&
    !is_test_file(file_path)
  );
}

/** 可见文案规则只检查承载 JSX 的生产文件。 */
function is_frontend_production_tsx(file_path) {
  return file_path.endsWith(".tsx") && is_frontend_production_source(file_path);
}

/** 尺寸规则覆盖产品布局和全局样式入口。 */
function is_px_first_literal_scope(relative_path) {
  return (
    relative_path === TOKEN_OWNER_RELATIVE_PATH ||
    PX_FIRST_SCOPE_PREFIXES.some((prefix) => relative_path.startsWith(prefix))
  );
}

/** 圆角规则覆盖产品与基础控件源码，排除测试。 */
function is_renderer_radius_semantic_scope(relative_path, file_path) {
  return (
    !is_test_file(file_path) &&
    /\.(css|ts|tsx)$/.test(file_path) &&
    RENDERER_RADIUS_SCOPE_PREFIXES.some((prefix) => relative_path.startsWith(prefix))
  );
}

/** 以目录边界判断归属，同时排除跨盘与父目录路径。 */
function is_inside(file_path, directory_path) {
  const relative_path = path.relative(directory_path, file_path);
  return (
    relative_path === "" || (!relative_path.startsWith("..") && !path.isAbsolute(relative_path))
  );
}
