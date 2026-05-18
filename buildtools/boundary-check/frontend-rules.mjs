import path from "node:path";

import {
  find_import_specifiers,
  find_pattern_errors,
  is_test_file,
  is_typescript_source,
  resolve_relative_specifier,
} from "./core.mjs";

const ALLOWED_NATIVE_CONTRACT_IMPORTS = new Set([
  "@native/bridge-api",
  "@native/bridge-types",
  "@native/core-api-endpoint",
  "@native/external-url-policy",
  "@native/ipc-contract",
  "@native/shell-contract",
]);

const DESKTOP_API_RELATIVE_PATH = "src/renderer/app/desktop/desktop-api.ts";
const TOKEN_OWNER_RELATIVE_PATH = "src/renderer/index.css";
const PX_FIRST_SCOPE_PREFIXES = [
  "src/renderer/app/",
  "src/renderer/pages/",
  "src/renderer/widgets/",
];

const JSX_VISIBLE_TEXT_PATTERN = />[^<>{]*\p{Script=Han}[^<>{]*</gu;
const JSX_VISIBLE_PROP_PATTERN =
  /\b(?:title|aria-label|placeholder|alt|label|description)\s*=\s*["'][^"']*\p{Script=Han}[^"']*["']/gu;

const CSS_SELECTOR_RULE_GROUPS = [
  {
    name: "页面容器缩进契约",
    rules: [
      {
        component_name: "PageShell",
        selector_regex: /^\.(basic-settings-page|debug-panel-page|project-home|workbench-page)$/,
        forbidden_properties: [
          "padding",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left",
          "margin",
          "margin-top",
          "margin-right",
          "margin-bottom",
          "margin-left",
        ],
      },
    ],
  },
  {
    name: "页面层基础视觉边界",
    rules: [
      {
        component_name: "Card",
        selector_regex:
          /^\.(project-home__panel|workbench-page__stat-card|workbench-page__table-card|workbench-page__command-card)$/,
        forbidden_properties: ["background", "box-shadow", "border-radius", "border-color"],
      },
      {
        component_name: "Button",
        selector_regex:
          /^\.(workbench-page__command-button(\[data-slot='button'\])?|project-home__action)$/,
        forbidden_properties: ["border-radius", "box-shadow", "background"],
      },
      {
        component_name: "Table",
        selector_regex:
          /^\.(workbench-page__table-head-row( th)?|workbench-page__table-row( td)?|workbench-page__table-row:hover td|workbench-page__table-row--selected td)$/,
        forbidden_properties: ["border-bottom", "background", "height", "font-size", "color"],
      },
    ],
  },
];

/**
 * 前端边界规则只表达可稳定静态判定的 renderer 约束。
 */
export function create_frontend_boundary_rules() {
  return [
    create_renderer_import_boundary_rule(),
    create_desktop_api_boundary_rule(),
    create_desktop_runtime_snapshot_write_rule(),
    create_renderer_visible_text_rule(),
    create_renderer_px_first_literal_rule(),
    create_renderer_token_owner_rule(),
    create_renderer_css_component_boundary_rule(),
  ];
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
    name: "Core API 接入边界",
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
            return "renderer 访问 Core API 必须先收口到 desktop-api.ts";
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
 * 禁止页面恢复共享 snapshot 裸 setter，确保写入只来自受控后端回流。
 */
function create_desktop_runtime_snapshot_write_rule() {
  return {
    name: "renderer 共享运行态写入口边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_frontend_production_source)) {
        const relative_path = context.relative_path(file_path);
        const content = context.read_file(file_path);
        const matches = find_pattern_errors(
          content,
          /\b(?:set_project_snapshot|set_task_snapshot|set_settings_snapshot)\b/g,
          () => {
            return "页面不能暴露或调用共享 snapshot 裸 setter；请改用后端刷新、后端载荷同步或任务 ack 同步";
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

function create_renderer_css_component_boundary_rule() {
  return {
    name: "renderer 基础组件视觉边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_css_source)) {
        const relative_path = context.relative_path(file_path);
        const blocks = parse_css_blocks(context.read_file(file_path));
        for (const block of blocks) {
          for (const selector of block.selectors) {
            for (const group of CSS_SELECTOR_RULE_GROUPS) {
              for (const rule of group.rules) {
                if (!rule.selector_regex.test(selector)) {
                  continue;
                }

                const forbidden_matches = find_forbidden_properties(
                  block.body,
                  rule.forbidden_properties,
                );
                if (forbidden_matches.length === 0) {
                  continue;
                }

                errors.push({
                  message: `${selector} 不应定义 ${forbidden_matches.join(", ")}；请把 ${rule.component_name} 基础视觉收回到 shadcn 组件或 ${TOKEN_OWNER_RELATIVE_PATH}`,
                  relative_path,
                });
              }
            }
          }
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

function parse_css_blocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let pending_selector_lines = [];
  let current_selector = "";
  let current_body = [];
  let depth = 0;

  for (const line of lines) {
    if (depth === 0) {
      pending_selector_lines.push(line);

      if (!line.includes("{")) {
        continue;
      }

      const selector_source = pending_selector_lines.join(" ");
      current_selector = selector_source.slice(0, selector_source.indexOf("{")).trim();
      current_body = [line.slice(line.indexOf("{") + 1)];
      pending_selector_lines = [];
      depth += count_css_depth_delta(line);
      continue;
    }

    current_body.push(line);
    depth += count_css_depth_delta(line);

    if (depth === 0) {
      const selectors = current_selector
        .split(",")
        .map((selector) => selector.replace(/\s+/g, " ").trim())
        .filter((selector) => selector.length > 0);

      blocks.push({
        body: current_body.join("\n"),
        selectors,
      });
      current_selector = "";
      current_body = [];
    }
  }

  return blocks;
}

function count_css_depth_delta(line) {
  return (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
}

function find_forbidden_properties(body, properties) {
  const matches = [];

  for (const property of properties) {
    const property_regex = new RegExp(`(^|\\n)\\s*${property}\\s*:`, "m");

    if (property_regex.test(body)) {
      matches.push(property);
    }
  }

  return matches;
}

function validate_renderer_import(project_root, file_path, specifier) {
  if (specifier === "electron" || specifier.startsWith("electron/")) {
    return "renderer 不能直接导入 Electron，只能通过 window.desktopApp 接入宿主能力";
  }
  if (specifier.startsWith("node:")) {
    return "renderer 不能直接导入 Node 能力，只能通过 preload 暴露的窄桥接";
  }
  if (specifier.startsWith("@native/") && !ALLOWED_NATIVE_CONTRACT_IMPORTS.has(specifier)) {
    return "renderer 只能通过 @native/* 白名单读取 src/native 根契约";
  }
  if (is_project_mutation_state_import(specifier)) {
    return "renderer 不能导入项目 mutation 派生模块；最终项目事实只能由 main 后端计算";
  }

  const resolved_path = resolve_relative_specifier(file_path, specifier);
  if (resolved_path === null) {
    return null;
  }

  const main_root = path.join(project_root, "src/main");
  const preload_root = path.join(project_root, "src/preload");
  const native_root = path.join(project_root, "src/native");
  const native_platform_root = path.join(native_root, "platform");
  const native_shell_root = path.join(native_root, "shell");

  if (is_inside(resolved_path, main_root)) {
    return "renderer 不能通过相对路径访问 main 内部实现";
  }
  if (is_inside(resolved_path, preload_root)) {
    return "renderer 不能通过相对路径访问 preload 实现";
  }
  if (
    is_inside(resolved_path, native_platform_root) ||
    is_inside(resolved_path, native_shell_root)
  ) {
    return "renderer 不能读取 native platform/shell 实现";
  }
  if (is_inside(resolved_path, native_root)) {
    return "renderer 读取 native 契约必须使用 @native/* 白名单别名";
  }

  return null;
}

// 旧 shared 入口和相对路径都要拦截，防止最终事实派生算法回流到 renderer。
function is_project_mutation_state_import(specifier) {
  return (
    specifier === "@shared/project/project-mutation-state" ||
    specifier.endsWith("/project/project-mutation-state") ||
    specifier.endsWith("/project-mutation-state")
  );
}

function is_frontend_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    file_path.includes(`${path.sep}src${path.sep}renderer${path.sep}`) &&
    !is_test_file(file_path)
  );
}

function is_frontend_production_tsx(file_path) {
  return file_path.endsWith(".tsx") && is_frontend_production_source(file_path);
}

function is_css_source(file_path) {
  return path.extname(file_path) === ".css";
}

function is_px_first_literal_scope(relative_path) {
  return (
    relative_path === TOKEN_OWNER_RELATIVE_PATH ||
    PX_FIRST_SCOPE_PREFIXES.some((prefix) => relative_path.startsWith(prefix))
  );
}

function is_inside(file_path, directory_path) {
  const relative_path = path.relative(directory_path, file_path);
  return (
    relative_path === "" || (!relative_path.startsWith("..") && !path.isAbsolute(relative_path))
  );
}
