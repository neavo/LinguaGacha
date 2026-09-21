import { describe, expect, it } from "vitest";
import { AgentTokenSpeed } from "./agent-token-speed";

describe("AgentTokenSpeed", () => {
  it("同批同块文本的分片方式不影响计数，大分片按内容量估算", () => {
    const whole = new AgentTokenSpeed();
    const split = new AgentTokenSpeed();
    const text = "const result = await ws.project.read();\n".repeat(100);
    whole.record(text, 0, 0);
    for (const char of text) split.record(char, 0, 0);
    expect(whole.measure(250)).toBe(split.measure(250));
    expect(whole.finish_round(1000)).toBeGreaterThan(1);
    expect(split.finish_round(1000)).toBe(whole.finish_round(1000));
  });

  it("正文、思考和工具参数分别计数，空增量无影响，尾部在结束时结算", () => {
    const speed = new AgentTokenSpeed();
    speed.record("hello", 0, 0);
    speed.record(" world", 0, 50);
    speed.record("hello world", 1, 80);
    speed.record("hello world", 2, 100);
    speed.record("", 3, 900);
    expect(speed.finish_round(1000)).toBe(6);
    expect(speed.finish_round(2000)).toBe(6);
    speed.reset();
    expect(speed.finish_round(3000)).toBeNull();
  });

  it("停顿后的批次按经过时间计算速度", () => {
    const speed = new AgentTokenSpeed();
    speed.record("hello", 0, 0);
    expect(speed.measure(0)).toBeGreaterThan(0);
    speed.record(" world", 0, 2000);
    expect(speed.measure(2000)).toBe(0.5);
  });

  it("按响应校准平均值，缺失 usage 保留估算且排除工具与继续等待", () => {
    const speed = new AgentTokenSpeed();
    speed.record("hello", 0, 0);
    speed.measure(0);
    speed.record(" world", 0, 500);
    speed.finish_response(1000, 100);
    speed.record("hello world", 0, 10_000);
    speed.finish_response(11_000, 0);
    expect(speed.finish_round(20_000)).toBe(51);
    speed.record("hello", 0, 30_000);
    speed.finish_response(31_000, 48);
    expect(speed.finish_round(31_000)).toBe(50);
  });

  it("停止结算已发布之后的尾部增量，无有效耗时不产生平均值", () => {
    const speed = new AgentTokenSpeed();
    speed.record("hello", 0, 0);
    speed.measure(0);
    speed.record("hello world", 0, 100);
    expect(speed.finish_round(200)).toBe(15);
    speed.reset();
    speed.record("hello", 0, 1000);
    expect(speed.finish_round(1000)).toBeNull();
  });
});
