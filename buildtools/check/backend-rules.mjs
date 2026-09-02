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
const BACKEND_SERVICES_RELATIVE_PATH = "src/backend/bootstrap/backend-services.ts";

/**
 * 后端边界规则只表达事实所有权和不能依赖代码审查维持的静态硬门闩。
 */
export function create_backend_boundary_rules() {
  return [
    create_api_registration_boundary_rule(),
    create_backend_api_dependency_rule(),
    create_backend_module_ownership_rule(),
    create_backend_outbound_network_rule(),
    create_backend_services_dependency_rule(),
    create_cli_dependency_rule(),
    create_model_provider_sdk_rule(),
    create_llm_model_dependency_rule(),
    create_native_fs_boundary_rule(),
    create_sqlite_boundary_rule(),
    create_app_error_definition_rule(),
    create_sse_json_boundary_rule(),
  ];
}

/** 已拆散的旧聚合目录不能重新成为后端事实所有者。 */
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

/** 业务与基础模块保持指向 API 适配层之外的单向依赖。 */
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

/** CLI 入口与其可达依赖都不能携带 GUI Agent、API 或底层存储实现。 */
function create_cli_dependency_rule() {
  return {
    name: "CLI 后端依赖边界",
    check: (context) => {
      const errors = [];
      const forbidden_runtime_roots = [
        path.join(context.project_root, "src", "backend", "agent"),
        path.join(context.project_root, "src", "backend", "api"),
      ];
      const forbidden_direct_roots = [
        path.join(context.project_root, "src", "backend", "cache"),
        path.join(context.project_root, "src", "backend", "database"),
      ];
      const forbidden_files = [
        path.join(context.project_root, "src", "backend", "project", "project-write-store"),
      ];
      const source_by_module_path = index_source_module_paths(context.files);
      const cli_files = context.files.filter(is_cli_production_source);
      for (const file_path of cli_files) {
        const relative_path = context.relative_path(file_path);
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          const target = resolve_relative_specifier(file_path, import_entry.specifier);
          if (
            target === null ||
            (!forbidden_direct_roots.some((root) => is_path_inside(target, root)) &&
              !forbidden_files.some((forbidden) => target === forbidden))
          ) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "CLI 只能消费共享业务服务，不得依赖 Agent、API、存储或缓存实现",
            relative_path,
          });
        }
        const visited = new Set();
        const reachable_forbidden = collect_reachable_forbidden_imports(
          file_path,
          context,
          source_by_module_path,
          forbidden_runtime_roots,
          visited,
        );
        for (const forbidden of reachable_forbidden) {
          errors.push({
            message: `CLI 运行依赖不得到达 ${context.relative_path(forbidden)}`,
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

/** 将 TypeScript 文件与目录 index 归一为相对 import 可解析的模块路径。 */
function index_source_module_paths(files) {
  const result = new Map();
  for (const file_path of files.filter(is_typescript_source)) {
    const without_extension = file_path.replace(/\.(?:ts|tsx)$/, "");
    result.set(without_extension, file_path);
    if (path.basename(without_extension) === "index") {
      result.set(path.dirname(without_extension), file_path);
    }
  }
  return result;
}

/** 沿仓库内相对 import 递归查找 CLI 可达的受限运行时目录。 */
function collect_reachable_forbidden_imports(
  file_path,
  context,
  source_by_module_path,
  forbidden_roots,
  visited,
) {
  if (visited.has(file_path)) return new Set();
  visited.add(file_path);
  const result = new Set();
  for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
    const target = resolve_relative_specifier(file_path, import_entry.specifier);
    if (target === null) continue;
    if (forbidden_roots.some((root) => is_path_inside(target, root))) {
      result.add(target);
      continue;
    }
    const source_path = source_by_module_path.get(target);
    if (source_path === undefined) continue;
    for (const forbidden of collect_reachable_forbidden_imports(
      source_path,
      context,
      source_by_module_path,
      forbidden_roots,
      visited,
    )) {
      result.add(forbidden);
    }
  }
  return result;
}

/** 共享业务组合根不能反向携带只属于 GUI 的 Agent 或公开传输。 */
function create_backend_services_dependency_rule() {
  return {
    name: "共享 Backend 组合根边界",
    check: (context) => {
      const errors = [];
      const forbidden_roots = [
        path.join(context.project_root, "src", "backend", "agent"),
        path.join(context.project_root, "src", "backend", "api"),
      ];
      for (const file_path of context.files) {
        const relative_path = context.relative_path(file_path);
        if (relative_path !== BACKEND_SERVICES_RELATIVE_PATH) continue;
        for (const import_entry of find_import_specifiers(context.read_file(file_path))) {
          const target = resolve_relative_specifier(file_path, import_entry.specifier);
          if (target === null || !forbidden_roots.some((root) => is_path_inside(target, root))) {
            continue;
          }
          errors.push({
            line: import_entry.line,
            message: "共享 BackendServices 不得依赖 GUI Agent 或 API 适配层",
            relative_path,
          });
        }
      }
      return errors;
    },
  };
}

/** 供应商 SDK 与协议实现统一收口到 backend/llm。 */
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

/** LLM 传输层不能反向读取模型配置服务。 */
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

/** 公开 API 路径与 POST 错误壳只在两个注册入口维护。 */
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

/** 后端生产磁盘 IO 统一经 NativeFs，便于平台语义和测试替换。 */
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

/** SQLite 连接生命周期只属于 database 与 migration。 */
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

/** 错误定义表只保存结构策略，公开文案继续由 i18n 持有。 */
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

/** SSE 公开 data 统一使用严格 JSON 序列化。 */
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

/** 选择参与后端边界检查的非测试 TypeScript 源码。 */
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

/** 业务与基础实现排除 API 和组合根适配目录。 */
function is_backend_feature_source(file_path) {
  if (!is_backend_production_source(file_path)) {
    return false;
  }
  const normalized = file_path.replaceAll(path.sep, "/");
  return (
    !normalized.includes("/src/backend/api/") && !normalized.includes("/src/backend/bootstrap/")
  );
}

/** 选择 CLI 目录下的非测试 TypeScript 源码。 */
function is_cli_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    file_path.includes(path.sep + "src" + path.sep + "cli" + path.sep)
  );
}

/** 选择模型配置领域的非测试 TypeScript 源码。 */
function is_model_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    file_path.includes(path.sep + "src" + path.sep + "backend" + path.sep + "model" + path.sep)
  );
}

/** 选择 LLM 传输领域的非测试 TypeScript 源码。 */
function is_llm_production_source(file_path) {
  return (
    is_typescript_source(file_path) &&
    !is_test_file(file_path) &&
    file_path.includes(path.sep + "src" + path.sep + "backend" + path.sep + "llm" + path.sep)
  );
}

/** 无尾分隔符歧义地判断目标是否位于根路径内。 */
function is_path_inside(target, root) {
  return target === root || target.startsWith(root + path.sep);
}

/** 两个文件共同拥有公开 API 路径注册。 */
function is_api_registration_path(relative_path) {
  return relative_path === API_GATEWAY_RELATIVE_PATH || relative_path === API_ROUTES_RELATIVE_PATH;
}

/** database 与 migration 是允许直接拥有 SQLite 的边界。 */
function is_database_or_migration_path(relative_path) {
  return (
    relative_path.startsWith("src/backend/database/") ||
    relative_path.startsWith("src/backend/migration/")
  );
}

/** 只截取错误定义常量，避免同文件接口字段产生误报。 */
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
