import { createContext, useContext, useState, type ReactNode } from 'react'

interface DrawerState {
  open: boolean
  agentName: string | null
  openDrawer: (name: string) => void
  closeDrawer: () => void
}

const DrawerContext = createContext<DrawerState | null>(null)

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [agentName, setAgentName] = useState<string | null>(null)

  function openDrawer(name: string) {
    setAgentName(name)
    setOpen(true)
  }

  function closeDrawer() {
    setOpen(false)
    setAgentName(null)
  }

  return (
    <DrawerContext.Provider value={{ open, agentName, openDrawer, closeDrawer }}>
      {children}
    </DrawerContext.Provider>
  )
}

export function useDrawer() {
  const ctx = useContext(DrawerContext)
  if (!ctx) throw new Error('useDrawer must be used within DrawerProvider')
  return ctx
}
