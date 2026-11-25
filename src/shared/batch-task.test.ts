import { expect, it } from "vitest";
import {
  batch_task_metrics,
  empty_batch_task_list_snapshot,
  read_batch_task_list_snapshot,
} from "./batch-task";
import { create_batch_task_snapshot, empty_batch_task_progress } from "../domain/batch-task";

it("同类任务合计目标与已结算数，混合任务只合计在途请求", () => {
  const request = {
    ...create_batch_task_snapshot("request", "request", "agent"),
    request_in_flight_count: 2,
    progress: { ...empty_batch_task_progress("request", 10), failed: 4 },
  };
  const other = {
    ...request,
    run_id: "other",
    progress: { ...empty_batch_task_progress("request", 30), succeeded: 6 },
  };
  const base = empty_batch_task_list_snapshot();
  expect(batch_task_metrics({ ...base, tasks: [request, other] }, 0)).toMatchObject({
    kind: "request",
    completion_percent: 25,
    request_in_flight_count: 4,
  });
  const translation = create_batch_task_snapshot("translation", "translation", "standalone");
  expect(batch_task_metrics({ ...base, tasks: [request, translation] }, 0)).toMatchObject({
    kind: "mixed",
    completion_percent: null,
    request_in_flight_count: 2,
  });
  expect(
    batch_task_metrics({ ...base, tasks: [{ ...request, progress: null }] }, 0).completion_percent,
  ).toBeNull();
});

it("读取经 JSON 传输的工程汇总，拒绝非数值进度", () => {
  const snapshot = {
    ...empty_batch_task_list_snapshot(),
    revision: 1,
    project_path: "project.lg",
    activity: {
      id: "request",
      start_time: 1,
      usage: { input_tokens: 8, reasoning_tokens: 4, output_tokens: 20 },
    },
    tasks: [
      {
        ...create_batch_task_snapshot("request", "request", "agent"),
        endpoint: { id: "provider", name: "测试接入点", model_id: "test", thinking_level: "LOW" },
        progress: empty_batch_task_progress("request", 1),
      },
    ],
  };
  const payload: unknown = JSON.parse(JSON.stringify({ batch_tasks: snapshot }));
  expect(read_batch_task_list_snapshot(payload)).toEqual(snapshot);
  const task = snapshot.tasks[0]!;
  expect(() =>
    read_batch_task_list_snapshot({
      batch_tasks: {
        ...snapshot,
        tasks: [{ ...task, progress: { ...task.progress, succeeded: "2" } }],
      },
    }),
  ).toThrow();
});

it("按各自原始目标估算并行剩余时间并合计工程数据", () => {
  const endpoint = {
    id: "shared",
    name: "共用接入点",
    model_id: "model",
    thinking_level: "LOW",
  } as const;
  const translation = {
    ...create_batch_task_snapshot("translation", "translation", "standalone"),
    endpoint,
    progress: {
      ...empty_batch_task_progress("item", 100),
      start_time: 100,
      succeeded: 75,
      failed: 5,
    },
  };
  const request = {
    ...create_batch_task_snapshot("request", "request", "agent"),
    endpoint,
    progress: { ...empty_batch_task_progress("request", 10), start_time: 130, succeeded: 2 },
  };
  const activity = {
    id: "translation",
    start_time: 90,
    usage: { input_tokens: 800, reasoning_tokens: 50, output_tokens: 150 },
  };
  const snapshot = { ...empty_batch_task_list_snapshot(), activity };
  const now = 150;
  expect(batch_task_metrics({ ...snapshot, tasks: [translation, request] }, now)).toMatchObject({
    endpoints: [endpoint],
    elapsed_seconds: 60,
    remaining_seconds: 80,
    average_speed: 200 / 60,
    usage: activity.usage,
  });
  const high = { ...endpoint, thinking_level: "HIGH" } as const;
  expect(
    batch_task_metrics({ ...snapshot, tasks: [translation, { ...request, endpoint: high }] }, now)
      .endpoints,
  ).toEqual([endpoint, high]);
  const preparing = { ...request, progress: { ...request.progress, succeeded: 0 } };
  expect(
    batch_task_metrics({ ...snapshot, tasks: [translation, preparing] }, now).remaining_seconds,
  ).toBe(12.5);
  expect(batch_task_metrics({ ...snapshot, tasks: [preparing] }, now).remaining_seconds).toBe(0);
});
