import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  "build",
  "dist",
  "dist-electron",
  "node_modules",
]);

const IMPORT_SPECIFIER_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+["']([^"']+)["']/g,
];

/**
 * 解析仓库根目录，所有 CLI 入口共享同一个路径口径。
 */
export function resolve_project_root(import_meta_url) {
  return path.resolve(path.dirname(fileURLToPath(import_meta_url)), "..");
}

/**
 * 递归收集检查范围内的文件，跳过构建产物和依赖目录。
 */
export function collect_files(start_paths, options = {}) {
  const ignored_directories = options.ignored_directories ?? DEFAULT_IGNORED_DIRECTORIES;
  const files = [];

  for (const start_path of start_paths) {
    if (!existsSync(start_path)) {
      continue;
    }
    collect_files_into(start_path, ignored_directories, files);
  }

  return files.sort((left, right) => left.localeCompare(right));
}

/**
 * 执行规则集合并返回结构化错误，测试和 CLI 共享同一入口。
 */
export function run_boundary_rules({ project_root, roots, rules }) {
  const files = collect_files(roots);
  const context = {
    files,
    project_root,
    read_file: (file_path) => readFileSync(file_path, "utf8"),
    relative_path: (file_path) => to_relative_path(project_root, file_path),
  };
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
export function format_boundary_errors(title, errors) {
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
 * CLI 入口统一处理退出码，规则文件只负责表达边界。
 */
export function run_boundary_cli({ title, project_root, roots, rules }) {
  const errors = run_boundary_rules({ project_root, roots, rules });
  const message = format_boundary_errors(title, errors);

  if (errors.length > 0) {
    console.error(message);
    process.exit(1);
  }

  console.log(message);
}

/**
 * 从源码中提取静态和动态 import specifier，供边界规则做路径判定。
 */
export function find_import_specifiers(content) {
  const specifiers = [];

  for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) {
        specifiers.push({
          line: line_number_at(content, match.index ?? 0),
          specifier,
        });
      }
    }
  }

  return specifiers;
}

/**
 * 相对导入先解析到磁盘路径，非相对包名保持原值。
 */
export function resolve_relative_specifier(file_path, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  return path.resolve(path.dirname(file_path), specifier);
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
      line: line_number_at(content, match.index ?? 0),
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

function collect_files_into(current_path, ignored_directories, files) {
  const current_stat = statSync(current_path);
  if (!current_stat.isDirectory()) {
    files.push(current_path);
    return;
  }

  for (const entry of readdirSync(current_path)) {
    if (ignored_directories.has(entry)) {
      continue;
    }
    collect_files_into(path.join(current_path, entry), ignored_directories, files);
  }
}

function line_number_at(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}
