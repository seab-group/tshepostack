import { motion } from 'framer-motion'
import { ThemeToggle } from './components/ThemeToggle'

function StatusRing() {
  return (
    <motion.span
      className="inline-block h-3 w-3 rounded-full ring-2 ring-current text-amber-500 dark:text-amber-400"
      animate={{ scale: [1, 1.25, 1], opacity: [1, 0.6, 1] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    />
  )
}

function App() {
  return (
    <div className="flex min-h-screen flex-col bg-[--color-base] text-[--color-text]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[--color-border]">
        <div className="flex items-center gap-3">
          <StatusRing />
          <span className="text-sm font-medium text-[--color-text-dim]">Fleet Console v2</span>
        </div>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-2xl font-semibold">Coming soon</h1>
        </motion.div>
      </main>
    </div>
  )
}

export default App
