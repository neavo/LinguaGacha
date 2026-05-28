import path from "node:path";

import {
  find_import_specifiers,
  find_pattern_errors,
  is_test_file,
  is_typescript_source,
} from "./core.mjs";

const API_GATEWAY_RELATIVE_PATH = "src/core/api/api-gateway-server.ts";
const API_ROUTES_RELATIVE_PREFIX = "src/core/api/routes/";
const NATIVE_FS_RELATIVE_PATH = "src/native/native-fs.ts";
const APP_ERROR_RELATIVE_PATH = "src/shared/error/app-error.ts";

/**
 * 后端边界规则只表达 API、存储和错误模型的静态硬门闩。
 */
export function create_backend_boundary_rules() {
  return [
    create_api_registration_boundary_rule(),
    create_native_fs_boundary_rule(),
    create_sqlite_boundary_rule(),
    create_app_error_definition_rule(),
    create_sse_json_boundary_rule(),
  ];
}

function create_api_registration_boundary_rule() {
  return {
    name: "API 注册边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_backend_production_source)) {
        const relative_path = context.relative_path(file_path);
        const content = context.read_file(file_path);

        if (!is_api_registration_path(relative_path)) {
          const matches = find_pattern_errors(
            content,
            /\bapp\.(?:get|post|put|delete|all)\s*\(\s*["']\/api\//g,
            () => {
              return "/api/* 路由只能在 api-gateway-server.ts 或 api/routes 注册";
            },
          );
          errors.push(...matches.map((match) => ({ ...match, relative_path })));
          continue;
        }

        const direct_post_matches = find_pattern_errors(
          content,
          /\bapp\.post\s*\(\s*["']\/api\//g,
          () => {
            return "POST JSON 路由必须通过 postJson 统一响应壳";
          },
        );
        errors.push(...direct_post_matches.map((match) => ({ ...match, relative_path })));
      }
      return errors;
    },
  };
}

function create_native_fs_boundary_rule() {
  return {
    name: "NativeFs 落点边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_backend_production_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          if (!["node:fs", "node:fs/promises"].includes(import_entry.specifier)) {
            continue;
          }
          if (relative_path === NATIVE_FS_RELATIVE_PATH) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "生产代码真实磁盘 IO 必须经 src/native/native-fs.ts",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_sqlite_boundary_rule() {
  return {
    name: "SQLite 落点边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_backend_production_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          if (import_entry.specifier !== "node:sqlite") {
            continue;
          }
          if (is_database_or_migration_path(relative_path)) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "SQLite 连接生命周期只允许落在 database 或 migration 边界",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_app_error_definition_rule() {
  return {
    name: "错误定义表边界",
    check: (context) => {
      const error_file = context.files.find((file_path) => {
        return context.relative_path(file_path) === APP_ERROR_RELATIVE_PATH;
      });
      if (error_file === undefined) {
        return [];
      }

      const content = context.read_file(error_file);
      const definition_block = read_app_error_definition_block(content);
      const relative_path = context.relative_path(error_file);
      return find_pattern_errors(definition_block.content, /\b(?:message|action)\s*:/g, () => {
        return "APP_ERROR_DEFINITIONS 只能保存数据读取策略，用户可见文案必须放在 i18n 资源";
      }).map((match) => ({
        ...match,
        line: match.line + definition_block.start_line - 1,
        relative_path,
      }));
    },
  };
}

function create_sse_json_boundary_rule() {
  return {
    name: "SSE JSON 序列化边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_backend_production_source)) {
        const relative_path = context.relative_path(file_path);
        const content = context.read_file(file_path);
        const matches = find_pattern_errors(content, /data:\s*\$\{JSON\.stringify\(/g, () => {
          return "公开 SSE data 必须使用 JsonTool.stringifyStrict 序列化";
        });
        errors.push(...matches.map((match) => ({ ...match, relative_path })));
      }
      return errors;
    },
  };
}

function is_backend_production_source(file_path) {
  const core_path = path.sep + "src" + path.sep + "core" + path.sep;
  const native_path = path.sep + "src" + path.sep + "native" + path.sep;
  const error_path = path.sep + "src" + path.sep + "shared" + path.sep + "error" + path.sep;
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    (file_path.includes(core_path) ||
      file_path.includes(native_path) ||
      file_path.includes(error_path))
  );
}

function is_api_registration_path(relative_path) {
  return (
    relative_path === API_GATEWAY_RELATIVE_PATH ||
    relative_path.startsWith(API_ROUTES_RELATIVE_PREFIX)
  );
}

function is_database_or_migration_path(relative_path) {
  return (
    relative_path.startsWith("src/core/database/") ||
    relative_path.startsWith("src/core/migration/")
  );
}

function read_app_error_definition_block(content) {
  const start = content.indexOf("export const APP_ERROR_DEFINITIONS");
  if (start < 0) {
    return { content: "", start_line: 1 };
  }
  const end = content.indexOf("export interface AppErrorOptions", start);
  return {
    content: end < 0 ? content.slice(start) : content.slice(start, end),
    start_line: content.slice(0, start).split(/\r?\n/).length,
  };
}
