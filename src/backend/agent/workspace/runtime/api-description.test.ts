import { describe, it } from "vitest";

import { check_typescript } from "../../../../test/typescript-fixture";
import { format_agent_workspace_typescript_api } from "./api-description";

describe("Agent Workspace 工具说明投影", () => {
  it("生成声明可用于读取契约和调用宿主，缺少必填参数时报错", () => {
    check_typescript([
      `${format_agent_workspace_typescript_api()}
ws.host({ kind: "print_pdf", html: "<p>preview</p>" }).then(result => result.path);
ws.todo.write(["核验"]);
ws.emitImage("work/page.png");
const reference: string = ws.contract.datasets.items.reference;
// @ts-expect-error 宿主打印请求必须包含 html。
ws.host({ kind: "print_pdf" });
`,
    ]);
  });
});
