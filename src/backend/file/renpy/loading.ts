import assert from "node:assert/strict";
import type { RenpyMember } from "./member";
import type { RenpyLoadingChange } from "./patch";
import { analyze_code } from "./script";
import { PythonSyntaxError, type PythonSession } from "./python-syntax";
import type { RenpyProfile } from "./profile";
import { order_initialization, type RenpyInitPosition } from "./initialization";

type LoadingDeclaration = RenpyInitPosition & {
  target: string;
  value: boolean | string[];
};

/** 只消费直接初始化赋值。普通代码、配置读取和未知表达式不提供加载事实。 */
export async function read_loading(
  member: RenpyMember,
  file: string,
  profile: Pick<RenpyProfile, "archives">,
  session: PythonSession,
  signal?: AbortSignal,
): Promise<{ declarations: LoadingDeclaration[]; changes: RenpyLoadingChange[] }> {
  const changes = new Map<string, RenpyLoadingChange>(); // 多个消费者共享同一源码边时只改写一次。
  let declarations: LoadingDeclaration[] | undefined; // 槽位是同一脚本的不同表示，加载声明必须一致。
  for (const slot of member.slots) {
    const current: LoadingDeclaration[] = [];
    for (const code of member.codes) {
      if (code.slot !== slot.slot || code.phase !== "init" || code.source === null) continue;
      let facts;
      try {
        facts = await analyze_code(code, session, member.python2, signal);
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

/** 按引擎初始化顺序应用加载声明，后者覆盖前者。 */
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
  for (const declaration of order_initialization(declarations, profile, files)) {
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
