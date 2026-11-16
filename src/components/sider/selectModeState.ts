import { create } from 'zustand'

/**
 * 会话多选模式：侧栏清单图标进入，选中一批会话后批量删除 / 移动到项目。
 * 选中集放在外面，SessionItem 点击只切换，不打开会话。
 */
export const useSelectMode = create(() => ({ active: false, selectedIds: [] as string[] }))

export const enterSelectMode = () => useSelectMode.setState({ active: true, selectedIds: [] })

export const exitSelectMode = () => useSelectMode.setState({ active: false, selectedIds: [] })

export const toggleSelectSession = (id: string) =>
  useSelectMode.setState((state) => ({
    selectedIds: state.selectedIds.includes(id)
      ? state.selectedIds.filter((item) => item !== id)
      : [...state.selectedIds, id],
  }))

export const setSelectedSessions = (ids: string[]) =>
  useSelectMode.setState({ selectedIds: [...new Set(ids)] })
