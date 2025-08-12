import React from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { HashRouter } from "react-router-dom"
import GlobalStyles from "@/components/GlobalStyles"
import { ThemeProvider } from "@/components/ThemeProvider"
import { Toaster } from "@/components/ui/sonner"
import "./globals.css"

const container = document.getElementById("root")
const root = createRoot(container!)
root.render(
  <React.StrictMode>
    <ThemeProvider defaultTheme='system' storageKey='vite-ui-theme'>
      <Toaster />
      <GlobalStyles />
      <HashRouter>
        <App />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
