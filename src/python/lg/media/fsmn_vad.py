"""固定 FSMN-Monophone 模型的连续前端与离线分段。"""

import math
from pathlib import Path

import kaldi_native_fbank as knf
import numpy as np

SAMPLE_RATE = 16000
FRAME_SHIFT = 160  # 10 ms 帧移的采样数。
FRAME_LENGTH = 400  # 25 ms 帧长的采样数。
BLOCK_FRAMES = 6000  # 单次模型请求的特征帧上限，沿用上游离线约 60 秒分块。
FEATURES = 400  # LFR m=5 拼接 80 维 fbank。
PDFS = 248  # 模型每帧输出的 pdf 得分数，静音 pdf 是索引 0。
# 固定 config.yaml：200 ms 窗口、150 ms 切换、200 ms 回看、100 ms 向后延展。
WINDOW = 20
SWITCH = 15
LOOKBACK = 40  # 窗口延迟与起点回看之和。
LOOKAHEAD = 10
END_SILENCE = 65  # (max_end_silence_time - speech_to_sil_time_thres) / 10。
MAX_SEGMENT = 2000  # 单段最长 20 秒，超过即截断。
NOISE_THRESHOLD = 0.6  # speech_noise_thres：语音概率须比静音概率高出该值。
DECIBEL_THRESHOLD = -100.0  # 低于该能量的帧直接按静音处理。
SNR_THRESHOLD = -100.0  # 语音帧相对噪声底的最低信噪比。
NOISE_FRAMES = 100  # 噪声底滑动平均的帧数。


class Frontend:
    """fbank 帧编号连续。只在真实 EOF 补齐 LFR 的右侧上下文。"""

    def __init__(self, mvn):
        options = knf.FbankOptions()
        options.frame_opts.samp_freq = SAMPLE_RATE
        options.frame_opts.dither = 0
        options.frame_opts.window_type = "hamming"
        options.frame_opts.snip_edges = True
        options.mel_opts.num_bins = 80
        options.energy_floor = 0
        self.fbank = knf.OnlineFbank(options)
        lines = [line.split() for line in Path(mvn).read_text("utf-8").splitlines() if line.split()]
        vectors = {}
        for current, following in zip(lines, lines[1:]):
            if current[0] in ("<AddShift>", "<Rescale>") and following[0] == "<LearnRateCoef>":
                vectors[current[0]] = np.array(following[3:-1], np.float64)
        self.mean, self.scale = vectors["<AddShift>"], vectors["<Rescale>"]
        if self.mean.shape != (FEATURES,) or self.scale.shape != (FEATURES,):
            raise ValueError("FSMN CMVN must contain 400 features")
        self.offset = self.popped = 0

    def accept(self, samples, final=False):
        """追加 [-1, 1) 采样，`final` 标记真实输入结束。"""
        self.fbank.accept_waveform(SAMPLE_RATE, (samples * 32768).tolist())
        if final:
            self.fbank.input_finished()

    def take(self, final=False):
        """取出下一块 `(起始帧, [1, T, 400] 特征, 是否最后一块)`，不足一块时返回 None。

        非 EOF 时保留右侧两帧作为 LFR 上下文。已不会再参与 LFR 的 fbank 帧随即释放。
        """
        ready = self.fbank.num_frames_ready
        available = ready - self.offset - (0 if final else 2)
        # 留下一帧才能确定满块是否同时也是 EOF，避免额外零长度 flush 请求。
        if available <= BLOCK_FRAMES and not final:
            return None
        count = min(BLOCK_FRAMES, available)
        if count <= 0:
            return None
        start = max(0, self.offset - 2)
        end = min(ready, self.offset + count + 2)
        frames = np.stack([self.fbank.get_frame(i) for i in range(start, end)])
        indices = np.clip(np.arange(self.offset, self.offset + count)[:, None] + np.arange(-2, 3), 0, ready - 1) - start
        # 上游 CMVN 在 float64 中运算，再转模型 float32，不能沿用 ASR 的 float32 缓存。
        features = ((frames[indices].reshape(count, FEATURES) + self.mean) * self.scale).astype(np.float32)[None]
        offset = self.offset
        self.offset += count
        drop = max(0, self.offset - 2) - self.popped
        self.fbank.pop(drop)
        self.popped += drop
        return offset, features, final and self.offset == ready


