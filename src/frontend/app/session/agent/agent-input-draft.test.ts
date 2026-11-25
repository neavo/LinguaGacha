import { expect, it, vi } from "vitest";
import { uploaded_file } from "../../../../test/agent-upload-fixture";
import { AgentInputDraft } from "./agent-input-draft";

it("组件退订后上传继续，正文和混排顺序保留", async () => {
  const pending = Promise.withResolvers<ReturnType<typeof uploaded_file>>();
  const upload = vi.fn();
  upload.mockReturnValueOnce(pending.promise);
  const draft = new AgentInputDraft(upload);
  const unsubscribe = draft.subscribe(vi.fn());
  const appended = draft.append([new File(["text"], "notes.txt")]);
  draft.write({
    text: "正在输入",
    attachments: [
      ...draft.read().attachments,
      { kind: "response_annotation", selectedText: "引用", comment: "" },
    ],
  });
  unsubscribe();
  pending.resolve(uploaded_file("notes", null));
  await appended;
  expect(draft.read()).toEqual({
    text: "正在输入",
    attachments: [
      uploaded_file("notes", null),
      { kind: "response_annotation", selectedText: "引用", comment: "" },
    ],
  });
});

it("失败项原位重试，移除或清空后迟到结果不会回填", async () => {
  const upload = vi.fn();
  upload.mockRejectedValueOnce(new Error("offline"));
  const draft = new AgentInputDraft(upload);
  await draft.append([new File([], "empty.bin")]);
  expect(draft.read().attachments[0]).toMatchObject({ status: "failed" });
  const item = draft.read().attachments[0]!;
  if (item.kind !== "upload") throw new Error("missing upload");
  const pending = Promise.withResolvers<ReturnType<typeof uploaded_file>>();
  upload.mockReturnValueOnce(pending.promise);
  draft.retry(item.id);
  await Promise.resolve();
  const signal = upload.mock.calls.at(-1)![2] as AbortSignal;
  draft.clear();
  expect(signal.aborted).toBe(true);
  pending.resolve(uploaded_file("late"));
  await Promise.resolve();
  await Promise.resolve();
  expect(draft.read().attachments).toEqual([]);
});
