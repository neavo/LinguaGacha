import {
  createModels,
  fauxProvider,
  fauxAssistantMessage,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { expect, it, onTestFinished, vi } from "vitest";
import { AgentSession, type AgentExecution } from "./agent-session";
import { AgentSessionLog } from "./agent-log";

/** 隔离远程流，事务、提交订阅与历史投影使用真实 Harness。 */
async function create_session() {
  const provider = fauxProvider();
  const models = createModels();
  models.setProvider(provider.provider);
  const session = await AgentSession.open({
    sessionId: "session-test",
    cwd: process.cwd(),
    models,
    model: provider.getModel(),
    thinkingLevel: "off",
    seed: [
      { role: "user", content: "种子输入" },
      { role: "assistant", content: "种子回答" },
    ],
    tools: [],
    systemPrompt: () => "测试系统指令",
    skillsPrompt: () => "",
    continueText: () => "继续",
    log: new AgentSessionLog({ append: vi.fn() }),
    onChange: vi.fn(),
    onModelEvent: vi.fn(),
    onReport: vi.fn(),
    onCompactionFailure: vi.fn(),
  });
  onTestFinished(() => session.close());
  return { session, provider };
}

it("种子进入模型历史，公开时间线从真实输入开始", async () => {
  const { session, provider } = await create_session();
  const respond = vi.fn<FauxResponseFactory>(() => fauxAssistantMessage("完成"));
  provider.setResponses([respond]);
  const execution: AgentExecution = {
    controller: new AbortController(),
    lease: { owner: "agent" },
    roundId: null,
    phase: "running",
    acceptance: null,
    settlement: null,
    recoveryUsed: false,
    recoveryTask: null,
    steer: null,
    retrySteer: null,
    translationPaused: null,
  };
  session.execution = execution;
  const accepted = await session.submit(
    { text: "正文", attachments: [] },
    { text: "正文", images: [] },
    execution,
    "round",
  );
  await session.run(accepted, execution);
  const messages = respond.mock.calls[0]![0].messages.filter(
    (message) => message.role !== "system",
  );
  expect(messages).toMatchObject([
    { role: "user", content: "种子输入" },
    { role: "assistant", content: [{ type: "text", text: "种子回答" }] },
    { role: "user", content: [{ type: "text", text: "正文" }] },
  ]);
  expect(session.entries).toMatchObject([
    { kind: "user_message", text: "正文" },
    { kind: "assistant_message", parts: [{ kind: "text", text: "完成" }] },
  ]);
});

it("队列事务失败完整回滚，读出的副本无法修改已提交事实", async () => {
  const { session } = await create_session();
  const queued = await session.change_queue((queue) =>
    queue.enqueue({ text: "保留", attachments: [] }),
  );
  const before = session.queue.read_snapshot(false);
  await expect(
    session.change_queue((queue) => {
      queue.delete(queued.id);
      queue.enqueue({ text: "回滚", attachments: [] });
      throw new Error("提交失败");
    }),
  ).rejects.toThrow("提交失败");
  session.queue.delete(queued.id);
  queued.text = "外部改写";
  expect(session.queue.read_snapshot(false)).toEqual(before);
});
