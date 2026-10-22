import assert from "node:assert/strict";
import type { RenpyLoadingChange, RenpyScript } from "./extract";
import { analyze_code, script_codes } from "./script";
import { PythonSyntaxError, type PythonSession } from "./python-syntax";
import type { RenpyProfile } from "./profile";

type LoadingDeclaration = {
  file: string;
  early: boolean;
  priority: number;
  target: string;
  value: boolean | string[];
};

/** 只消费直接初始化赋值。普通代码、配置读取和未知表达式不提供加载事实。 */
export async function read_loading(
  script: Pick<RenpyScript, "slots" | "python2">,
  file: string,
  profile: Pick<RenpyProfile, "archives">,
  session: PythonSession,
  signal?: AbortSignal,
): Promise<{ declarations: LoadingDeclaration[]; changes: RenpyLoadingChange[] }> {
  const changes = new Map<string, RenpyLoadingChange>(); // 多个消费者共享同一源码边时只改写一次。
  let declarations: LoadingDeclaration[] | undefined; // 槽位是同一脚本的不同表示，加载声明必须一致。
  for (const slot of script.slots) {
    const current: LoadingDeclaration[] = [];
    for (const code of script_codes({ slots: [slot] })) {
      if (code.phase !== "init" || code.source === null) continue;
      let facts;
      try {
        facts = await analyze_code(code, session, script.python2, signal);
      } catch (error) {
        if (!(error instanceof PythonSyntaxError)) throw error;
        continue; // 未能解析的普通代码不构成资源选择声明。
      }
      for (const assignment of facts.assignments) {
        if (!assignment.root || assignment.operation !== "=") continue;
        const { target, value } = assignment;
        if (target === "config.archives") {
          if (profile.archives !== "top-level") continue; // 递归索引不消费游戏声明的归档顺序。
          if (!Array.isArray(value) || !value.every((name) => typeof name === "string")) continue;
        } else if (target === "config.force_archives") {
          if (typeof value !== "boolean") continue;
          if (value) {
            const change = {
              slot: code.slot,
              edge: code.edge.start,
              start: assignment.start,
              end: assignment.end,
              original: code.source.slice(assignment.start, assignment.end),
            };
            changes.set(JSON.stringify([change.slot, change.edge, change.start]), change);
          }
        } else continue;
        assert(code.priority !== null, "Missing loading initialization priority: " + file);
        current.push({ file, early: code.early, priority: code.priority, target, value });
      }
    }
    if (declarations)
      assert.deepEqual(
        current,
        declarations,
        "Conflicting loading declarations between slots: " + file,
      );
    else declarations = current;
  }
  return { declarations: declarations ?? [], changes: [...changes.values()] };
}

/** 引擎先按脚本名执行 EarlyPython，再按 Init 优先级稳定排序。同一代码内保留赋值顺序。 */
export function resolve_loading(
  declarations: readonly LoadingDeclaration[],
  profile: Pick<RenpyProfile, "archives" | "script_order">,
  files: ReadonlySet<string>,
): {
  archives: string[] | undefined;
  force: boolean;
} {
  let archives: string[] | undefined;
  let force = false;
  // 新引擎的 libs/mods 标记改变脚本排序。排序键沿用 script.sort_script_files。
  const file_key = (file: string): [number, string, string] => {
    const name = file.slice(5, -5);
    if (profile.script_order === "filename") return [0, name, name];
    let group = 1;
    if (files.has("game/libs/libs.txt") && name.startsWith("libs/")) group = 0;
    if (files.has("game/mods/mods.txt") && name.startsWith("mods/")) group = 2;
    const parts = name.split("/");
    const key = group === 1 ? name : parts.slice(parts.length > 2 ? 2 : 1).join("/");
    return [group * 2 + Number(name >= "A"), key, name];
  };
  // 引擎按字符比较路径，区域排序会改变同优先级声明的覆盖顺序。
  const compare_files = (a: string, b: string): number => {
    const left = file_key(a),
      right = file_key(b);
    return (
      left[0] - right[0] ||
      (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0) ||
      (left[2] < right[2] ? -1 : left[2] > right[2] ? 1 : 0)
    );
  };
  const ordered = [...declarations].sort(
    (a, b) =>
      Number(b.early) - Number(a.early) ||
      (a.early ? 0 : a.priority - b.priority) ||
      compare_files(a.file, b.file),
  );
  for (const declaration of ordered) {
    if (declaration.target === "config.archives") {
      const names = declaration.value as string[];
      assert(
        names.every((name) => /^[^/\\:]+$/u.test(name) && name !== "." && name !== ".."),
        "External archive path in " + declaration.file,
      );
      archives = names;
    } else force = declaration.value as boolean;
  }
  return { archives, force };
}
