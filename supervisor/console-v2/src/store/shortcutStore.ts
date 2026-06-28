import { create } from 'zustand'

export type Tab = 'fleet' | 'queue' | 'pipeline' | 'cost' | 'trust'

interface ShortcutStore {
  paletteOpen: boolean
  activeTab: Tab | null
  activeDrawer: string | null
  helpOpen: boolean
  openPalette: () => void
  closePalette: () => void
  navigateTo: (tab: Tab) => void
  closeActive: () => void
  toggleHelp: () => void
}

export const useShortcutStore = create<ShortcutStore>((set) => ({
  paletteOpen: false,
  activeTab: null,
  activeDrawer: null,
  helpOpen: false,
  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  navigateTo: (tab) => set({ activeTab: tab }),
  closeActive: () => set({ paletteOpen: false, activeDrawer: null }),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
}))
