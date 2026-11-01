import path from "node:path";

import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

import { default_native_fs } from "../../../native/native-fs";
import { agent_skill_base_url, type AgentSkillDefinition } from "../agent-skills";
import { define_agent_tool, AgentToolError, agent_tool_result } from "../tool-definition";

const DEFAULT_SKILL_RESOURCE_PATH = "SKILL.md";
const SKILL_RESOURCE_PATH_INVALID = "skill.resource_path_invalid";
const SKILL_RESOURCE_NOT_FOUND = "skill.resource_not_found";

/** 按当前名称定位技能包，每次调用读取当前磁盘内容。 */
export function create_agent_read_skill_tool(
  get_skills: () => readonly AgentSkillDefinition[],
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
      if (!is_skill_resource_path(resource_path)) throw failure(SKILL_RESOURCE_PATH_INVALID);
      const skill = get_skills().find((candidate) => candidate.name === params.name);
      if (skill === undefined) throw failure(SKILL_RESOURCE_NOT_FOUND);
      const target = path.resolve(path.dirname(skill.filePath), ...resource_path.split("/"));
      let content: string;
      try {
        content = default_native_fs.read_text_file(target);
      } catch (error) {
        throw failure(SKILL_RESOURCE_NOT_FOUND, error); // 缺失、目录等文件系统错误统一视为资源缺失
      }
      return agent_tool_result({
        name: params.name,
        path: resource_path,
        content,
        base_url: agent_skill_base_url(skill.filePath),
      });
    },
  });
}

/** 只接受已规范化的 POSIX 包内相对路径，使 `path` 的含义在各平台一致。 */
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
