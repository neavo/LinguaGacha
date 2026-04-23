import path from "node:path";
import process from "node:process";
import { existsSync } from "node:fs";

import { execa } from "execa";

const SUPPORTED_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function parse_args(argv) {
  const explicit_paths = [];
  let check_only = false;

  for (const arg of argv) {
    if (arg === "--check") {
      check_only = true;
      continue;
    }

    explicit_paths.push(arg);
  }

  return { check_only, explicit_paths };
}

function normalize_file_path(file_path) {
  return file_path.replaceAll("\\", "/");
}

function is_supported_file(file_path) {
  return SUPPORTED_EXTENSIONS.has(path.extname(file_path).toLowerCase());
}

async function run_git_file_query(args) {
  const result = await execa("git", args, {
    cwd: process.cwd(),
  });

  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function collect_changed_files() {
  const [unstaged_files, staged_files, untracked_files] = await Promise.all([
    run_git_file_query(["diff", "--name-only", "--diff-filter=ACMR", "--", "."]),
    run_git_file_query(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "."]),
    run_git_file_query(["ls-files", "--others", "--exclude-standard", "--", "."]),
  ]);

  return [...unstaged_files, ...staged_files, ...untracked_files];
}

function resolve_changed_file_path(file_path, working_tree_prefix) {
  if (working_tree_prefix.length > 0 && file_path.startsWith(working_tree_prefix)) {
    return file_path.slice(working_tree_prefix.length);
  }

  return file_path;
}

async function resolve_working_tree_prefix() {
  const result = await execa("git", ["rev-parse", "--show-prefix"], {
    cwd: process.cwd(),
  });
  return normalize_file_path(result.stdout.trim());
}

function collect_target_files(explicit_paths, changed_files, working_tree_prefix) {
  const source_files = explicit_paths.length > 0 ? explicit_paths : changed_files;
  const target_files = new Set();

  for (const file_path of source_files) {
    const normalized_path = normalize_file_path(
      explicit_paths.length > 0
        ? file_path
        : resolve_changed_file_path(file_path, working_tree_prefix),
    );
    if (!existsSync(normalized_path)) {
      continue;
    }

    if (!is_supported_file(normalized_path)) {
      continue;
    }

    target_files.add(normalized_path);
  }

  return [...target_files].sort((left, right) => left.localeCompare(right));
}

async function run() {
  const { check_only, explicit_paths } = parse_args(process.argv.slice(2));
  const working_tree_prefix = explicit_paths.length > 0 ? "" : await resolve_working_tree_prefix();
  const changed_files = explicit_paths.length > 0 ? [] : await collect_changed_files();
  const target_files = collect_target_files(explicit_paths, changed_files, working_tree_prefix);

  if (target_files.length === 0) {
    const action_text = check_only ? "检查" : "格式化";
    console.log(`[format] 没有需要 ${action_text} 的相关文件。`);
    return;
  }

  const action_label = check_only ? "检查" : "格式化";
  console.log(`[format] 准备${action_label} ${target_files.length.toString()} 个文件：`);
  for (const file_path of target_files) {
    console.log(`  - ${file_path}`);
  }

  const formatter_args = [
    ...(check_only ? ["--check"] : []),
    "--no-error-on-unmatched-pattern",
    ...target_files,
  ];

  await execa("oxfmt", formatter_args, {
    cwd: process.cwd(),
    preferLocal: true,
    stdio: "inherit",
  });
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "oxfmt 执行失败。";
  console.error(`[format] ${message}`);
  process.exit(1);
}
