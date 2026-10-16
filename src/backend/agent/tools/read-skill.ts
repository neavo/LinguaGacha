import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import { default_native_fs, type NativeFs } from "../../../native/native-fs";
import {
  agent_skill_base_url,
  type AgentSkillDefinition,
  type AgentSkillPaths,
} from "../agent-skills";
import { define_agent_tool, AgentToolError, agent_tool_result } from "../tool-definition";

const DEFAULT_SKILL_RESOURCE_PATH = "SKILL.md";
const SKILL_RESOURCE_NOT_ALLOWED = "skill.resource_not_allowed";
const SKILL_RESOURCE_NOT_FOUND = "skill.resource_not_found";

type AgentSkillNativeFs = Pick<NativeFs, "read_text_file" | "real_path" | "stat">;

/** 按当前名称定位技能包，每次调用读取当前磁盘内容。 */
export function create_agent_read_skill_tool(
  get_skills: () => readonly AgentSkillDefinition[],
  paths: AgentSkillPaths,
  native_fs: AgentSkillNativeFs = default_native_fs,
): ToolRegistration {
  return define_agent_tool({
    name: "read_skill",
    executionMode: "sequential",
    description: [
      "读取指定技能的正文或包内参考文件：",
      "- `content` 是所读文件的内容。",
      "- `base_url` 是以 `/` 结尾的技能包根目录 `file:` URL。",
      "在后续 `workspace_run` 脚本中，将返回的 `base_url` 值赋给同名变量，再用 `await import(new URL('scripts/example.mjs', base_url).href)` 加载技能脚本。",
    ].join("\n\n"),
    parameters: Type.Object(
      {
        name: Type.String({
          description: "要读取的技能名称。",
          minLength: 1,
        }),
        path: Type.Optional(
          Type.String({
            description: `技能包内的相对文件路径，使用 / 分隔，省略时读取 ${DEFAULT_SKILL_RESOURCE_PATH}。`,
          }),
        ),
      },
      { additionalProperties: false },
    ),
    execute: async (params, _api, context) => {
      const signal = context.abortSignal;
      signal?.throwIfAborted();
      const resource_path = params.path ?? DEFAULT_SKILL_RESOURCE_PATH;
      const failure = (code: string, cause?: unknown) =>
        new AgentToolError({ code, name: params.name, path: resource_path }, cause);
      if (!is_skill_resource_path(resource_path)) throw failure(SKILL_RESOURCE_NOT_ALLOWED);
      const skill = get_skills().find((candidate) => candidate.name === params.name);
      if (skill === undefined) throw failure(SKILL_RESOURCE_NOT_FOUND);
      try {
        const source_root = find_skill_source_root(skill.filePath, paths);
        if (source_root === null) throw failure(SKILL_RESOURCE_NOT_ALLOWED);
        // 先确认技能目录未经链接逃出受信根，再解析包内目标，避免越界目标被报告为缺失。
        const skill_root = native_fs.real_path(path.dirname(skill.filePath));
        if (!is_path_at_or_inside(skill_root, native_fs.real_path(source_root)))
          throw failure(SKILL_RESOURCE_NOT_ALLOWED);
        const target = native_fs.real_path(path.resolve(skill_root, ...resource_path.split("/")));
        if (!is_path_at_or_inside(target, skill_root) || !native_fs.stat(target).isFile())
          throw failure(SKILL_RESOURCE_NOT_ALLOWED);
        return agent_tool_result({
          name: params.name,
          path: resource_path,
          content: native_fs.read_text_file(target),
          base_url: agent_skill_base_url(skill.filePath),
        });
      } catch (error) {
        if (error instanceof AgentToolError) throw error;
        throw failure(SKILL_RESOURCE_NOT_FOUND, error); // 文件系统错误统一视为资源缺失
      }
    },
  });
}

/** 只接受已规范化的 POSIX 包内相对路径，拒绝平台差异制造的绕过形式。 */
function is_skill_resource_path(resource_path: string): boolean {
  return !(
    resource_path === "" ||
    resource_path.includes("\\") ||
    path.posix.isAbsolute(resource_path) ||
    path.win32.isAbsolute(resource_path) ||
    resource_path === ".." ||
    resource_path.startsWith("../") ||
    path.posix.normalize(resource_path) !== resource_path
  );
}

/** 识别技能定义所属的受信根目录。读取阶段验证真实路径。 */
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
