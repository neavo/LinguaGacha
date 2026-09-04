import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { default_native_fs, type NativeFs } from "../../../native/native-fs";
import {
  load_agent_skills,
  type AgentSkillDefinition,
  type AgentSkillLog,
  type AgentSkillPaths,
} from "../agent-skills";
import { AgentToolError, agent_tool_result } from "./definition";

const DEFAULT_SKILL_RESOURCE_PATH = "SKILL.md";

const READ_SKILL_PARAMETERS = Type.Object(
  {
    name: Type.String({
      description: "要读取的 skill 名称。",
      minLength: 1,
      pattern: "^[a-z0-9-]+$",
    }),
    path: Type.Optional(
      Type.String({ description: "skill 包内的相对文件路径；缺省读取 SKILL.md。" }),
    ),
  },
  { additionalProperties: false },
);

type AgentSkillNativeFs = Pick<NativeFs, "read_text_file" | "real_path" | "stat">;

/** 按逻辑 skill 名称读取包内文件；catalog 外的新 skill 在调用时实时发现。 */
export function create_agent_skill_tools(
  session_skills: readonly AgentSkillDefinition[],
  paths: AgentSkillPaths,
  log_manager: AgentSkillLog,
  native_fs: AgentSkillNativeFs = default_native_fs,
): ToolDefinition[] {
  return [
    defineTool({
      name: "read_skill",
      label: "读技能",
      description:
        "读取指定 skill 包内的普通文件。当前会话 skill 使用已冻结的获胜定义；新名称会实时发现。返回 name、相对 path 与 content，只读且不暴露磁盘位置。",
      parameters: READ_SKILL_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const resource_path = normalize_skill_resource_path(params.path);
        if (resource_path === null) {
          throw new AgentToolError({
            code: "skill.resource_not_allowed",
            name: params.name,
            path: params.path ?? DEFAULT_SKILL_RESOURCE_PATH,
          });
        }
        // 已知名称绑定当前会话胜者；只有未知名称才实时发现，避免同名覆盖半途生效。
        const skill =
          session_skills.find((candidate) => candidate.name === params.name) ??
          (await load_agent_skills(paths, log_manager)).find(
            (candidate) => candidate.name === params.name,
          );
        if (skill === undefined) {
          throw new AgentToolError({
            code: "skill.resource_not_found",
            name: params.name,
            path: resource_path,
          });
        }
        try {
          const source_root = find_skill_source_root(skill.filePath, paths);
          if (source_root === null) {
            throw new AgentToolError({
              code: "skill.resource_not_allowed",
              name: params.name,
              path: resource_path,
            });
          }
          const real_source_root = native_fs.real_path(source_root);
          const skill_root = native_fs.real_path(path.dirname(skill.filePath));
          if (!is_path_at_or_inside(skill_root, real_source_root)) {
            throw new AgentToolError({
              code: "skill.resource_not_allowed",
              name: params.name,
              path: resource_path,
            });
          }
          const target = native_fs.real_path(path.resolve(skill_root, ...resource_path.split("/")));
          if (!is_path_at_or_inside(target, skill_root) || !native_fs.stat(target).isFile()) {
            throw new AgentToolError({
              code: "skill.resource_not_allowed",
              name: params.name,
              path: resource_path,
            });
          }
          return agent_tool_result({
            name: params.name,
            path: resource_path,
            content: native_fs.read_text_file(target),
          });
        } catch (error) {
          if (error instanceof AgentToolError) throw error;
          throw new AgentToolError(
            { code: "skill.resource_not_found", name: params.name, path: resource_path },
            error,
          );
        }
      },
    }),
  ];
}

/** 只接受已规范化的 POSIX 包内相对路径，拒绝平台差异制造的绕过形式。 */
function normalize_skill_resource_path(value: string | undefined): string | null {
  const resource_path = value ?? DEFAULT_SKILL_RESOURCE_PATH;
  if (
    resource_path === "" ||
    resource_path.includes("\\") ||
    path.posix.isAbsolute(resource_path) ||
    path.win32.isAbsolute(resource_path) ||
    resource_path === ".." ||
    resource_path.startsWith("../") ||
    path.posix.normalize(resource_path) !== resource_path
  ) {
    return null;
  }
  return resource_path;
}

/** 识别定义所属的受信 skill 根；真实路径约束由读取阶段继续验证。 */
function find_skill_source_root(file_path: string, paths: AgentSkillPaths): string | null {
  return (
    [paths.get_agent_user_skill_dir(), paths.get_agent_builtin_skill_dir()].find((root) =>
      is_path_at_or_inside(file_path, root),
    ) ?? null
  );
}

/** 用 path.relative 判定同一路径或后代路径，兼容 Windows 盘符与大小写语义。 */
function is_path_at_or_inside(target: string, root: string): boolean {
  const relative_path = path.relative(root, target);
  return (
    relative_path !== ".." &&
    !relative_path.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative_path)
  );
}