class Segmenter:
    """FunASR 0.4.9 的固定多段离线路径，只保留采样区间和持续状态。"""

    def __init__(self):
        self.offset = self.head = self.ends = 0  # 已消费帧数、可回看的最早帧、已结束段数。
        self.noise = -100.0
        self.segment = None
        self.reset()

    def reset(self):
        """一段结束后重置滑动窗口与段内状态，噪声底和已消费位置保留。"""
        self.window = [0] * WINDOW
        self.position = self.total = self.silence = 0
        self.voice = False
        self.start = -1
        self.latest = 0

    def finish(self, frame, output):
        """以 `frame` 为终点提交当前段。"""
        if self.segment is not None:
            self.segment[1] = (frame + 1) * FRAME_SHIFT
            self.head = frame + 1
            output.append(self.segment)
            self.segment = None
        self.ends += 1
        self.reset()

    def extend(self, frame):
        """把当前段的终点延到 `frame`。"""
        self.latest = frame
        self.head = frame + 1
        self.segment[1] = self.head * FRAME_SHIFT

    def detect(self, speech, frame, final, output):
        """按单帧判定推进窗口状态机，结束的段追加到 `output`。分支顺序与上游一致。"""
        self.total += int(speech) - self.window[self.position]
        self.window[self.position] = int(speech)
        self.position = (self.position + 1) % WINDOW
        previous = self.voice
        if not previous and self.total >= SWITCH:
            self.voice = True
        elif previous and self.total <= SWITCH:
            self.voice = False

        if self.voice or previous:
            self.silence = 0
            if self.voice and not previous and self.start == -1:
                self.start = max(self.head, frame - LOOKBACK)
                self.segment = [self.start * FRAME_SHIFT, (self.start + 1) * FRAME_SHIFT]
                self.head = self.start + 1
                for current in range(self.start + 1, frame + 1):
                    self.extend(current)
                # 上游在首次 Sil2Speech 分支不执行 EOF 收尾，最后仍返回已开始区间。
            elif self.start != -1:
                if frame - self.start + 1 > MAX_SEGMENT or final:
                    self.finish(frame, output)
                else:
                    self.extend(frame)
        else:
            self.silence += 1
            if self.start == -1:
                if final and self.ends == 0:
                    self.ends += 1  # 上游的 fake start/end 不生成语音。
                    self.reset()
                elif frame >= LOOKBACK:
                    self.head = max(self.head, frame - LOOKBACK)
            elif self.silence >= END_SILENCE:
                self.finish(frame - max(0, END_SILENCE - LOOKAHEAD - 1), output)
            elif frame - self.start + 1 > MAX_SEGMENT:
                self.finish(frame, output)
            elif not final:
                if self.silence <= LOOKAHEAD:
                    self.extend(frame)
            else:
                self.finish(frame, output)

    def accept(self, scores, waveform, final):
        """处理一块模型得分及其配套波形，返回本块结束的 `[起点, 终点]` 采样区间。"""
        if scores.ndim != 3 or scores.shape[0] != 1 or scores.shape[2] != PDFS or not np.isfinite(scores).all():
            raise ValueError("Invalid FSMN scores")
        count = scores.shape[1]
        if len(waveform) != (count - 1) * FRAME_SHIFT + FRAME_LENGTH:
            raise ValueError("FSMN waveform does not match feature frames")
        output = []
        for index in range(count):
            frame = self.offset + index
            decibel = 10 * math.log10(np.square(waveform[index * FRAME_SHIFT:index * FRAME_SHIFT + FRAME_LENGTH]).sum() + 0.000001)
            if decibel < DECIBEL_THRESHOLD:
                # 固定上游在低能量分支先更新窗口一次，再走常规帧处理。
                self.detect(False, frame, False, output)
                speech = False
            else:
                noise = sum([scores[0, index, 0]])  # 保留上游 NumPy 标量运算，float 转换会改变阈值附近的结果。
                noise_prob = math.log(noise)
                speech_prob = math.log(1.0 - noise)
                speech = math.exp(speech_prob) >= math.exp(noise_prob) + NOISE_THRESHOLD
                if speech:
                    speech = decibel - self.noise >= SNR_THRESHOLD
                else:
                    self.noise = decibel if self.noise < -99.9 else (decibel + self.noise * (NOISE_FRAMES - 1)) / NOISE_FRAMES
            self.detect(speech, frame, final and index == count - 1, output)
        self.offset += count
        if final and self.segment is not None:
            output.append(self.segment)
            self.segment = None
        return output

    @property
    def retained_sample(self):
        """分段仍可能用到的最早采样，之前的 PCM 可以释放。"""
        return self.segment[0] if self.segment is not None else self.head * FRAME_SHIFT
