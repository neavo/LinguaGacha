export type CoreLifecycleState = "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface CoreLaunchEnvironment {
  env: NodeJS.ProcessEnv;
  appRoot: string;
  platform: NodeJS.Platform;
}

export interface CoreProcessExitResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface CoreLifecycleStartResult {
  baseUrl: string;
}

export interface CoreLifecycleManagerOptions {
  appRoot: string;
  onUnexpectedExit?: (result: CoreProcessExitResult) => void;
}
