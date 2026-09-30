import { describe, it } from "vitest";

import { check_typescript } from "../../../../test/typescript-fixture";
import { format_agent_workspace_typescript_api } from "./api-description";

describe("Agent Workspace 工具说明投影", () => {
  it("生成声明可用于读取契约和调用宿主，缺少必填参数时报错", () => {
    check_typescript([
      `${format_agent_workspace_typescript_api()}
ws.host({ kind: "print_pdf", html: "<p>preview</p>" }).then(result => result.path);
ws.emitImage("work/page.png");
const doing: Promise<void> = ws.doing("检查章节");
ws.doing(null);
// @ts-expect-error 阶段只接受文本或 null。
ws.doing(1);
// @ts-expect-error 清空必须显式传入 null。
ws.doing();
ws.emitImage("work/detail.png", { maxEdge: 3840 });
// @ts-expect-error 尺寸使用数字。
ws.emitImage("work/detail.png", { maxEdge: "3840" });
const reference: string = ws.contract.datasets.items.reference;
const skillDirectory: string = ws.userSkillDirectory;
// @ts-expect-error 宿主打印请求必须包含 html。
ws.host({ kind: "print_pdf" });
`,
    ]);
  });
});
