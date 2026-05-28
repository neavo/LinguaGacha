import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

import {
  normalize_log_error,
  RuntimeCancelledError,
  RuntimeDisposedError,
  WorkerExecutionFailedError,
} from "../../../../shared/error";
import { resolve_default_worker_count } from "../../../../shared/utils/worker-capacity-tool";
import type { CoreWorkerExecution } from "../../../worker/core-worker-execution";
import {
  count_name_field_rows,
  extract_name_field_rows,
  filter_name_field_rows,
  get_name_field_filter_error,
} from "../../../../shared/name-field-extraction/name-field-extraction";
import { build_ts_conversion_converted_items } from "../../../../shared/ts-conversion/ts-conversion";
import {
  run_quality_statistics_task_sync,
  type QualityStatisticsDependencySnapshot,
  type QualityStatisticsRelationCandidate,
  type QualityStatisticsRuleInput,
} from "../../../../shared/quality/quality-statistics";
import type {
  ProjectReadModelComputeQualityStatisticsMessage,
  ProjectReadModelExtractNameFieldsMessage,
  ProjectReadModelNameFieldExtractionResult,
  ProjectReadModelQualityStatisticsInput,
  ProjectReadModelTsConversionInput,
  ProjectReadModelWorkerIncomingMessage,
  ProjectReadModelWorkerOutgoingMessage,
} from "./project-read-model-worker-types";
import type { TsConversionConvertedItem } from "../../../../shared/ts-conversion/ts-conversion";

interface ProjectReadModelWorkerPoolOptions {
  execution: CoreWorkerExecution;
  workerCount?: number;
}

interface PendingTask {
  id: string;
  message: Exclude<ProjectReadModelWorkerIncomingMessage, { type: "cancel" }>;
  signal: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  abort_listener: () => void;
}

interface WorkerSlot {
  worker: Worker;
  task: PendingTask | null;
}

export class ProjectReadModelWorkerPool {
  private readonly execution: CoreWorkerExecution;
  private readonly worker_count: number;
  private readonly queue: PendingTask[] = [];
  private readonly slots: WorkerSlot[] = [];
  private readonly in_process_in_flight = new Map<string, PendingTask>();
  private disposed = false;

  public constructor(options: ProjectReadModelWorkerPoolOptions) {
    this.execution = options.execution;
    this.worker_count = resolve_default_worker_count({
      workerCount: options.workerCount,
      availableParallelism: os.availableParallelism?.() ?? os.cpus().length,
    });
    if (this.execution.kind === "in_process") {
      return;
    }
    for (let index = 0; index < this.worker_count; index += 1) {
      this.slots.push(this.create_slot());
    }
  }

  public compute_quality_statistics(
    input: ProjectReadModelQualityStatisticsInput,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.enqueue({ id: "", type: "compute_quality_statistics", input }, signal) as Promise<
      Record<string, unknown>
    >;
  }

  public extract_name_fields(
    input: ProjectReadModelExtractNameFieldsMessage["input"],
    signal: AbortSignal,
  ): Promise<ProjectReadModelNameFieldExtractionResult> {
    return this.enqueue(
      { id: "", type: "extract_name_fields", input },
      signal,
    ) as Promise<ProjectReadModelNameFieldExtractionResult>;
  }

  public convert_ts_items(
    input: ProjectReadModelTsConversionInput,
    signal: AbortSignal,
  ): Promise<TsConversionConvertedItem[]> {
    return this.enqueue({ id: "", type: "convert_ts_items", input }, signal) as Promise<
      TsConversionConvertedItem[]
    >;
  }

  public async dispose(): Promise<void> {
    this.disposed = true;
    for (const task of this.queue.splice(0, this.queue.length)) {
      this.reject_task(task, this.create_disposed_error());
    }
    for (const task of this.in_process_in_flight.values()) {
      this.reject_task(task, this.create_disposed_error());
    }
    this.in_process_in_flight.clear();
    for (const slot of this.slots) {
      if (slot.task !== null) {
        this.reject_task(slot.task, this.create_disposed_error());
        slot.task = null;
      }
    }
    await Promise.allSettled(this.slots.map((slot) => slot.worker.terminate()));
    this.slots.length = 0;
  }

