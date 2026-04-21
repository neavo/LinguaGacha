import { describe, expect, it } from 'vitest'

import { buildProofreadingVisibleItems } from './use-proofreading-page-state'

describe('buildProofreadingVisibleItems', () => {
  it('使用 worker warning map 和 store items 生成可见项', () => {
    const result = buildProofreadingVisibleItems({
      items: [
        {
          item_id: 1,
          file_path: 'a.txt',
          src: '原文',
          dst: '译文',
          status: 'DONE',
        },
      ],
      warningMap: {
        '1': ['SIMILARITY'],
      },
      filters: {
        warning_types: ['SIMILARITY'],
      },
    })

    expect(result[0]?.item.warnings).toEqual(['SIMILARITY'])
  })
})
