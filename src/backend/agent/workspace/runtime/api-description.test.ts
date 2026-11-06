import { describe, it } from "vitest";

import { check_typescript } from "../../../../test/typescript-fixture";
import { format_agent_workspace_typescript_api } from "./api-description";

describe("Agent Workspace 工具说明投影", () => {
  it("生成声明可用于读取契约和调用宿主，缺少必填参数时报错", () => {
    check_typescript([
      `${format_agent_workspace_typescript_api()}
ws.emitImage("work/page.png");
const doing: Promise<void> = ws.setDoing("检查章节");
ws.setDoing(null);
// @ts-expect-error 阶段只接受文本或 null。
ws.setDoing(1);
// @ts-expect-error 清空必须显式传入 null。
ws.setDoing();
ws.emitImage("work/detail.png", { maxEdge: 3840 });
// @ts-expect-error 尺寸使用数字。
ws.emitImage("work/detail.png", { maxEdge: "3840" });
const reference: string = ws.contract.datasets.items.reference;
const skillDirectory: string = ws.userSkillDirectory;
const fontsDirectory: string = ws.fontsDirectory;
// @ts-expect-error 旧阶段写入方法已移除。
ws.doing("检查章节");
// @ts-expect-error 领域能力不属于 ws。
ws.host({ kind: "print_pdf" });
`,
    ]);
  });
});
