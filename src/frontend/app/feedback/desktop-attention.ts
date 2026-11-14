import { capture_renderer_error } from "@frontend/app/diagnostics/renderer-error-reporter";

const ATTENTION_SOUND_URL = new URL("sounds/attention.ogg", document.baseURI).href;

let audio_instance: HTMLAudioElement | null = null; // 当前 renderer 复用的播放器
let active_audio: HTMLAudioElement | null = null; // 覆盖启动到结束，实例身份隔离媒体失败后的迟到拒绝

/**
 * 请求宿主判定窗口焦点并按结果播放提示音；IPC 或播放异常只记诊断，不打断业务流程。
 */
export async function request_user_attention(): Promise<void> {
  let accepted: boolean;
  try {
    accepted = await window.desktopApp.requestUserAttention();
  } catch (error) {
    capture_renderer_error(error, {
      source: "global",
      context: { eventKind: "user_attention_ipc" },
    });
    return;
  }

  if (!accepted || active_audio !== null) {
    return;
  }

  const audio = ensure_attention_audio();
  active_audio = audio;
  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    if (active_audio === audio) {
      fail_active_playback(error);
    }
  }
}

/** 复用的单实例音频；媒体层报错后下次请求重建实例以恢复播放。 */
function ensure_attention_audio(): HTMLAudioElement {
  if (audio_instance !== null && audio_instance.error === null) {
    return audio_instance;
  }

  const audio = new Audio(ATTENTION_SOUND_URL);
  audio.addEventListener("ended", () => {
    if (active_audio === audio) active_audio = null;
  });
  audio.addEventListener("error", () => {
    if (active_audio !== audio) {
      return;
    }
    const media_error = audio.error;
    const error =
      media_error === null
        ? new Error("Attention audio media error.")
        : new Error(
            `Attention audio media error (code=${media_error.code}): ${media_error.message}`,
            { cause: media_error },
          );
    fail_active_playback(error);
  });
  audio_instance = audio;
  return audio;
}

/** 释放当前播放占用并记录一次诊断，防止同次失败在 Promise 与媒体事件间重复上报。 */
function fail_active_playback(error: unknown): void {
  active_audio = null;
  capture_renderer_error(error, {
    source: "global",
    context: { eventKind: "user_attention_audio" },
  });
}
