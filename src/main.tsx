import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { WalletShell } from './components/WalletShell.tsx'
import '@solana/wallet-adapter-react-ui/styles.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletShell><App /></WalletShell>
  </StrictMode>,
)
