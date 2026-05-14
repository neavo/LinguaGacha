import { describe, expect, it, vi } from "vitest";

import type { TaskRuntimePublisher } from "../runtime/task-runtime-publisher";
import { RunCoordinator } from "./run-coordinator";

describe("RunCoordinator", () => {
  it("停止请求未命中当前 run 时不发布 stopping", async () => {
    const publish_status = vi.fn(async () => undefined);
    const coordinator = new RunCoordinator({
      publish_status,
    } as unknown as TaskRuntimePublisher);

    const accepted = await coordinator.request_stop("translation");

    expect(accepted).toBe(false);
    expect(publish_status).not.toHaveBeenCalled();
  });

  it("停止请求命中当前 run 后发布 stopping 并返回 accepted", async () => {
    const publish_status = vi.fn(async () => undefined);
    const coordinator = new RunCoordinator({
      publish_status,
    } as unknown as TaskRuntimePublisher);
    const handle = coordinator.begin("translation");

    const accepted = await coordinator.request_stop("translation");

    expect(accepted).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(publish_status).toHaveBeenCalledWith("translation", "stopping", true);
  });
});
