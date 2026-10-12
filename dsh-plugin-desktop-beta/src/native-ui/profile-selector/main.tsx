import '../shared/theme.css'
import { CSPProvider } from '@base-ui/react/csp-provider'
import { createRoot } from 'react-dom/client'
import { ProfileSelectorApp } from './App.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('dsh-profile-selector: root element is missing')
createRoot(root).render(<CSPProvider disableStyleElements><ProfileSelectorApp /></CSPProvider>)
