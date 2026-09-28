import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { create_source_reader, line_number_at } from "./source-reader.mjs";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  "build",
  "dist",
  "dist-electron",
  "node_modules",
]);

/**
 * 解析仓库根目录，所有 CLI 入口共享同一个路径口径。
 */
export function resolve_project_root(import_meta_url) {
  return path.resolve(path.dirname(fileURLToPath(import_meta_url)), "..", "..");
}

/**
 * 递归收集检查范围内的文件，跳过构建产物和依赖目录。
 */
function collect_files(start_paths) {
  const files = [];

  for (const start_path of start_paths) {
    if (!existsSync(start_path)) {
      continue;
    }
    collect_files_into(start_path, files);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

/** 为规则提供文件范围与源码读取能力，测试和 CLI 共用这一构造入口。 */
export function create_check_context({ project_root, files, source_reader, paths = {} }) {
  return {
    files,
    project_root,
    ...source_reader,
    /** 扩展名只改变导入写法，边界判断使用同一模块身份。 */
    resolve_import(file_path, specifier) {
      const target = resolve_import_specifier(project_root, paths, file_path, specifier);
      return target === null ? null : target.replace(/\.(?:ts|tsx)$/u, "");
    },
    relative_path: (file_path) => to_relative_path(project_root, file_path),
  };
}

/** 执行一组规则，源码快照由 CLI 统一注入。 */
function run_boundary_rules({ project_root, roots, rules }, source_reader, paths) {
  const context = create_check_context({
    project_root,
    files: collect_files(roots),
    source_reader,
    paths,
  });
  return rules.flatMap((rule) => {
    return rule.check(context).map((error) => ({
      rule_name: rule.name,
      ...error,
    }));
  });
}

/**
 * CLI 报错保持统一格式，方便 AGENT 和人工直接定位违规文件。
 */
function format_boundary_errors(title, errors) {
  if (errors.length === 0) {
    return `${title}通过。`;
  }

  const lines = [`${title}失败：`];
  for (const error of errors) {
    const location =
      error.line === undefined ? error.relative_path : `${error.relative_path}:${error.line}`;
    lines.push(`- [${error.rule_name}] ${location} ${error.message}`);
  }
  return lines.join("\n");
}

/**
 * 统一执行多个检查集合，保留各集合独立标题但只暴露一个 npm 入口。
 */
export function run_check_cli(suites) {
  const source_reader = create_source_reader();
  const {
    compilerOptions: { paths },
  } = JSON.parse(readFileSync(path.join(suites[0].project_root, "tsconfig.base.json"), "utf8"));
  const messages = [];
  let has_errors = false;

  for (const suite of suites) {
    const errors = run_boundary_rules(suite, source_reader, paths);
    messages.push(format_boundary_errors(suite.title, errors));
    has_errors = has_errors || errors.length > 0;
  }

  const output = messages.join("\n");
  if (has_errors) {
    console.error(output);
    process.exit(1);
  }

  console.log(output);
}

/** 相对路径和 TypeScript 别名共用解析；包名交给各边界规则判断。 */
function resolve_import_specifier(project_root, paths, file_path, specifier) {
  if (specifier.startsWith(".")) return path.resolve(path.dirname(file_path), specifier);
  const exact = paths[specifier];
  if (exact) return path.resolve(project_root, exact[0]);
  const patterns = Object.keys(paths)
    .filter((key) => key.endsWith("*"))
    .sort((a, b) => b.length - a.length);
  for (const pattern of patterns) {
    const prefix = pattern.slice(0, -1);
    if (specifier.startsWith(prefix)) {
      return path.resolve(
        project_root,
        paths[pattern][0].replace("*", specifier.slice(prefix.length)),
      );
    }
  }
  return null;
}

/**
 * 测试文件不参与生产边界门闩，避免测试夹具触发误报。
 */
export function is_test_file(file_path) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file_path);
}

/**
 * 源码扩展名统一在这里收口，避免前后端规则各自散落判断。
 */
export function is_typescript_source(file_path) {
  return /\.(ts|tsx)$/.test(file_path);
}

/**
 * 正则命中需要带行号时统一从这里生成错误对象。
 */
export function find_pattern_errors(content, pattern, build_message) {
  const errors = [];
  pattern.lastIndex = 0;

  for (const match of content.matchAll(pattern)) {
    errors.push({
      line: line_number_at(content, match.index),
      message: build_message(match),
    });
  }

  return errors;
}

/**
 * Windows 路径在报错里统一转成斜杠，保持文档和脚本输出一致。
 */
export function to_relative_path(project_root, file_path) {
  return path.relative(project_root, file_path).replaceAll(path.sep, "/");
}

/** 下探前排除忽略目录，文件收集只维护一份结果数组。 */
function collect_files_into(current_path, files) {
  const current_stat = statSync(current_path);
  if (!current_stat.isDirectory()) {
    files.push(current_path);
    return;
  }

  for (const entry of readdirSync(current_path)) {
    if (DEFAULT_IGNORED_DIRECTORIES.has(entry)) {
      continue;
    }
    collect_files_into(path.join(current_path, entry), files);
  }
}

/** 将完整路径、省略扩展名和目录入口关联到同一源码。 */
export function index_source_module_paths(files) {
  const result = new Map();
  for (const file_path of files.filter(is_typescript_source)) {
    const without_extension = file_path.replace(/\.(?:ts|tsx)$/, "");
    result.set(without_extension, file_path);
    result.set(file_path, file_path);
    if (path.basename(without_extension) === "index") {
      result.set(path.dirname(without_extension), file_path);
    }
  }
  return result;
}
