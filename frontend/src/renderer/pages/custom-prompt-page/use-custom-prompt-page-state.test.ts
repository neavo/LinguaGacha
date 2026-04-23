import { describe, expect, it } from 'vitest'

import { normalize_prompt_snapshot } from './use-custom-prompt-page-state'

describe('normalize_prompt_snapshot', () => {
  it('优先读取扁平化后的 enabled 字段', () => {
    expect(
      normalize_prompt_snapshot({
        revision: 4,
        enabled: true,
        text: '提示词',
      }),
    ).toEqual({
      revision: 4,
      meta: {
        enabled: true,
      },
      text: '提示词',
    })
  })

  it('兼容旧的 meta.enabled 结构', () => {
    expect(
      normalize_prompt_snapshot({
        revision: 2,
        meta: {
          enabled: false,
        },
        text: '提示词',
      }),
    ).toEqual({
      revision: 2,
      meta: {
        enabled: false,
      },
      text: '提示词',
    })
  })
})
