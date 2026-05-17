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

const JSX_VISIBLE_TEXT_PATTERN = />[^<>{]*\p{Script=Han}[^<>{]*</gu;
const JSX_VISIBLE_PROP_PATTERN =
  /\b(?:title|aria-label|placeholder|alt|label|description)\s*=\s*["'][^"']*\p{Script=Han}[^"']*["']/gu;

/**
 * 前端边界规则只表达可稳定静态判定的 renderer 约束。
 */
export function create_frontend_boundary_rules() {
  return [
    create_renderer_import_boundary_rule(),
    create_desktop_api_boundary_rule(),
    create_renderer_visible_text_rule(),
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
  if (specifier.startsWith("@native/") && !ALLOWED_NATIVE_CONTRACT_IMPORTS.has(specifier)) {
    return "renderer 只能通过 @native/* 白名单读取 src/native 根契约";
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

function is_inside(file_path, directory_path) {
  const relative_path = path.relative(directory_path, file_path);
  return (
    relative_path === "" || (!relative_path.startsWith("..") && !path.isAbsolute(relative_path))
  );
}
