import type { ChildProcess } from "node:child_process";

export type CoreLifecycleState = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface CoreLifecycleEnvironment {
  env: NodeJS.ProcessEnv;
  appRoot: string;
  resourcesPath: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
}

export interface CoreRuntimePaths {
  coreSourceRoot: string;
  uvCommand: string;
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
  resourcesPath: string;
  isPackaged: boolean;
  onUnexpectedExit?: (result: CoreProcessExitResult) => void;
}
