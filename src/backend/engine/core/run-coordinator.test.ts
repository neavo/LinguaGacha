import { describe, expect, it } from "vitest";

import type { TaskRunPublisher } from "../run/task-run-publisher";
import { RunCoordinator } from "./run-coordinator";

describe("RunCoordinator", () => {
  it("停止请求未命中当前 run 时不发布 stopping", async () => {
    const published_statuses: PublishedStatus[] = [];
    const coordinator = new RunCoordinator({
      publish_status: async (task_type: string, status: string, busy: boolean) => {
        published_statuses.push([task_type, status, busy]);
      },
    } as unknown as TaskRunPublisher);

    const accepted = await coordinator.request_stop("translation");

    expect(accepted).toBe(false);
    expect(published_statuses).toEqual([]);
  });

  it("停止请求命中当前 run 后发布 stopping 并返回 accepted", async () => {
    const published_statuses: PublishedStatus[] = [];
    const coordinator = new RunCoordinator({
      publish_status: async (task_type: string, status: string, busy: boolean) => {
        published_statuses.push([task_type, status, busy]);
      },
    } as unknown as TaskRunPublisher);
    const handle = coordinator.begin("translation");

    const accepted = await coordinator.request_stop("translation");

    expect(accepted).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    expect(published_statuses).toEqual([["translation", "stopping", true]]);
  });
});

type PublishedStatus = [task_type: string, status: string, busy: boolean];
