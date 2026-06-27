import { motion } from 'framer-motion'

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 className="text-2xl font-semibold">Fleet Console v2 — coming soon</h1>
      </motion.div>
    </div>
  )
}

export default App
