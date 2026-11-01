import '@fontsource-variable/instrument-sans/wght.css'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './styles.css'
import './motion.css'

createRoot(document.getElementById('root')!).render(<App />)
