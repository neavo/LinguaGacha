import { describe, expect, expectTypeOf, it } from "vitest";

import {
  IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS,
  IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE,
  IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER,
  type DesktopIpcInvokeContract,
  type DesktopIpcSendContract,
} from "./gui-ipc-contract";
import type {
  DesktopUpdateDownloadIpcRequest,
  DesktopUpdateDownloadProgress,
  DesktopUpdateDownloadResult,
  DesktopUpdateLaunchRequest,
  DesktopUpdateLaunchResult,
} from "./bridge/bridge-types";

describe("gui-ipc-contract", () => {
  it("自动更新 IPC 通道名保持 main、preload 和 renderer 共享契约", () => {
    expect(IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE).toBe("update:download-release");
    expect(IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS).toBe("update:download-progress");
    expect(IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER).toBe("update:launch-berserker");
  });

  it("自动更新 invoke 和 send 载荷保持窄类型", () => {
    expectTypeOf<
      DesktopIpcInvokeContract[typeof IPC_CHANNEL_UPDATE_DOWNLOAD_RELEASE]
    >().toEqualTypeOf<{
      args: [request: DesktopUpdateDownloadIpcRequest];
      result: DesktopUpdateDownloadResult;
    }>();
    expectTypeOf<
      DesktopIpcInvokeContract[typeof IPC_CHANNEL_UPDATE_LAUNCH_BERSERKER]
    >().toEqualTypeOf<{
      args: [request: DesktopUpdateLaunchRequest];
      result: DesktopUpdateLaunchResult;
    }>();
    expectTypeOf<
      DesktopIpcSendContract[typeof IPC_CHANNEL_UPDATE_DOWNLOAD_PROGRESS]
    >().toEqualTypeOf<{
      args: [progress: DesktopUpdateDownloadProgress];
    }>();
  });
});
