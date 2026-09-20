import { uploaded_file } from "../test/agent-upload-fixture";
import { describe, expect, it } from "vitest";

import {
  normalize_agent_assistant_message_parts,
  normalize_agent_message_input,
  normalize_agent_revision_request,
  normalize_agent_user_message_text,
} from "./agent";

describe("Agent assistant 消息协议", () => {
  it("删除纯空白并合并相邻同类，同时保留可见正文原值", () => {
    expect(
      normalize_agent_assistant_message_parts([
        { kind: "thinking", text: " \n " },
        { kind: "thinking", text: "检查" },
        { kind: "thinking", text: "\n完成" },
        { kind: "text", text: "\t" },
        { kind: "text", text: " 结论 " },
      ]),
    ).toEqual([
      { kind: "thinking", text: "检查\n完成" },
      { kind: "text", text: " 结论 " },
    ]);
    expect(
      normalize_agent_assistant_message_parts([
        { kind: "thinking", text: " \n " },
        { kind: "text", text: "\t" },
      ]),
    ).toBeNull();
  });
});

describe("Agent 用户消息协议", () => {
  it("拒绝非字符串和纯空白，只裁剪有效正文外缘", () => {
    expect(normalize_agent_user_message_text(null)).toBeNull();
    expect(normalize_agent_user_message_text(["正文"])).toBeNull();
    expect(normalize_agent_user_message_text(" \n ")).toBeNull();
    expect(normalize_agent_user_message_text(" \n 先  用 \n处理 \t")).toBe("先  用 \n处理");
  });

  it("规范文本与有序附件，并允许纯附件消息", () => {
    expect(
      normalize_agent_message_input({
        text: "  处理附件  ",
        attachments: [
          uploaded_file("image-a"),
          { kind: "response_annotation", selectedText: " 旧回复 ", comment: " 改写 " },
        ],
      }),
    ).toEqual({
      text: "处理附件",
      attachments: [
        uploaded_file("image-a"),
        { kind: "response_annotation", selectedText: "旧回复", comment: "改写" },
      ],
    });
    expect(
      normalize_agent_message_input({
        text: "",
        attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: " \n " }],
      }),
    ).toEqual({
      text: "",
      attachments: [{ kind: "response_annotation", selectedText: "旧回复", comment: "" }],
    });
    expect(normalize_agent_message_input({ text: "", attachments: [] })).toBeNull();
    expect(normalize_agent_message_input({ text: "正文" })).toBeNull();
    expect(normalize_agent_message_input({ text: "正文", attachments: [1] })).toBeNull();
    expect(
      normalize_agent_message_input({
        text: "",
        attachments: [{ kind: "response_annotation", selectedText: " ", comment: "评论" }],
      }),
    ).toBeNull();
  });

  it("请求只信任上传身份，快照保留后端记录并拒绝旧图片载荷", () => {
    const file = uploaded_file("known");
    expect(
      normalize_agent_message_input(
        { text: "", attachments: [{ kind: "file", uploadId: "known", path: "../../private" }] },
        () => file,
      ),
    ).toEqual({ text: "", attachments: [file] });
    expect(
      normalize_agent_message_input({
        text: "",
        attachments: [{ kind: "image", webpBase64: "old" }],
      }),
    ).toBeNull();
  });

  it("规范轮次修订的目标身份与替换消息", () => {
    expect(
      normalize_agent_revision_request({
        entryId: "assistant-1",
        message: { text: " 修订 ", attachments: [] },
      }),
    ).toEqual({ entryId: "assistant-1", message: { text: "修订", attachments: [] } });
    expect(
      normalize_agent_revision_request({ entryId: "", message: { text: "修订", attachments: [] } }),
    ).toBeNull();
    expect(normalize_agent_revision_request({ entryId: "assistant-1" })).toBeNull();
  });
});
