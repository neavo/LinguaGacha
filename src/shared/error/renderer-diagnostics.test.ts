import { describe, expect, it } from "vitest";

import {
  normalize_renderer_diagnostics_payload,
  normalize_renderer_error_context,
} from "./renderer-diagnostics";

describe("renderer diagnostics payload", () => {
  it("renderer 诊断面包屑归一成唯一载荷形状", () => {
    const payload = normalize_renderer_diagnostics_payload({
      route: "workbench",
      project: {
        path: "E:/secret/project/demo.lg",
        sessionStatus: "ready",
      },
      event: {
        topic: "project.data_changed",
        projectPath: "E:/secret/project/demo.lg",
      },
    });

    expect(payload).toMatchObject({
      route: "workbench",
      project: {
        path: {
          basename: "demo.lg",
          pathHash: expect.any(String),
          length: 25,
        },
        sessionStatus: "ready",
      },
      event: {
        topic: "project.data_changed",
        projectPath: {
          basename: "demo.lg",
          pathHash: expect.any(String),
          length: 25,
        },
      },
    });
  });

  it("renderer error context 只保留白名单字段并摘要敏感身份", () => {
    const context = normalize_renderer_error_context({
      stage: "handle_task_snapshot_changed",
      filename: "E:/secret/app/renderer.js",
      location: "file:///E:/secret/app/index.html?token=hidden",
      projectPath: "E:/secret/project/demo.lg",
    });

    expect(context).toMatchObject({
      stage: "handle_task_snapshot_changed",
      filename: {
        basename: "renderer.js",
        pathHash: expect.any(String),
        length: 25,
      },
      location: {
        scheme: "file",
        hrefHash: expect.any(String),
        pathBasename: "index.html",
      },
    });
    expect(context).not.toHaveProperty("projectPath");
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(JSON.stringify(context)).not.toContain("token");
  });

  it("renderer error context 的敏感字段不接受对象逃逸", () => {
    const context = normalize_renderer_error_context({
      filename: {
        path: "E:/secret/renderer.js",
      },
      location: {
        href: "file:///E:/secret/index.html?token=hidden",
      },
    });

    expect(context).toMatchObject({
      filename: {
        basename: "",
        length: 0,
      },
      location: {
        hrefHash: expect.any(String),
        length: 0,
      },
    });
    expect(JSON.stringify(context)).not.toContain("secret");
    expect(JSON.stringify(context)).not.toContain("token");
  });
});
