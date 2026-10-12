import '../shared/theme.css'
import { CSPProvider } from '@base-ui/react/csp-provider'
import { createRoot } from 'react-dom/client'
import { DesktopDialogApp } from './App.tsx'

document.documentElement.classList.add('dshDesktopDialogDocument')
const root = document.getElementById('root')
if (root === null) throw new Error('dsh-desktop-dialog: root element is missing')
createRoot(root).render(<CSPProvider disableStyleElements><DesktopDialogApp /></CSPProvider>)
