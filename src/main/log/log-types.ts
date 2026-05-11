import type { LogLevel } from "../../base/log";

export type { LogLevel };

export interface LogTargets {
  file: boolean;
  console: boolean;
  window: boolean;
}

export interface LogEvent {
  id: string;
  sequence: number;
  created_at: string;
  level: LogLevel;
  message: string;
}

export interface LogAppendPayload {
  level: LogLevel;
  message: string;
  source?: string;
  error_message?: string;
  stack?: string;
  context?: Record<string, unknown>;
  targets?: Partial<LogTargets>;
}

export type LogSubscriber = (event: LogEvent) => void;
