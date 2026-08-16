import path from "node:path";

import {
  find_import_specifiers,
  find_pattern_errors,
  is_test_file,
  is_typescript_source,
  resolve_relative_specifier,
} from "./core.mjs";

const API_GATEWAY_RELATIVE_PATH = "src/backend/api/api-gateway-server.ts";
const API_ROUTES_RELATIVE_PATH = "src/backend/api/api-routes.ts";
const NATIVE_FS_RELATIVE_PATH = "src/native/native-fs.ts";
const APP_ERROR_RELATIVE_PATH = "src/shared/error/app-error.ts";
const SYSTEM_PROXY_HTTP_CLIENT_RELATIVE_PATH = "src/backend/network/system-proxy-http-client.ts";
const AGENT_WEB_FETCH_RELATIVE_PATH = "src/backend/agent/agent-web-fetch.ts";

/**
 * 后端边界规则只表达事实所有权和不能依赖代码审查维持的静态硬门闩。
 */
export function create_backend_boundary_rules() {
  return [
    create_api_registration_boundary_rule(),
    create_backend_api_dependency_rule(),
    create_backend_module_ownership_rule(),
    create_backend_outbound_network_rule(),
    create_cli_dependency_rule(),
    create_model_provider_sdk_rule(),
    create_llm_model_dependency_rule(),
    create_native_fs_boundary_rule(),
    create_sqlite_boundary_rule(),
    create_app_error_definition_rule(),
    create_sse_json_boundary_rule(),
  ];
}

function create_backend_module_ownership_rule() {
  const removed_modules = new Set(["analysis", "toolbox", "translation", "workbench"]);
  return {
    name: "后端模块所有权",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_backend_production_source)) {
        const relative_path = context.relative_path(file_path);
        const module_name = relative_path.split("/")[2];
        if (!removed_modules.has(module_name)) {
          continue;
        }
        errors.push({
          relative_path,
          message: `${module_name} 不是后端事实所有者，能力必须归入现有领域或 network 基础边界`,
        });
      }
      return errors;
    },
  };
}

/** 低层 Undici 只归正式传输所有者，Backend Runtime 与 CLI 的 fetch 只能由系统代理 Client 安装。 */
function create_backend_outbound_network_rule() {
  const network_owners = new Set([
    SYSTEM_PROXY_HTTP_CLIENT_RELATIVE_PATH,
    AGENT_WEB_FETCH_RELATIVE_PATH,
  ]);
  return {
    name: "后端出站网络边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(
        (file_path) =>
          is_backend_production_source(file_path) || is_cli_production_source(file_path),
      )) {
        const relative_path = context.relative_path(file_path);
        const content = context.read_file(file_path);
        if (!network_owners.has(relative_path)) {
          for (const import_entry of find_import_specifiers(content)) {
            if (import_entry.specifier !== "undici") {
              continue;
            }
            errors.push({
              line: import_entry.line,
              message: "Undici 传输只能由 system-proxy-http-client 或 agent-web-fetch 拥有",
              relative_path,
            });
          }
        }
        if (relative_path !== SYSTEM_PROXY_HTTP_CLIENT_RELATIVE_PATH) {
          const matches = find_pattern_errors(content, /\bglobalThis\.fetch\s*=/g, () => {
            return "Backend Runtime 与 CLI 的 fetch 只能由 system-proxy-http-client 安装";
          });
          errors.push(...matches.map((match) => ({ ...match, relative_path })));
        }
      }
      return errors;
    },
  };
}

function create_backend_api_dependency_rule() {
  return {
    name: "后端 API 依赖方向",
    check: (context) => {
      const errors = [];
      const api_root = path.join(context.project_root, "src", "backend", "api");
      for (const file_path of context.files.filter(is_backend_feature_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          const target = resolve_relative_specifier(file_path, import_entry.specifier);
          if (target === null || !is_path_inside(target, api_root)) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "业务与基础模块不得依赖 API 适配层",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_cli_dependency_rule() {
  return {
    name: "CLI 后端依赖边界",
    check: (context) => {
      const errors = [];
      const forbidden_roots = [
        path.join(context.project_root, "src", "backend", "cache"),
        path.join(context.project_root, "src", "backend", "database"),
      ];
      const forbidden_files = [
        path.join(context.project_root, "src", "backend", "api", "api-stream-hub"),
        path.join(context.project_root, "src", "backend", "project", "project-write-store"),
      ];
      for (const file_path of context.files.filter(is_cli_production_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          const target = resolve_relative_specifier(file_path, import_entry.specifier);
          if (
            target === null ||
            (!forbidden_roots.some((root) => is_path_inside(target, root)) &&
              !forbidden_files.some((forbidden) => target === forbidden))
          ) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "CLI 只能消费类型化应用服务，不得依赖存储、缓存或 API stream",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_model_provider_sdk_rule() {
  const provider_packages = new Set(["@anthropic-ai/sdk", "@google/genai", "openai"]);
  return {
    name: "模型供应商边界",
    check: (context) => {
      const errors = [];
      for (const file_path of context.files.filter(is_model_production_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          if (!provider_packages.has(import_entry.specifier)) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "供应商 SDK、端点和传输实现必须归 backend/llm",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

function create_llm_model_dependency_rule() {
  return {
    name: "LLM 模型依赖方向",
    check: (context) => {
      const errors = [];
      const model_root = path.join(context.project_root, "src", "backend", "model");
      for (const file_path of context.files.filter(is_llm_production_source)) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          const target = resolve_relative_specifier(file_path, import_entry.specifier);
          if (target === null || !is_path_inside(target, model_root)) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "LLM 传输与策略不得反向依赖模型配置服务",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
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
              return "/api/* 路由只能在 api-gateway-server.ts 或 api-routes.ts 注册";
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
  const backend_path = path.sep + "src" + path.sep + "backend" + path.sep;
  const native_path = path.sep + "src" + path.sep + "native" + path.sep;
  const error_path = path.sep + "src" + path.sep + "shared" + path.sep + "error" + path.sep;
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    (file_path.includes(backend_path) ||
      file_path.includes(native_path) ||
      file_path.includes(error_path))
  );
}

function is_backend_feature_source(file_path) {
  if (!is_backend_production_source(file_path)) {
    return false;
  }
  const normalized = file_path.replaceAll(path.sep, "/");
  return (
    !normalized.includes("/src/backend/api/") && !normalized.includes("/src/backend/bootstrap/")
  );
}

function is_cli_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    file_path.includes(path.sep + "src" + path.sep + "cli" + path.sep)
  );
}

function is_model_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    file_path.includes(path.sep + "src" + path.sep + "backend" + path.sep + "model" + path.sep)
  );
}

function is_llm_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    file_path.includes(path.sep + "src" + path.sep + "backend" + path.sep + "llm" + path.sep)
  );
}

function is_path_inside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

function is_api_registration_path(relative_path) {
  return relative_path === API_GATEWAY_RELATIVE_PATH || relative_path === API_ROUTES_RELATIVE_PATH;
}

function is_database_or_migration_path(relative_path) {
  return (
    relative_path.startsWith("src/backend/database/") ||
    relative_path.startsWith("src/backend/migration/")
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
