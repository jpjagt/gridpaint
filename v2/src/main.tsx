import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import GlobalStyles from '@/components/GlobalStyles'
import { ThemeProvider } from '@/components/ThemeProvider'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const container = document.getElementById('root')
const root = createRoot(container!)
root.render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <Toaster />
      <GlobalStyles />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)
