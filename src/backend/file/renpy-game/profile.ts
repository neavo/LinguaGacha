import assert from "node:assert/strict";
import path from "node:path";
import type { Node } from "web-tree-sitter";
import type { NativeFs } from "../../../native/native-fs";
import { assert_regular_path, collect_existing_files } from "../source-file-paths";
import { paragraph_text, PythonDecodeError } from "./python";
import { PythonSession, python_value, python_name, type PythonValue } from "./python-syntax";

export type RenpyProfile = {
  version: string;
  archives: "top-level" | "recursive";
  digest: "universal" | "raw";
  salt: string;
  ren_python: boolean;
  script_order: "filename" | "grouped";
  old_substitutions: boolean | null;
};
export type RenpyFormatMetadata = {
  schema: "linguagacha-renpy-1";
  profile: RenpyProfile;
  common: string[];
};
/** CST token 序列用于核对已知引擎形态，注释和格式不参与规则匹配。 */
function signature(node: Node): string {
  if (node.type === "comment") return "";
  if (node.type === "string") {
    try {
      return JSON.stringify(python_value(node, false, true));
    } catch (error) {
      if (!(error instanceof PythonDecodeError)) throw error;
      return node.text;
    }
  }
  return node.childCount ? node.children.map(signature).join("") : node.text;
}
/** 只接受已识别的加载规则，不执行引擎源码。 */
export async function read_profile(
  root: string,
  fs: NativeFs,
  signal?: AbortSignal,
  session?: PythonSession,
): Promise<RenpyProfile> {
  if (!session) {
    using owned = await PythonSession.create();
    return await read_profile(root, fs, signal, owned);
  }
  const read = async (name: string) => {
    const file = path.join(root, "renpy", name);
    assert_regular_path(file, fs);
    assert(fs.exists(file), "Missing Ren'Py engine source: " + file);
    return session.read(
      { source: fs.read_text_file(file), mode: "exec" },
      ({ nodes }) => {
        const shapes = new Set<string>();
        const values = new Map<string, PythonValue[]>();
        for (const node of nodes) {
          if (
            ["call", "not_operator", "binary_operator", "identifier", "string"].includes(node.type)
          )
            shapes.add(signature(node));
          if (
            node.type === "for_statement" &&
            signature(node.childForFieldName("left")!) === "stem,ext,fn" &&
            python_name(node.childForFieldName("right")) === "arc_files"
          )
            shapes.add("archive-loop");
          if (node.type === "assignment") {
            const name = python_name(node.childForFieldName("left"));
            let value: PythonValue;
            try {
              value = python_value(node.childForFieldName("right"), false, true);
            } catch (error) {
              if (!(error instanceof PythonDecodeError)) throw error;
              value = undefined;
            }
            values.set(name, [...(values.get(name) ?? []), value]);
          }
        }
        return { shapes, values };
      },
      signal,
    );
  };
  const loader = await read("loader.py"),
    main = await read("main.py"),
    script = await read("script.py"),
    config = await read("config.py");
  const recursive =
    loader.shapes.has("arc_files.sort(reverse=True)") &&
    loader.shapes.has("archive-loop") &&
    loader.shapes.has("walkdir(i)");
  assert(
    recursive ||
      (main.shapes.has("renpy.config.archives.reverse()") &&
        [...main.shapes].some((shape) => shape.startsWith("sorted(os.listdir("))),
    "Unknown Ren'Py archive discovery; use an engine with standard loading rules",
  );
  assert(
    loader.shapes.has("notrenpy.config.force_archives") &&
      script.shapes.has("rpycdigest") &&
      (script.shapes.has('"lock.txt"') || script.shapes.has('"/lock.txt"')),
    "Unknown Ren'Py loading rules",
  );
  const mode = script.shapes.has('open(rpyfn,"rU")')
    ? "rU"
    : script.shapes.has('open(rpyfn,"rb")')
      ? "rb"
      : null;
  assert(mode, "Unknown Ren'Py source digest rule");
  const salted = script.shapes.has("f.read()+RPYC_MAGIC");
  assert(
    ["hashlib", "md5"].some((name) =>
      script.shapes.has(`${name}.md5(f.read()${salted ? "+RPYC_MAGIC" : ""}).digest()`),
    ),
    "Unknown Ren'Py source digest algorithm",
  );
  const salt = script.values.get("RPYC_MAGIC")?.[0] ?? "";
  assert(typeof salt === "string" && (!salted || salt), "Unknown Ren'Py digest salt");
  const version_source = await read("__init__.py");
  const python3 = fs.read_dir_names(path.join(root, "lib")).some((name) => name.startsWith("py3-"));
  const tuple = version_source.values
    .get("version_tuple")
    ?.find(
      (value) =>
        Array.isArray(value) &&
        typeof value[0] === "number" &&
        (python3 ? value[0] >= 8 : value[0] < 8),
    );
  const version_info = fs.exists(path.join(root, "renpy/vc_version.py"))
    ? await read("vc_version.py")
    : null;
  const version = Array.isArray(tuple)
    ? tuple.slice(0, 3).join(".")
    : (version_info?.values.get("version")?.[0] ?? "unknown");
  assert(typeof version === "string", "Unknown Ren'Py version declaration");
  assert(config.values.get("old_substitutions")?.[0] === true, "Unknown Ren'Py percent semantics");
  assert(
    config.values.get("force_archives")?.[0] === false,
    "Unknown Ren'Py default archive policy",
  );
  let old_substitutions: boolean | null = true;
  const compatibility = path.join(root, "game/script_version.txt");
  if (fs.exists(compatibility)) {
    const numbers = fs.read_text_file(compatibility).match(/\d+/gu)?.slice(0, 3).map(Number);
    if (!numbers || numbers.length !== 3) old_substitutions = null;
    else {
      const code = numbers[0]! * 1_000_000 + numbers[1]! * 1_000 + numbers[2]!;
      if (code > 6_012_002 && code <= 6_013_008) old_substitutions = false;
    }
  }
  return {
    version,
    archives: recursive ? "recursive" : "top-level",
    digest: mode === "rU" ? "universal" : "raw",
    salt,
    ren_python: script.shapes.has('fn.endswith("_ren.py")'),
    script_order: script.shapes.has("self.script_files.sort(key=game_key)")
      ? "grouped"
      : "filename",
    old_substitutions,
  };
}
/** 公共文件先执行引擎声明的扫描契约，再统一解析捕获的 Python 表达式。 */
export async function collect_common(
  root: string,
  fs: NativeFs,
  signal?: AbortSignal,
  include_layout = false,
  session?: PythonSession,
): Promise<string[]> {
  if (!session) {
    using owned = await PythonSession.create();
    return await collect_common(root, fs, signal, include_layout, owned);
  }
  const common = path.join(root, "renpy/common"),
    files = new Set<string>(),
    result = new Set<string>();
  collect_existing_files(root, "renpy/common", files, fs, signal);
  const modern = fs.exists(path.join(root, "renpy/translation/scanstrings.py"));
  const scanner = fs.read_text_file(
    path.join(root, modern ? "renpy/translation/scanstrings.py" : "renpy/translation.py"),
  );
  const facts = await session.analyze({ source: scanner, mode: "exec" }, false, signal);
  const declarations = (name: string) =>
    facts.assignments.filter(
      (entry) => entry.root && entry.target === name && entry.operation === "=",
    );
  const patterns = declarations("STRING_RE");
  assert(
    patterns.length === 1 && typeof patterns[0]!.value === "string",
    "Unknown Ren'Py common string scanner",
  );
  const pattern = patterns[0]!.value;
  assert(
    ["(?:_|__|___|_p)", "_[_p]?", "__?"].some((marker) => pattern.includes(marker)),
    "Unknown Ren'Py common string scanner",
  );
  const regex = new RegExp(pattern.replace(/^\(\?x\)/u, "").replace(/(?<!\\)\s+/gu, ""), "g");
  const priorities: { prefix: string; value: number }[] = [];
  if (modern) {
    const values = declarations("COMMON_PRIORITIES");
    assert(
      values.length === 1 && Array.isArray(values[0]!.value),
      "Unknown Ren'Py common string priorities",
    );
    for (const entry of values[0]!.value) {
      assert(
        Array.isArray(entry) &&
          entry.length === 3 &&
          typeof entry[0] === "string" &&
          typeof entry[1] === "number" &&
          typeof entry[2] === "string",
        "Unknown Ren'Py common string priority",
      );
      priorities.push({ prefix: entry[0], value: entry[1] });
    }
    assert(
      priorities.some((entry) => entry.prefix === ""),
      "Missing Ren'Py default common priority",
    );
  }
  for (const name of [...files].sort()) {
    signal?.throwIfAborted();
    if (!/\.rpym?$/u.test(name)) continue;
    const relative = path.relative(common, path.join(root, name)).replaceAll("\\", "/");
    const priority = priorities.find((entry) => relative.startsWith(entry.prefix))?.value ?? 0;
    if (priority > 299 && !(include_layout && /^(?:_layout\/|00layout\.rpy)/u.test(relative)))
      continue;
    const source = fs
      .read_text_file(path.join(root, name))
      .replace(/^\uFEFF/u, "")
      .replace(/\r\n?/gu, "\n");
    for (const match of source.matchAll(regex)) {
      assert(match[1], "Unknown Ren'Py common scanner capture");
      const value = await session.read(
        { source: match[1].replace(/\\\n/gu, ""), mode: "eval" },
        ({ root }) => python_value(root.namedChildren[0]!, false),
        signal,
      );
      assert(typeof value === "string", "Dynamic Ren'Py common string");
      const text = match[0].startsWith("_p") ? paragraph_text(value) : value;
      if (text) result.add(text);
    }
  }
  return [...result].sort();
}
