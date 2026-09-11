import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import '../styles/tokens.css'; import '../styles/layout.css'; import '../styles/components.css'; import '../styles/motion.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
