import { describe, expect, it } from "vitest";

import { normalize_renderer_error_report } from "./renderer-error-report";
import { summarize_diagnostic_path } from "./error-diagnostic";

describe("renderer error report", () => {
  it("收窄 renderer 异常报告并保留显式路径摘要", () => {
    const report = normalize_renderer_error_report({
      source: "worker",
      diagnostic: {
        name: "Error",
        message: "worker 爆炸",
        context: {
          output_path: summarize_diagnostic_path("E:/secret/out/result.txt"),
        },
      },
      project: {
        path: "E:/secret/project/demo.lg",
        items: {
          "1": {
            dst: "不应进入日志",
          },
        },
      },
      task: {
        status: "running",
        extra_payload: {
          hidden: true,
        },
      },
      triggeringEvent: {
        topic: "project.data_changed",
        projectPath: "E:/secret/project/demo.lg",
        items: {
          changedIds: [1],
        },
      },
      context: {
        stage: "commit_project_mutation",
        filename: "E:/secret/renderer.js",
        location: "file:///E:/secret/index.html?token=hidden",
        projectPath: "E:/secret/project/demo.lg",
      },
    });

    expect(report).toMatchObject({
      source: "worker",
      diagnostic: {
        name: "Error",
        message: "worker 爆炸",
        context: {
          output_path: {
            basename: "result.txt",
            pathHash: expect.any(String),
            length: 24,
          },
        },
      },
      project: {
        path: {
          basename: "demo.lg",
          pathHash: expect.any(String),
          length: 25,
        },
      },
      task: {
        status: "running",
      },
      triggeringEvent: {
        topic: "project.data_changed",
        projectPath: {
          basename: "demo.lg",
          pathHash: expect.any(String),
          length: 25,
        },
      },
      context: {
        stage: "commit_project_mutation",
        filename: {
          basename: "renderer.js",
          pathHash: expect.any(String),
          length: 21,
        },
        location: {
          scheme: "file",
          hrefHash: expect.any(String),
          pathBasename: "index.html",
        },
      },
    });
    expect(report.project).not.toHaveProperty("items");
    expect(report.task).not.toHaveProperty("extra_payload");
    expect(report.triggeringEvent).not.toHaveProperty("items");
    expect(report.context).not.toHaveProperty("projectPath");
    expect(JSON.stringify(report.context)).not.toContain("secret");
  });
});
