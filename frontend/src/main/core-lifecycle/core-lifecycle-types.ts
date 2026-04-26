import type { ChildProcess } from "node:child_process";

export type CoreLifecycleState = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export type CoreLaunchCommandKind = "executable" | "source";

export interface CoreLaunchEnvironment {
  env: NodeJS.ProcessEnv;
  appRoot: string;
  platform: NodeJS.Platform;
}

export interface CoreLaunchCommand {
  kind: CoreLaunchCommandKind;
  command: string;
  args: string[];
  cwd: string;
}

export interface CoreProcessHandle {
  process: ChildProcess;
  exitPromise: Promise<CoreProcessExitResult>;
}

export interface CoreProcessExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface CoreLifecycleStartResult {
  baseUrl: string;
  instanceToken: string;
}

export interface CoreLifecycleManagerOptions {
  appRoot: string;
  onUnexpectedExit?: (result: CoreProcessExitResult) => void;
}
