import { describe, expect, it } from 'vitest'

import { createProjectStore } from './project-store'

describe('createProjectStore', () => {
  it('按 section 独立写入 bootstrap 阶段数据', () => {
    const store = createProjectStore()

    store.applyBootstrapStage('project', {
      project: { path: 'E:/demo/demo.lg', loaded: true },
      revisions: { projectRevision: 1, sections: { project: 1 } },
    })
    store.applyBootstrapStage('items', {
      items: { total: 2 },
      revisions: { sections: { items: 3 } },
    })

    expect(store.getState().project.path).toBe('E:/demo/demo.lg')
    expect(store.getState().items.total).toBe(2)
    expect(store.getState().revisions.projectRevision).toBe(1)
    expect(store.getState().revisions.sections.items).toBe(3)
  })

  it('合并 project.patch 并推进受影响 section revision', () => {
    const store = createProjectStore()

    store.applyBootstrapStage('items', {
      items: {
        1: {
          item_id: 1,
          file_path: 'chapter01.txt',
          src: '原文',
          dst: '旧译文',
          status: 'PENDING',
        },
      },
      revisions: {
        projectRevision: 2,
        sections: {
          items: 2,
        },
      },
    })

    store.applyProjectPatch({
      source: 'task',
      projectRevision: 3,
      updatedSections: ['items', 'task'],
      patch: [
        {
          op: 'merge_items',
          items: [
            {
              item_id: 1,
              file_path: 'chapter01.txt',
              src: '原文',
              dst: '新译文',
              status: 'DONE',
            },
          ],
        },
        {
          op: 'replace_task',
          task: {
            task_type: 'translation',
            status: 'DONE',
            busy: false,
          },
        },
      ],
    })

    expect(store.getState().items['1']).toEqual({
      item_id: 1,
      file_path: 'chapter01.txt',
      src: '原文',
      dst: '新译文',
      status: 'DONE',
    })
    expect(store.getState().task).toEqual({
      task_type: 'translation',
      status: 'DONE',
      busy: false,
    })
    expect(store.getState().revisions.projectRevision).toBe(3)
    expect(store.getState().revisions.sections.items).toBe(3)
    expect(store.getState().revisions.sections.task).toBe(1)
  })

  it('对缺省 projectRevision 的 project.patch 保留已有 revision', () => {
    const store = createProjectStore()

    store.applyBootstrapStage('items', {
      items: {
        1: {
          item_id: 1,
          file_path: 'chapter01.txt',
          src: '原文',
          dst: '旧译文',
          status: 'PENDING',
        },
      },
      revisions: {
        projectRevision: 5,
        sections: {
          items: 2,
        },
      },
    })

    store.applyProjectPatch({
      source: 'translation_batch_update',
      projectRevision: 0,
      updatedSections: ['items'],
      patch: [
        {
          op: 'merge_items',
          items: [
            {
              item_id: 1,
              file_path: 'chapter01.txt',
              src: '原文',
              dst: '批次译文',
              status: 'DONE',
            },
          ],
        },
      ],
    })

    expect(store.getState().items['1']).toEqual({
      item_id: 1,
      file_path: 'chapter01.txt',
      src: '原文',
      dst: '批次译文',
      status: 'DONE',
    })
    expect(store.getState().revisions.projectRevision).toBe(5)
    expect(store.getState().revisions.sections.items).toBe(3)
  })

  it('从 prompts 快照的 meta.enabled 归一化提示词启用态', () => {
    const store = createProjectStore()
    const bootstrap_prompts = {
      translation: {
        revision: 10,
        meta: {
          enabled: false,
        },
        text: '旧提示词',
      },
      analysis: {
        revision: 3,
        meta: {
          enabled: false,
        },
        text: '分析提示词',
      },
    } as unknown as ReturnType<typeof store.getState>['prompts']
    const patched_prompts = {
      translation: {
        revision: 11,
        meta: {
          enabled: true,
        },
        text: '新提示词',
      },
      analysis: {
        revision: 3,
        meta: {
          enabled: false,
        },
        text: '分析提示词',
      },
    } as unknown as ReturnType<typeof store.getState>['prompts']

    store.applyBootstrapStage('prompts', {
      prompts: bootstrap_prompts,
      revisions: {
        projectRevision: 7,
        sections: {
          prompts: 4,
        },
      },
    })

    store.applyProjectPatch({
      source: 'quality_prompt_save',
      projectRevision: 8,
      updatedSections: ['prompts'],
      patch: [
        {
          op: 'replace_prompts',
          prompts: patched_prompts,
        },
      ],
    })

    expect(store.getState().prompts.translation).toEqual({
      text: '新提示词',
      enabled: true,
      revision: 11,
    })
    expect(store.getState().revisions.projectRevision).toBe(8)
    expect(store.getState().revisions.sections.prompts).toBe(5)
  })
})
