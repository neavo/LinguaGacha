import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NativeFs } from "../../native/native-fs";
import { AppPathService } from "../app/app-path-service";
import { load_agent_system_prompt } from "./agent-system-prompt";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "./deno/policy";
import { format_agent_workspace_method_routes } from "./methods/api-description";

const cleanup_roots: string[] = []; // 每个用例独立建临时应用根，统一在 afterEach 回收

afterEach(() => {
  while (cleanup_roots.length > 0) {
    const root = cleanup_roots.pop();
    if (root !== undefined) fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("Agent system prompt 加载与资源契约", () => {
  it("从内置模板填充 Workspace 事实并裁剪首尾空白", () => {
    const paths = create_paths();
    write_system_prompt(paths, `\n  prompt-before\n${workspace_placeholders()}\nprompt-after  \n`);

    const prompt = load_agent_system_prompt(paths, new NativeFs());
    const method_routes = format_agent_workspace_method_routes();

    expect(prompt).toContain("prompt-before");
    expect(prompt).toContain(method_routes);
    for (const root of AGENT_WORKSPACE_RUNTIME_POLICY.writeRoots) {
      expect(prompt).toContain(`\`${root}/**\``);
    }
    for (const argument of AGENT_WORKSPACE_RUNTIME_POLICY.denoRestrictionArgs) {
      expect(prompt).toContain(`\`${argument}\``);
    }
    expect(prompt).toContain("prompt-after");
    expect(prompt).not.toContain("{{WORKSPACE_");
    expect(prompt.indexOf("prompt-before")).toBeLessThan(prompt.indexOf(method_routes));
    expect(prompt.indexOf(method_routes)).toBeLessThan(prompt.indexOf("prompt-after"));
  });

  it("资源缺失时保留原始读取异常", () => {
    const paths = create_paths();
    let thrown: unknown;

    try {
      load_agent_system_prompt(paths, new NativeFs());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "file.io_failed" });
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });

  it("资源内容为空时拒绝启动", () => {
    const paths = create_paths();
    write_system_prompt(paths, " \r\n\t");

    expect(() => load_agent_system_prompt(paths, new NativeFs())).toThrow(
      expect.objectContaining({ code: "file.invalid_structure" }),
    );
  });

  it.each([
    ["缺少", workspace_placeholders().replace("{{WORKSPACE_DENO_RESTRICTION_ARGS}}", "")],
    ["重复", `${workspace_placeholders()}\n{{WORKSPACE_DENO_RESTRICTION_ARGS}}`],
    ["未知", `${workspace_placeholders()}\n{{WORKSPACE_UNKNOWN}}`],
  ])("Workspace 占位符%s时拒绝启动", (_label, content) => {
    const paths = create_paths();
    write_system_prompt(paths, content);

    expect(() => load_agent_system_prompt(paths, new NativeFs())).toThrow(
      expect.objectContaining({ code: "file.invalid_structure" }),
    );
  });
});

function workspace_placeholders(): string {
  return [
    "write {{WORKSPACE_WRITE_SCOPES}}",
    "deno {{WORKSPACE_DENO_RESTRICTION_ARGS}}",
    "{{WORKSPACE_METHOD_ROUTES}}",
  ].join("\n");
}

/** 使用真实 AppPathService 解析资源位置，不在测试里复制路径规则。 */
function create_paths(): AppPathService {
  const app_root = fs.mkdtempSync(path.join(os.tmpdir(), "linguagacha-agent-prompt-"));
  cleanup_roots.push(app_root);
  return new AppPathService({
    appRoot: app_root,
    builtinRoot: path.join(app_root, "builtin"),
    env: {},
    platform: "win32",
  });
}

/** 只写当前用例的临时资源，避免读取或污染真实应用目录。 */
function write_system_prompt(paths: AppPathService, content: string): void {
  const file_path = paths.get_agent_system_prompt_path();
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf-8");
}
