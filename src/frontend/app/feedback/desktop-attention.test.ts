import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  capture_renderer_error: vi.fn(),
  request_user_attention: vi.fn<() => Promise<boolean>>(),
  play: vi.fn<() => Promise<void>>(),
}));

vi.mock("@frontend/app/diagnostics/renderer-error-reporter", () => ({
  capture_renderer_error: mocks.capture_renderer_error,
}));

/** 用媒体事件控制播放结束与失败，隔离真实解码和设备。 */
class FakeAudio extends EventTarget {
  public static instances: FakeAudio[] = [];

  public currentTime = 0;
  public error: MediaError | null = null;
  public readonly play = mocks.play;

  /** 收集实例，供测试观察复用与失败重建。 */
  public constructor() {
    super();
    FakeAudio.instances.push(this);
  }

  /** 发布真实播放器使用的结束或失败事件。 */
  public emit(type: "ended" | "error"): void {
    this.dispatchEvent(new Event(type));
  }
}

describe("desktop-attention", () => {
  beforeEach(() => {
    mocks.capture_renderer_error.mockReset();
    mocks.request_user_attention.mockReset();
    mocks.play.mockReset();
    mocks.play.mockResolvedValue(undefined);
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("desktopApp", { requestUserAttention: mocks.request_user_attention });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("宿主返回 false 时不初始化也不播放提示音", async () => {
    const { request_user_attention } = await import("./desktop-attention");
    mocks.request_user_attention.mockResolvedValueOnce(false);

    await request_user_attention();

    expect(mocks.request_user_attention).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(mocks.capture_renderer_error).not.toHaveBeenCalled();
  });

  it("播放启动中与播放期间合并后续请求，ended 后可复用单实例重播", async () => {
    const { request_user_attention } = await import("./desktop-attention");
    const play_gate = Promise.withResolvers<void>();
    mocks.request_user_attention.mockResolvedValue(true);
    mocks.play.mockReturnValueOnce(play_gate.promise);

    const pending_first = request_user_attention();
    await vi.waitFor(() => {
      expect(FakeAudio.instances).toHaveLength(1);
    });
    const audio = FakeAudio.instances[0]!;
    expect(mocks.play).toHaveBeenCalledTimes(1);

    // play() 尚在启动窗口时再次请求，仍询问宿主，但不再重播音频。
    await request_user_attention();
    expect(mocks.request_user_attention).toHaveBeenCalledTimes(2);
    expect(mocks.play).toHaveBeenCalledTimes(1);

    play_gate.resolve();
    await pending_first;
    audio.currentTime = 0.7;

    // 已经 resolve 但尚未 ended 时，后续请求继续合并到当前声音。
    await request_user_attention();
    expect(mocks.play).toHaveBeenCalledTimes(1);

    // 正常播完后，下一轮从起点复用同一个音频实例播放。
    audio.emit("ended");
    await request_user_attention();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(audio.currentTime).toBe(0);
    expect(mocks.play).toHaveBeenCalledTimes(2);
  });

  it("IPC 拒绝时仅记录一次诊断，不影响后续请求恢复", async () => {
    const { request_user_attention } = await import("./desktop-attention");
    const ipc_error = new Error("ipc failed");
    mocks.request_user_attention.mockRejectedValueOnce(ipc_error).mockResolvedValueOnce(true);

    await request_user_attention();

    expect(mocks.capture_renderer_error).toHaveBeenCalledTimes(1);
    expect(mocks.capture_renderer_error).toHaveBeenCalledWith(ipc_error, {
      source: "global",
      context: { eventKind: "user_attention_ipc" },
    });
    expect(FakeAudio.instances).toHaveLength(0);

    await request_user_attention();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it("play() 拒绝与媒体 error 并发时只上报一次，并允许下一事项重新播放", async () => {
    const { request_user_attention } = await import("./desktop-attention");
    const play_gate = Promise.withResolvers<void>();
    mocks.request_user_attention.mockResolvedValue(true);
    mocks.play.mockReturnValueOnce(play_gate.promise);

    const failed_request = request_user_attention();
    await vi.waitFor(() => {
      expect(FakeAudio.instances).toHaveLength(1);
    });
    const failed_audio = FakeAudio.instances[0]!;
    failed_audio.error = { code: 3, message: "decode error" } as MediaError;
    failed_audio.emit("error");

    expect(mocks.capture_renderer_error).toHaveBeenCalledTimes(1);
    expect(mocks.capture_renderer_error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failed_audio.error,
      }),
      {
        source: "global",
        context: { eventKind: "user_attention_audio" },
      },
    );

    // 媒体层错误后下一个事项新建音频实例并正常恢复播放。
    await request_user_attention();
    expect(FakeAudio.instances).toHaveLength(2);
    expect(mocks.play).toHaveBeenCalledTimes(2);

    // 旧 play() 的迟到拒绝不能释放新播放的占用或重复报错。
    play_gate.reject(new Error("decode failed"));
    await failed_request;
    await request_user_attention();
    expect(mocks.play).toHaveBeenCalledTimes(2);
    expect(mocks.capture_renderer_error).toHaveBeenCalledTimes(1);
  });

  it("播放拒绝后释放占用，下一事项可复用音频重试", async () => {
    const { request_user_attention } = await import("./desktop-attention");
    const failure = new DOMException("Playback blocked", "NotAllowedError");
    mocks.request_user_attention.mockResolvedValue(true);
    mocks.play.mockRejectedValueOnce(failure);

    await request_user_attention();
    expect(mocks.capture_renderer_error).toHaveBeenCalledWith(failure, {
      source: "global",
      context: { eventKind: "user_attention_audio" },
    });
    await request_user_attention();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(mocks.play).toHaveBeenCalledTimes(2);
  });
});