  private enqueue(
    message: Exclude<ProjectReadModelWorkerIncomingMessage, { type: "cancel" }>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(this.create_disposed_error());
    }
    if (signal.aborted) {
      return Promise.reject(this.create_cancelled_error());
    }
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const task: PendingTask = {
        id,
        message: { ...message, id },
        signal,
        resolve,
        reject,
        abort_listener: () => this.cancel_task(task),
      };
      signal.addEventListener("abort", task.abort_listener, { once: true });
      this.queue.push(task);
      this.drain_queue();
    });
  }

  private drain_queue(): void {
    if (this.execution.kind === "in_process") {
      this.drain_in_process_queue();
      return;
    }
    for (const slot of this.slots) {
      if (slot.task !== null || this.queue.length === 0) {
        continue;
      }
      const task = this.queue.shift();
      if (task !== undefined) {
        slot.task = task;
        slot.worker.postMessage(task.message);
      }
    }
  }

  private drain_in_process_queue(): void {
    if (this.in_process_in_flight.size > 0) {
      return;
    }
    const task = this.queue.shift();
    if (task === undefined) {
      return;
    }
    this.in_process_in_flight.set(task.id, task);
    void this.execute_in_process(task);
  }

  private async execute_in_process(task: PendingTask): Promise<void> {
    try {
      if (task.signal.aborted) {
        throw this.create_cancelled_error();
      }
      const data = await this.run_in_process_task(task.message);
      this.finish_in_process_task(task.id, data, null);
    } catch (error) {
      this.finish_in_process_task(task.id, null, error);
    }
  }

  private async run_in_process_task(message: PendingTask["message"]): Promise<unknown> {
    if (message.type === "extract_name_fields") {
      const rows = extract_name_field_rows({
        items: message.input.items,
        glossary_entries: message.input.glossary_entries,
      });
      return {
        rows: filter_name_field_rows({
          rows,
          filter_state: message.input.filter,
          sort_state: message.input.sort,
        }),
        counts: count_name_field_rows(rows),
        invalid_regex_message: get_name_field_filter_error(message.input.filter),
      };
    }
    if (message.type === "convert_ts_items") {
      return build_ts_conversion_converted_items(message.input);
    }
    return this.compute_quality_statistics_in_process(message);
  }

  private compute_quality_statistics_in_process(
    message: ProjectReadModelComputeQualityStatisticsMessage,
  ): Record<string, unknown> {
    const rule_key = message.input.rule_key;
    const src_texts = message.input.items.map((item) => String(item["src"] ?? ""));
    const dst_texts = message.input.items.map((item) => String(item["dst"] ?? ""));
    const rules = this.build_quality_statistics_rules(rule_key, message.input.entries);
    const relation_candidates = this.build_quality_relation_candidates(rules);
    const statistics_result = run_quality_statistics_task_sync({
      rules,
      srcTexts: src_texts,
      dstTexts: dst_texts,
      relationCandidates: relation_candidates,
    });
    const completed_entry_ids = rules.map((rule) => rule.key);
    const matched_count_by_entry_id = Object.fromEntries(
      completed_entry_ids.map((entry_id) => {
        return [entry_id, statistics_result.results[entry_id]?.matched_item_count ?? 0];
      }),
    );
    const subset_parent_labels_by_entry_id = Object.fromEntries(
      completed_entry_ids.map((entry_id) => {
        return [entry_id, statistics_result.results[entry_id]?.subset_parents ?? []];
      }),
    );
    const completed_snapshot = this.build_quality_statistics_dependency_snapshot(
      rule_key,
      rules,
      rule_key === "post_replacement" ? dst_texts : src_texts,
    );
    return {
      phase: "current",
      current_snapshot: completed_snapshot,
      completed_snapshot,
      completed_entry_ids,
      matched_count_by_entry_id,
      subset_parent_labels_by_entry_id,
      last_error: null,
      request_token: 0,
      updated_at: Date.now(),
    };
  }

  private build_quality_statistics_rules(
    rule_key: "glossary" | "pre_replacement" | "post_replacement" | "text_preserve",
    entries: unknown[],
  ): QualityStatisticsRuleInput[] {
    return entries.flatMap((entry, index) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const pattern = String(record["src"] ?? "");
      if (pattern.trim() === "") {
        return [];
      }
      return [
        {
          key: this.build_quality_entry_id(record, index),
          pattern,
          mode: rule_key,
          regex: rule_key === "text_preserve" ? true : Boolean(record["regex"]),
          case_sensitive: Boolean(record["case_sensitive"]),
        },
      ];
    });
  }

  private build_quality_relation_candidates(
    rules: QualityStatisticsRuleInput[],
  ): QualityStatisticsRelationCandidate[] {
    return rules.map((rule) => {
      return {
        key: rule.key,
        src: rule.pattern,
      };
    });
  }

  private build_quality_statistics_dependency_snapshot(
    rule_key: "glossary" | "pre_replacement" | "post_replacement" | "text_preserve",
    rules: QualityStatisticsRuleInput[],
    texts: string[],
  ): QualityStatisticsDependencySnapshot {
    const text_signature = this.build_quality_text_signature(texts);
    const snapshot_rules = rules.map((rule) => {
      const dependency_signature = JSON.stringify([
        rule.mode,
        rule.pattern,
        Boolean(rule.regex),
        Boolean(rule.case_sensitive),
      ]);
      return {
        key: rule.key,
        dependency_signature,
        relation_label: rule.pattern,
        token: `${dependency_signature}:${rule.key}`,
      };
    });
    const dependency_signature = JSON.stringify({
      text_source: rule_key === "post_replacement" ? "dst" : "src",
      text_signature,
      tokens: snapshot_rules.map((rule) => rule.token),
    });

    return {
      text_source: rule_key === "post_replacement" ? "dst" : "src",
      text_signature,
      dependency_signature,
      snapshot_signature: JSON.stringify({
        dependency_signature,
        keys: snapshot_rules.map((rule) => rule.key),
      }),
      rules: snapshot_rules,
    };
  }

  private build_quality_text_signature(texts: string[]): string {
    let hash = 2166136261;
    for (const [index, text] of texts.entries()) {
      const framed_text = `${index.toString()}:${text.length.toString()}:${text}`;
      for (let char_index = 0; char_index < framed_text.length; char_index += 1) {
        hash ^= framed_text.charCodeAt(char_index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
    }
    return `${texts.length.toString()}:${hash.toString(36)}`;
  }

  private build_quality_entry_id(entry: Record<string, unknown>, index: number): string {
    const entry_id = String(entry["entry_id"] ?? "");
    if (entry_id !== "") {
      return entry_id;
    }
    return `${String(entry["src"] ?? "").trim()}::${index.toString()}`;
  }

  private cancel_task(task: PendingTask): void {
    const queued_index = this.queue.findIndex((item) => item.id === task.id);
    if (queued_index >= 0) {
      this.queue.splice(queued_index, 1);
      this.reject_task(task, this.create_cancelled_error());
      return;
    }
    if (this.in_process_in_flight.delete(task.id)) {
      this.reject_task(task, this.create_cancelled_error());
      this.drain_queue();
      return;
    }
    const slot = this.slots.find((item) => item.task?.id === task.id);
    if (slot === undefined || slot.task === null) {
      return;
    }
    slot.worker.postMessage({
      id: task.id,
      type: "cancel",
    } satisfies ProjectReadModelWorkerIncomingMessage);
    const cancelled_task = slot.task;
    slot.task = null;
    this.reject_task(cancelled_task, this.create_cancelled_error());
    this.drain_queue();
  }

  private create_slot(): WorkerSlot {
    if (this.execution.kind !== "worker_threads") {
      throw new Error("ProjectReadModelWorkerPool 创建 worker slot 时必须使用 worker_threads。");
    }
    const slot: WorkerSlot = {
      worker: new Worker(this.execution.projectReadModelWorkerEntryUrl),
      task: null,
    };
    slot.worker.on("message", (message: ProjectReadModelWorkerOutgoingMessage) => {
      this.finish_worker_message(slot, message);
    });
    slot.worker.on("error", (error) => this.fail_slot(slot, error));
    slot.worker.on("exit", (code) => {
      if (!this.disposed && code !== 0) {
        this.fail_slot(slot, new Error(`Project read model worker exited: ${code.toString()}`));
      }
    });
    return slot;
  }

  private finish_worker_message(
    slot: WorkerSlot,
    message: ProjectReadModelWorkerOutgoingMessage,
  ): void {
    const task = slot.task;
    if (task === null || task.id !== message.id) {
      return;
    }
    slot.task = null;
    task.signal.removeEventListener("abort", task.abort_listener);
    if (message.ok) {
      task.resolve(message.data);
    } else {
      task.reject(
        new WorkerExecutionFailedError({
          diagnostic_context: {
            failure: normalize_log_error(message.error, "项目 read model worker 执行失败。"),
          },
        }),
      );
    }
    this.drain_queue();
  }

  private finish_in_process_task(id: string, data: unknown, error: unknown): void {
    const task = this.in_process_in_flight.get(id);
    if (task === undefined) {
      return;
    }
    this.in_process_in_flight.delete(id);
    task.signal.removeEventListener("abort", task.abort_listener);
    if (error === null) {
      task.resolve(data);
    } else {
      task.reject(error);
    }
    this.drain_queue();
  }

  private fail_slot(slot: WorkerSlot, error: unknown): void {
    const task = slot.task;
    slot.task = null;
    if (task !== null) {
      this.reject_task(task, error);
    }
    const index = this.slots.indexOf(slot);
    if (index >= 0 && !this.disposed) {
      this.slots[index] = this.create_slot();
      this.drain_queue();
    }
  }

  private reject_task(task: PendingTask, error: unknown): void {
    task.signal.removeEventListener("abort", task.abort_listener);
    task.reject(error);
  }

  private create_disposed_error(): RuntimeDisposedError {
    return new RuntimeDisposedError({
      public_details: { resource: "ProjectReadModelWorkerPool" },
      diagnostic_context: { queue_length: this.queue.length },
    });
  }

  private create_cancelled_error(): RuntimeCancelledError {
    return new RuntimeCancelledError({
      public_details: { resource: "project_read_model_worker" },
    });
  }
}
