import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './styles/index.css'
import './styles/layout.css'
import './styles/library.css'
import './styles/scrubber.css'
import './styles/albums.css'
import './styles/overlay.css'
import './styles/upload.css'
import './styles/trash.css'
import './styles/responsive.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
