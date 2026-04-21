import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PROJECT_RUNTIME_V2_FEATURE_ENABLED } from './runtime-feature'

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))

function read_source(relative_path: string): string {
  return readFileSync(resolve(CURRENT_DIR, relative_path), 'utf8')
}

describe('runtime guard', () => {
  it('锁定 V2 项目运行态开关为启用', () => {
    expect(PROJECT_RUNTIME_V2_FEATURE_ENABLED).toBe(true)
  })

  it('桌面壳层不再监听 V1 事件流和旧 invalidation topic', () => {
    const source = read_source('../desktop-runtime-context.tsx')
    const legacy_stream_symbol = ['open', 'event', 'stream'].join('_')
    const legacy_proofreading_topic = ['proofreading', 'snapshot_invalidated'].join('.')
    const legacy_workbench_topic = ['workbench', 'snapshot_changed'].join('.')

    expect(source).not.toContain(legacy_stream_symbol)
    expect(source).not.toContain(legacy_proofreading_topic)
    expect(source).not.toContain(legacy_workbench_topic)
  })

  it('desktop api 不再暴露旧 SSE 入口', () => {
    const source = read_source('../../desktop-api.ts')
    const legacy_path = ['/api', 'events', 'stream'].join('/')

    expect(source).not.toContain(legacy_path)
    expect(source).toContain('/api/v2/events/stream')
  })
})
