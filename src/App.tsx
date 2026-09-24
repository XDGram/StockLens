import { type FormEvent, useEffect, useState } from 'react'
import { PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from '@solana/web3.js'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { BaseWalletMultiButton } from '@solana/wallet-adapter-react-ui'

import type { ExitPreview } from './lib/jupiter/exitPreview'
import type { PythProPrice } from './lib/pyth/pro'
import { createReceiptEnvelope, downloadReceipt } from './lib/receipt/create'
import type { DecisionReceipt, DecisionReceiptEnvelope, ScanResult, VerificationStatus } from './types'

const AAPLX_MINT = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'
const MAINNET_GENESIS_HASH = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const SOLSCAN_TRANSACTION = 'https://solscan.io/tx/'
const PERCENTAGES = [10, 25, 50, 100] as const
const SLIPPAGE_OPTIONS = [10, 50, 100] as const
const WALLET_BUTTON_LABELS = {
  'no-wallet': 'Connect wallet',
  'has-wallet': 'Connect wallet',
  connecting: 'Connecting...',
  'copy-address': 'Copy address',
  copied: 'Copied',
  'change-wallet': 'Change wallet',
  disconnect: 'Disconnect',
} as const
type Stage = 'input' | 'verification' | 'price' | 'exit' | 'rehearsal' | 'execution' | 'receipt'
type ExecutionStatus = 'idle' | 'awaiting-signature' | 'submitted' | 'confirming' | 'confirmed' | 'timed-out' | 'failed'

interface AssetSummary { issuer: string; symbol: string; underlyingTicker: string }
interface PriceRadar { underlying: PythProPrice; token: ExitPreview; premiumDiscountPercentage: number | null }
interface ScanResponse { scan: ScanResult; asset: AssetSummary | null; priceRadar: PriceRadar }
interface ExitResponse {
  preview: ExitPreview
  exitAmount: string
  percentage: number
  referencePrice: { status: 'available'; price: number } | { status: 'unavailable' }
}
interface BuiltSwap {
  swapTransaction: string
  lastValidBlockHeight: number
  quote: {
    inputMint: string
    outputMint: string
    inputAmount: string
    inputAmountRaw: string
    expectedOutputAmount: string
    expectedOutputUsd: number
    minimumOutputAmount: string
    minimumOutputUsd: number
    priceImpactPercentage: number
    slippageBps: number
    routeLabels: string[]
    quotedAt: string
  }
}

const statusCopy: Record<VerificationStatus, { label: string; headline: string; body: string }> = {
  verified: { label: 'Verified issuer', headline: 'This is the official token.', body: 'The mint and its live controls match the issuer record.' },
  'known-wrapper': { label: 'Known wrapper', headline: 'Known asset. Changed controls.', body: 'The token is sourced, but one or more live controls need review.' },
  unverified: { label: 'Unverified mint', headline: 'We cannot verify this token.', body: 'This mint is not linked to a supported issuer in the StockLens registry.' },
  critical: { label: 'Critical control risk', headline: 'Do not trust the ticker.', body: 'An unidentified wallet still has power to change this token.' },
}

const stageLabels: Array<{ key: Stage; label: string }> = [
  { key: 'input', label: 'Scan' },
  { key: 'verification', label: 'Verify' },
  { key: 'price', label: 'Compare' },
  { key: 'exit', label: 'Exit' },
  { key: 'rehearsal', label: 'Rehearse' },
  { key: 'execution', label: 'Execute' },
  { key: 'receipt', label: 'Receipt' },
]

function shortAddress(address: string | null): string {
  return address ? `${address.slice(0, 5)}...${address.slice(-5)}` : 'No address'
}

function money(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits }).format(value)
}

function timestamp(value: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(value))
}

function formatTokenBalance(rawAmount: bigint, decimals: number): string {
  if (decimals === 0) return rawAmount.toString()
  const padded = rawAmount.toString().padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals) || '0'
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function walletErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('reject') || normalized.includes('cancel')) return 'Connection was cancelled. No wallet data was shared.'
  if (normalized.includes('network')) return 'Your wallet is not available on Solana mainnet. Switch networks and try again.'
  return 'The wallet could not connect. Check that it is unlocked, then try again.'
}

async function postJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? 'Request failed.')
  return result
}

function executionError(error: unknown): { message: string; kind: 'rejected' | 'slippage' | 'expired' | 'other' } {
  const detail = error instanceof Error ? error.message : String(error)
  const normalized = detail.toLowerCase()
  if (normalized.includes('reject') || normalized.includes('cancel')) {
    return { kind: 'rejected', message: 'Signature request was rejected. Nothing was submitted.' }
  }
  if (normalized.includes('slippage') || normalized.includes('0x1771') || normalized.includes('6001')) {
    return { kind: 'slippage', message: 'The market moved beyond your slippage limit. Review a fresh quote or choose a higher tolerance.' }
  }
  if (normalized.includes('blockhash') || normalized.includes('expired') || normalized.includes('last valid block')) {
    return { kind: 'expired', message: 'The route expired before submission. StockLens refreshed it once; review and retry.' }
  }
  return { kind: 'other', message: detail || 'The transaction could not be submitted.' }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function Progress({ stage, onNavigate }: { stage: Stage; onNavigate: (stage: Stage) => void }) {
  const activeIndex = stageLabels.findIndex((item) => item.key === stage)
  return (
    <nav className="progress" aria-label="Scan progress">
      {stageLabels.map((item, index) => (
        <button
          className={index === activeIndex ? 'is-current' : index < activeIndex ? 'is-complete' : 'is-locked'}
          disabled={index >= activeIndex}
          key={item.key}
          onClick={() => onNavigate(item.key)}
          type="button"
        >
          <span>{String(index + 1).padStart(2, '0')}</span>{item.label}
        </button>
      ))}
    </nav>
  )
}

function Arrow() {
  return <span className="arrow" aria-hidden="true">&#8594;</span>
}

function TokenArtifact({ symbol = 'AAPLx', danger = false }: { symbol?: string; danger?: boolean }) {
  return (
    <div className={`artifact ${danger ? 'is-danger' : ''}`} aria-hidden="true">
      <div className="artifact-orbit orbit-one" />
      <div className="artifact-orbit orbit-two" />
      <div className="token-disc">
        <div className="token-rim">
          <span className="token-mark">SL</span>
          <strong>{symbol}</strong>
          <small>{danger ? 'UNVERIFIED MINT' : 'TOKENIZED EQUITY'}</small>
        </div>
      </div>
      <div className="artifact-base" />
    </div>
  )
}

function App() {
  const { connection } = useConnection()
  const { connected, publicKey, signTransaction, sendTransaction } = useWallet()
  const [stage, setStage] = useState<Stage>('input')
  const [mint, setMint] = useState('')
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [positionSize, setPositionSize] = useState('1')
  const [percentage, setPercentage] = useState<(typeof PERCENTAGES)[number]>(100)
  const [exitResult, setExitResult] = useState<ExitResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [exitBusy, setExitBusy] = useState(false)
  const [error, setError] = useState('')
  const [slippageBps, setSlippageBps] = useState<(typeof SLIPPAGE_OPTIONS)[number]>(50)
  const [walletPrompted, setWalletPrompted] = useState(false)
  const [walletBusy, setWalletBusy] = useState(false)
  const [walletMessage, setWalletMessage] = useState('')
  const [walletBalance, setWalletBalance] = useState<string | null>(null)
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>('idle')
  const [executionMessage, setExecutionMessage] = useState('')
  const [transactionSignature, setTransactionSignature] = useState<string | null>(null)
  const [builtSwap, setBuiltSwap] = useState<BuiltSwap | null>(null)
  const [receiptEnvelope, setReceiptEnvelope] = useState<DecisionReceiptEnvelope | null>(null)
  const [memoMessage, setMemoMessage] = useState('')

  const scan = async (event?: FormEvent) => {
    event?.preventDefault()
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await postJson<ScanResponse>('/api/scan', { mint })
      setResult(response)
      setStage('verification')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This mint could not be scanned.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!['exit', 'rehearsal'].includes(stage) || !result?.asset) return
    const timer = window.setTimeout(async () => {
      setExitBusy(true)
      setError('')
      try {
        setExitResult(await postJson<ExitResponse>('/api/exit-preview', { mint: result.scan.mintAddress, positionSize, percentage, slippageBps }))
      } catch (caught) {
        setExitResult(null)
        setError(caught instanceof Error ? caught.message : 'The exit quote is unavailable.')
      } finally {
        setExitBusy(false)
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [stage, positionSize, percentage, slippageBps, result])

  useEffect(() => {
    const handleWalletError = (event: Event) => {
      const message = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : ''
      setWalletMessage(walletErrorMessage(message))
      setWalletBusy(false)
    }
    window.addEventListener('stocklens-wallet-error', handleWalletError)
    return () => window.removeEventListener('stocklens-wallet-error', handleWalletError)
  }, [])

  useEffect(() => {
    if (!walletPrompted || !connected || !publicKey || !result) return
    let cancelled = false

    const loadWalletPosition = async () => {
      setWalletBusy(true)
      setWalletMessage('')
      try {
        const genesisHash = await connection.getGenesisHash()
        if (genesisHash !== MAINNET_GENESIS_HASH) throw new Error('wrong-network')

        const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(result.scan.mintAddress),
        })
        const rawBalance = accounts.value.reduce((total, account) => {
          const amount = account.account.data.parsed.info.tokenAmount.amount as string
          return total + BigInt(amount)
        }, 0n)

        if (rawBalance === 0n) {
          if (!cancelled) {
            setWalletBalance('0')
            setPositionSize('0')
            setWalletMessage(`This wallet holds no ${result.asset?.symbol ?? 'scanned token'} on Solana mainnet.`)
          }
          return
        }

        const balance = formatTokenBalance(rawBalance, result.scan.mint.decimals)
        if (!cancelled) {
          setWalletBalance(balance)
          setPositionSize(balance)
          setStage('rehearsal')
        }
      } catch (caught) {
        if (cancelled) return
        setWalletMessage(
          caught instanceof Error && caught.message === 'wrong-network'
            ? 'StockLens is not connected to Solana mainnet. Switch networks and try again.'
            : 'StockLens could not read this token balance. Check the wallet connection and try again.',
        )
      } finally {
        if (!cancelled) setWalletBusy(false)
      }
    }

    void loadWalletPosition()
    return () => { cancelled = true }
  }, [walletPrompted, connected, publicKey, result, connection])

  const reset = () => {
    setStage('input')
    setMint('')
    setResult(null)
    setExitResult(null)
    setError('')
    setWalletPrompted(false)
    setWalletMessage('')
    setWalletBalance(null)
    setPositionSize('1')
    setPercentage(100)
    setSlippageBps(50)
    setExecutionStatus('idle')
    setExecutionMessage('')
    setTransactionSignature(null)
    setBuiltSwap(null)
    setReceiptEnvelope(null)
    setMemoMessage('')
  }

  const status = result?.scan.verification.status ?? 'unverified'
  const critical = status === 'critical'
  const canContinue = Boolean(result?.asset) && !critical
  const expectedCount = result?.scan.controlFindings.filter((finding) => finding.classification === 'expected').length ?? 0
  const unexpectedCount = result?.scan.controlFindings.filter((finding) => finding.classification === 'unexpected').length ?? 0
  const priceDivergence = result?.priceRadar.premiumDiscountPercentage ?? null
  const availableQuote = exitResult?.preview.status === 'available' ? exitResult.preview : null
  const rehearsalConditions = [
    {
      id: 'verified-issuer',
      label: 'Verified issuer',
      passed: status === 'verified',
      fact: status === 'verified' ? `${result?.asset?.issuer ?? 'Issuer'} registry match` : statusCopy[status].label,
      required: 'verified registry mint and controls',
    },
    {
      id: 'liquidity-threshold',
      label: 'Liquidity above threshold',
      passed: Boolean(availableQuote && availableQuote.priceImpactPercentage <= 3),
      fact: availableQuote ? `${availableQuote.priceImpactPercentage.toFixed(3)}% impact, limit 3%` : 'No executable quote',
      required: 'price impact at or below 3%',
    },
    {
      id: 'unexpected-controls',
      label: 'No unexpected controls',
      passed: unexpectedCount === 0,
      fact: unexpectedCount === 0 ? `${expectedCount} documented controls` : `${unexpectedCount} unexpected controls`,
      required: 'zero unexpected controls',
    },
    {
      id: 'price-divergence',
      label: 'Price divergence within limits',
      passed: priceDivergence !== null && Math.abs(priceDivergence) <= 5,
      fact: priceDivergence === null ? 'Reference price unavailable' : `${Math.abs(priceDivergence).toFixed(2)}% divergence, limit 5%`,
      required: 'absolute divergence at or below 5%',
    },
  ]

  const awaitConfirmation = async (signature: string, lastValidBlockHeight: number, timeoutMs = 45_000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
      const transactionStatus = response.value[0]
      if (transactionStatus?.err) throw new Error(`Transaction failed: ${JSON.stringify(transactionStatus.err)}`)
      if (transactionStatus?.confirmationStatus === 'confirmed' || transactionStatus?.confirmationStatus === 'finalized') return true
      if (!transactionStatus && await connection.getBlockHeight('confirmed') > lastValidBlockHeight) throw new Error('Transaction expired: last valid block height passed.')
      await wait(1_800)
    }
    return false
  }

  const completeReceipt = async (swap: BuiltSwap, signature: string) => {
    if (!result || !result.asset || !publicKey) return

    const receipt: DecisionReceipt = {
      receiptVersion: '1.0',
      receiptId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      walletAddress: publicKey.toBase58(),
      mintAddress: result.scan.mintAddress,
      symbol: result.asset.symbol,
      issuer: result.asset.issuer,
      registryVersion: result.scan.verification.registryVersion,
      scanId: result.scan.scanId,
      verification: {
        status,
        findings: result.scan.controlFindings.map((finding) => ({
          type: finding.type,
          address: finding.address,
          classification: finding.classification,
          summary: finding.summary,
        })),
      },
      conditions: rehearsalConditions.map((condition) => ({
        id: condition.id,
        label: condition.label,
        passed: condition.passed,
        observedValue: condition.fact,
        requiredValue: condition.required,
      })),
      pyth: result.priceRadar.underlying.status === 'available'
        ? {
            status: 'available',
            feedId: String(result.priceRadar.underlying.feedId),
            referencePrice: result.priceRadar.underlying.price,
            publishTime: result.priceRadar.underlying.publishTime,
          }
        : {
            status: 'unavailable',
            feedId: result.priceRadar.underlying.feedId === null ? null : String(result.priceRadar.underlying.feedId),
            reason: result.priceRadar.underlying.reason,
          },
      jupiterQuote: {
        inputMint: swap.quote.inputMint,
        outputMint: swap.quote.outputMint,
        inputAmount: swap.quote.inputAmountRaw,
        expectedOutputAmount: swap.quote.expectedOutputAmount,
        minimumOutputAmount: swap.quote.minimumOutputAmount,
        priceImpactPercent: swap.quote.priceImpactPercentage,
        slippageBps: swap.quote.slippageBps,
        quotedAt: swap.quote.quotedAt,
      },
      transaction: {
        signature,
        explorerUrl: `${SOLSCAN_TRANSACTION}${signature}`,
      },
      memo: { mode: 'follow-up-transaction' },
    }

    const envelope = await createReceiptEnvelope(receipt)
    setReceiptEnvelope(envelope)
    setExecutionStatus('confirmed')
    setStage('receipt')

    // Jupiter returns a compiled versioned transaction. Rebuilding it to insert
    // a Memo can invalidate address-table assumptions, so the receipt proof is
    // sent as a small, reliable follow-up transaction after swap confirmation.
    try {
      setMemoMessage('Awaiting signature for the on-chain receipt proof...')
      const latest = await connection.getLatestBlockhash('confirmed')
      const memoTransaction = new Transaction({
        feePayer: publicKey,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      }).add(new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        data: new TextEncoder().encode(`StockLens:${envelope.receiptHash}:${result.scan.mintAddress}`) as TransactionInstruction['data'],
      }))
      const memoSignature = await sendTransaction(memoTransaction, connection, { skipPreflight: false, maxRetries: 3 })
      setMemoMessage('Receipt proof submitted to Solana.')
      const memoConfirmed = await awaitConfirmation(memoSignature, latest.lastValidBlockHeight, 30_000)
      setReceiptEnvelope({
        ...envelope,
        memoSignature,
        memoExplorerUrl: `${SOLSCAN_TRANSACTION}${memoSignature}`,
      })
      setMemoMessage(memoConfirmed ? 'Receipt proof confirmed on Solana.' : 'Receipt proof submitted. Confirmation is taking longer than expected.')
    } catch (memoError) {
      const detail = executionError(memoError)
      setMemoMessage(detail.kind === 'rejected' ? 'On-chain receipt proof was skipped. Your local receipt is still complete.' : `Receipt proof was not confirmed: ${detail.message}`)
    }
  }

  const executeSwap = async () => {
    if (!result?.asset || !exitResult || !availableQuote || !publicKey || !signTransaction) return
    setStage('execution')
    setExecutionStatus('awaiting-signature')
    setExecutionMessage('Building a fresh Jupiter route...')
    setTransactionSignature(null)
    setReceiptEnvelope(null)

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const swap = await postJson<BuiltSwap>('/api/swap-transaction', {
          mint: result.scan.mintAddress,
          inputAmount: exitResult.exitAmount,
          slippageBps,
          userPublicKey: publicKey.toBase58(),
        })
        setBuiltSwap(swap)
        setExecutionStatus('awaiting-signature')
        setExecutionMessage(attempt === 0 ? 'Check the transaction in your wallet.' : 'The route was refreshed once. Review the new transaction in your wallet.')

        try {
          const bytes = Uint8Array.from(atob(swap.swapTransaction), (character) => character.charCodeAt(0))
          const transaction = VersionedTransaction.deserialize(bytes)
          const signed = await signTransaction(transaction)
          setExecutionStatus('submitted')
          setExecutionMessage('Submitting the signed transaction...')
          const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 })
          setTransactionSignature(signature)
          setExecutionStatus('confirming')
          setExecutionMessage('Waiting for Solana confirmation...')

          const confirmed = await awaitConfirmation(signature, swap.lastValidBlockHeight)
          if (!confirmed) {
            setExecutionStatus('timed-out')
            setExecutionMessage('Confirmation is taking longer than expected. The transaction may still land.')
            return
          }

          await completeReceipt(swap, signature)
          return
        } catch (caught) {
          const detail = executionError(caught)
          if (detail.kind === 'expired' && attempt === 0 && !transactionSignature) {
            setExecutionMessage('The route expired. Re-quoting once...')
            continue
          }
          throw caught
        }
      }
    } catch (caught) {
      const detail = executionError(caught)
      setExecutionStatus('failed')
      setExecutionMessage(detail.message)
    }
  }

  const checkConfirmation = async () => {
    if (!transactionSignature || !builtSwap) return
    setExecutionStatus('confirming')
    setExecutionMessage('Checking Solana again...')
    try {
      const response = await connection.getSignatureStatuses([transactionSignature], { searchTransactionHistory: true })
      const current = response.value[0]
      if (current?.err) throw new Error(`Transaction failed: ${JSON.stringify(current.err)}`)
      if (current?.confirmationStatus === 'confirmed' || current?.confirmationStatus === 'finalized') {
        await completeReceipt(builtSwap, transactionSignature)
        return
      }
      setExecutionStatus('timed-out')
      setExecutionMessage('Still not confirmed. Use Solscan to follow the transaction, then check again.')
    } catch (caught) {
      setExecutionStatus('failed')
      setExecutionMessage(executionError(caught).message)
    }
  }

  const navigateStage = (target: Stage) => {
    const transactionInFlight = stage === 'execution' && ['awaiting-signature', 'submitted', 'confirming'].includes(executionStatus)
    if (!transactionInFlight) setStage(target)
  }

  return (
    <main className={`app status-theme-${status}`} data-stage={stage}>
      <a className="skip-link" href="#stocklens-experience">Skip to scanner</a>
      <header className="topbar">
        <button className="brand" type="button" onClick={reset} aria-label="StockLens home"><i aria-hidden="true">S</i>Stock<span>Lens</span></button>
        <Progress stage={stage} onNavigate={navigateStage} />
        <span className="network"><i aria-hidden="true" />Solana mainnet</span>
      </header>

      <section className="experience" id="stocklens-experience" aria-live="polite">
        {stage === 'input' && (
          <div className="scene scene-input">
            <div className="scene-copy enter-one">
              <p className="context-label">Pre-trade token safety</p>
              <h1>Know what<br /><em>you own.</em></h1>
              <p className="intro">Verify the issuer, compare the real price, and preview your exit before you trade.</p>
              <form className="scan-form" onSubmit={scan}>
                <label htmlFor="mint">Solana mint address</label>
                <div className="scan-field">
                  <input id="mint" value={mint} onChange={(event) => setMint(event.target.value)} placeholder="Paste a base58 mint" autoComplete="off" spellCheck={false} required />
                  <button className="primary-action" disabled={busy || !mint.trim()} type="submit">{busy ? 'Reading chain' : 'Scan'} <Arrow /></button>
                </div>
                <div className="form-foot"><span>No wallet required</span><button type="button" onClick={() => setMint(AAPLX_MINT)}>Use AAPLx example</button></div>
                {error && <p className="message error-message" role="alert">{error}</p>}
              </form>
            </div>
            <div className="scene-visual enter-two">
              <TokenArtifact />
              <div className="visual-caption"><span>Mint identity</span><strong>Not the ticker. Not the logo.</strong></div>
            </div>
          </div>
        )}

        {stage === 'verification' && result && (
          <div className={`scene scene-verification is-${status}`}>
            <div className="scene-copy enter-one">
              <p className="status-label">{statusCopy[status].label}</p>
              <h1>{statusCopy[status].headline}</h1>
              <p className="intro">{statusCopy[status].body}</p>
              <div className="verification-summary">
                <div><span>Asset</span><strong>{result.asset?.symbol ?? 'Unknown token'}</strong></div>
                <div><span>Issuer</span><strong>{result.asset?.issuer ?? 'No verified issuer'}</strong></div>
                <div><span>Mint</span><code title={result.scan.mintAddress}>{shortAddress(result.scan.mintAddress)}</code></div>
              </div>
              {critical ? (
                <div className="critical-note"><strong>Active mint authority detected.</strong><span>More supply can be created by an unidentified wallet.</span></div>
              ) : (
                <div className="confidence-line"><span className="check" aria-hidden="true">&#10003;</span><div><strong>{expectedCount} documented controls match</strong><span>Expected issuer powers are explained, not hidden.</span></div></div>
              )}
              <div className="scene-actions">
                {canContinue && <button className="primary-action" type="button" onClick={() => setStage('price')}>Check the price <Arrow /></button>}
                <button className="text-action" type="button" onClick={reset}>Scan another mint</button>
              </div>
            </div>
            <div className="scene-visual verification-visual enter-two">
              <TokenArtifact symbol={result.asset?.symbol ?? '???'} danger={critical} />
              <details className="control-details">
                <summary>View {result.scan.controlFindings.length} control details</summary>
                <div className="findings">
                  {result.scan.controlFindings.length === 0 ? (
                    <div className="finding"><strong>No active controls detected</strong><p>No authority or extension controls need explanation.</p></div>
                  ) : result.scan.controlFindings.map((finding) => (
                    <div className={`finding finding-${finding.classification}`} key={finding.id}>
                      <div><span>{finding.classification === 'expected' ? 'Documented' : finding.classification}</span><code>{shortAddress(finding.address)}</code></div>
                      <strong>{finding.title}</strong><p>{finding.summary}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}

        {stage === 'price' && result && (
          <div className="scene scene-price">
            <div className="scene-copy enter-one">
              <p className="context-label">Price radar</p>
              {result.priceRadar.premiumDiscountPercentage !== null ? (
                <h1>{result.asset?.symbol} is trading <em>{Math.abs(result.priceRadar.premiumDiscountPercentage).toFixed(2)}% {result.priceRadar.premiumDiscountPercentage >= 0 ? 'above' : 'below'}</em> {result.asset?.underlyingTicker}.</h1>
              ) : <h1>One price is <em>still missing.</em></h1>}
              <p className="intro">{result.priceRadar.premiumDiscountPercentage !== null ? 'See the reference value beside the price you can actually route.' : 'The executable token quote is ready. The reference feed is currently unavailable.'}</p>
              <div className="scene-actions">
                <button className="primary-action" type="button" onClick={() => setStage('exit')}>Preview my exit <Arrow /></button>
                <button className="text-action" type="button" onClick={() => setStage('verification')}>Back to verification</button>
              </div>
            </div>
            <div className="comparison enter-two">
              <div className="comparison-head"><span>Official {result.asset?.symbol}</span><strong>{result.priceRadar.premiumDiscountPercentage === null ? 'Partial data' : `${result.priceRadar.premiumDiscountPercentage >= 0 ? '+' : ''}${result.priceRadar.premiumDiscountPercentage.toFixed(2)}%`}</strong></div>
              <div className="price-pair">
                <section>
                  <span>{result.asset?.underlyingTicker} reference</span>
                  {result.priceRadar.underlying.status === 'available' ? <><strong>{money(result.priceRadar.underlying.price, 4)}</strong><small>Published {timestamp(result.priceRadar.underlying.publishTime)}</small><small>Confidence {result.priceRadar.underlying.confidence === null ? 'not supplied' : `+/- ${money(result.priceRadar.underlying.confidence, 4)}`}</small></> : <><strong className="unavailable-price">Unavailable</strong><small>{result.priceRadar.underlying.reason}</small></>}
                </section>
                <section>
                  <span>{result.asset?.symbol} executable</span>
                  {result.priceRadar.token.status === 'available' ? <><strong>{money(result.priceRadar.token.expectedOutputUsd, 4)}</strong><small>Jupiter quote at {timestamp(result.priceRadar.token.quotedAt)}</small><small>{result.priceRadar.token.priceImpactPercentage.toFixed(3)}% price impact</small></> : <><strong className="unavailable-price">No route</strong><small>Jupiter could not find an executable quote.</small></>}
                </section>
              </div>
              <p className="comparison-note">Reference value is not the same as realizable value.</p>
            </div>
          </div>
        )}

        {stage === 'exit' && result && (
          <div className="scene scene-exit">
            <div className="scene-copy enter-one">
              <p className="context-label">Exit preview</p>
              <h1>See what reaches <em>your wallet.</em></h1>
              <p className="intro">Choose a position size. StockLens checks the live route to USDC.</p>
              <div className="position-control">
                <label htmlFor="position">{connected ? 'Connected wallet balance' : `Your ${result.asset?.symbol} position`}</label>
                <div className="position-field"><input id="position" inputMode="decimal" value={positionSize} readOnly={connected} onChange={(event) => setPositionSize(event.target.value)} /><span>{result.asset?.symbol}</span></div>
                <div className="presets" aria-label="Exit percentage">{PERCENTAGES.map((value) => <button className={percentage === value ? 'is-selected' : ''} key={value} type="button" onClick={() => setPercentage(value)}>{value}%</button>)}</div>
              </div>
              <div className="scene-actions">
                {!walletPrompted ? (
                  <button className="primary-action" type="button" onClick={() => { setWalletPrompted(true); setWalletMessage('') }}>Continue to rehearsal <Arrow /></button>
                ) : walletBusy ? (
                  <button className="primary-action" type="button" disabled>Reading wallet</button>
                ) : (
                  <BaseWalletMultiButton className="primary-action wallet-connect-action" labels={WALLET_BUTTON_LABELS} />
                )}
                <button className="text-action" type="button" onClick={() => setStage('price')}>Back to price radar</button>
              </div>
              {walletMessage && <p className="message wallet-message" role="status">{walletMessage}</p>}
              {error && <p className="message error-message" role="alert">{error}</p>}
            </div>
            <div className="exit-receipt enter-two">
              <div className="receipt-head"><span>Live Jupiter route</span><small>{percentage}% of position</small></div>
              {exitBusy ? <div className="quote-skeleton" aria-label="Finding executable route"><i /><i /><i /></div> : exitResult?.preview.status === 'available' ? (
                <>
                  <div className="exit-hero-number"><span>Estimated USDC out</span><strong>{money(exitResult.preview.expectedOutputUsd)}</strong></div>
                  <div className="exit-comparison"><div><span>Displayed value</span><strong>{exitResult.preview.referenceValueUsd === null ? 'Unavailable' : money(exitResult.preview.referenceValueUsd)}</strong></div><div className="difference"><span>Exit difference</span><strong>{exitResult.preview.referenceValueUsd === null ? 'No reference' : money(exitResult.preview.expectedOutputUsd - exitResult.preview.referenceValueUsd)}</strong></div></div>
                  <div className="route-facts"><div><span>Exit amount</span><strong>{exitResult.exitAmount} {result.asset?.symbol}</strong></div><div><span>Price impact</span><strong>{exitResult.preview.priceImpactPercentage.toFixed(3)}%</strong></div><div><span>Minimum received</span><strong>{money(exitResult.preview.minimumOutputUsd)}</strong></div></div>
                </>
              ) : <div className="quote-empty"><strong>No executable route</strong><p>Try a smaller position to check available liquidity.</p></div>}
            </div>
          </div>
        )}

        {stage === 'rehearsal' && result && walletBalance && (
          <div className="scene scene-rehearsal">
            <div className="scene-copy enter-one">
              <p className="context-label">Trade rehearsal</p>
              <h1>Review before <em>you sign.</em></h1>
              <p className="intro">These are the current transaction facts. StockLens does not label a trade safe.</p>

              <div className="exchange-summary">
                <span>Assets being exchanged</span>
                <strong>{exitResult?.exitAmount ?? '...'} {result.asset?.symbol} <i>&#8594;</i> {availableQuote ? `~${availableQuote.expectedOutputUsd.toFixed(2)}` : '...'} USDC</strong>
                <small>Wallet balance: {walletBalance} {result.asset?.symbol}. Exiting {percentage}%.</small>
              </div>

              <div className="slippage-control">
                <span>Slippage tolerance</span>
                <div>
                  {SLIPPAGE_OPTIONS.map((value) => (
                    <button className={slippageBps === value ? 'is-selected' : ''} key={value} type="button" onClick={() => setSlippageBps(value)}>{(value / 100).toFixed(1)}%</button>
                  ))}
                </div>
              </div>

              <div className="scene-actions">
                <button className="primary-action execute-action" type="button" disabled={!availableQuote || exitBusy} onClick={() => void executeSwap()}>{exitBusy ? 'Refreshing quote' : 'Approve and swap'} <Arrow /></button>
                <button className="text-action" type="button" onClick={() => setStage('exit')}>Back to exit preview</button>
              </div>
            </div>

            <article className="rehearsal-panel enter-two">
              <header className="rehearsal-head">
                <div><span>Review before you sign</span><strong>{result.asset?.symbol} to USDC</strong></div>
                <span className={`rehearsal-verification status-${status}`}>{statusCopy[status].label}</span>
              </header>

              <div className="rehearsal-values">
                <div><span>Expected output</span><strong>{availableQuote ? `${money(availableQuote.expectedOutputUsd)} USDC` : 'Quote unavailable'}</strong></div>
                <div><span>Price impact</span><strong>{availableQuote ? `${availableQuote.priceImpactPercentage.toFixed(3)}%` : 'Unavailable'}</strong></div>
                <div><span>Minimum received</span><strong>{availableQuote ? `${money(availableQuote.minimumOutputUsd)} USDC` : 'Unavailable'}</strong></div>
                <div><span>Slippage</span><strong>{(slippageBps / 100).toFixed(1)}%</strong></div>
              </div>

              <section className="conditions" aria-label="Trade conditions">
                <h2>Conditions observed</h2>
                {rehearsalConditions.map((condition) => (
                  <div className={condition.passed ? 'condition-pass' : 'condition-fail'} key={condition.label}>
                    <span aria-hidden="true">{condition.passed ? '\u2713' : '!'}</span>
                    <div><strong>{condition.label}</strong><small>{condition.fact}</small></div>
                  </div>
                ))}
              </section>

              <footer className="rehearsal-foot">
                <span>Connected wallet</span>
                <code>{shortAddress(publicKey?.toBase58() ?? null)}</code>
              </footer>
            </article>
          </div>
        )}

        {stage === 'execution' && result && (
          <div className="scene scene-execution">
            <div className="scene-copy enter-one">
              <p className="context-label">Live execution</p>
              <h1>Your trade is <em>in motion.</em></h1>
              <p className="intro">Keep this page open while StockLens tracks the transaction directly on Solana.</p>

              <div className="execution-timeline" aria-label="Transaction status">
                {[
                  ['awaiting-signature', 'Awaiting signature'],
                  ['submitted', 'Submitted'],
                  ['confirming', 'Confirming'],
                  ['confirmed', 'Confirmed'],
                ].map(([key, label], index) => {
                  const order: ExecutionStatus[] = ['awaiting-signature', 'submitted', 'confirming', 'confirmed']
                  const activeIndex = order.indexOf(executionStatus)
                  const complete = executionStatus === 'timed-out' ? index < 2 : activeIndex > index
                  const active = executionStatus === key || (executionStatus === 'timed-out' && key === 'confirming')
                  return <div className={complete ? 'is-complete' : active ? 'is-active' : ''} key={key}><span>{complete ? '\u2713' : index + 1}</span><strong>{label}</strong></div>
                })}
              </div>

              <p className={`execution-message execution-${executionStatus}`} role="status">{executionMessage}</p>
              <div className="scene-actions">
                {executionStatus === 'failed' && <button className="primary-action" type="button" onClick={() => setStage('rehearsal')}>Review and retry</button>}
                {executionStatus === 'timed-out' && <button className="primary-action" type="button" onClick={() => void checkConfirmation()}>Check confirmation</button>}
                {transactionSignature && <a className="text-link" href={`${SOLSCAN_TRANSACTION}${transactionSignature}`} target="_blank" rel="noreferrer">View on Solscan</a>}
              </div>
            </div>

            <div className="execution-card enter-two">
              <span>Current transaction</span>
              <strong>{result.asset?.symbol ?? 'Token'} <i>&#8594;</i> USDC</strong>
              <div><span>Amount</span><b>{builtSwap?.quote.inputAmount ?? exitResult?.exitAmount ?? '...'} {result.asset?.symbol ?? 'Token'}</b></div>
              <div><span>Expected output</span><b>{builtSwap ? `~${builtSwap.quote.expectedOutputUsd.toFixed(2)} USDC` : 'Building route'}</b></div>
              <div><span>Slippage</span><b>{(slippageBps / 100).toFixed(1)}%</b></div>
              <small>No transaction is labelled safe. Your wallet shows the final instructions before signing.</small>
            </div>
          </div>
        )}

        {stage === 'receipt' && result && receiptEnvelope && (
          <div className="scene scene-receipt">
            <div className="scene-copy enter-one">
              <p className="context-label">Decision receipt</p>
              <h1>Confirmed. <em>Keep the proof.</em></h1>
              <p className="intro">A durable record of what StockLens observed before your transaction was signed.</p>

              <div className="receipt-proof">
                <span>SHA-256 receipt hash</span>
                <code title={receiptEnvelope.receiptHash}>{receiptEnvelope.receiptHash.slice(0, 16)}...{receiptEnvelope.receiptHash.slice(-12)}</code>
                <button type="button" onClick={() => void navigator.clipboard.writeText(receiptEnvelope.receiptHash)}>Copy hash</button>
              </div>

              <div className="scene-actions">
                <button className="primary-action" type="button" onClick={() => downloadReceipt(receiptEnvelope)}>Download receipt JSON</button>
                <button className="text-action" type="button" onClick={reset}>Scan another mint</button>
              </div>
              {memoMessage && <p className="message wallet-message" role="status">{memoMessage}</p>}
            </div>

            <article className="decision-receipt enter-two">
              <header>
                <div><span>Transaction confirmed</span><strong>{receiptEnvelope.receipt.symbol} to USDC</strong></div>
                <span className={`rehearsal-verification status-${receiptEnvelope.receipt.verification.status}`}>{statusCopy[receiptEnvelope.receipt.verification.status].label}</span>
              </header>

              <div className="receipt-grid">
                <div><span>Issuer</span><strong>{receiptEnvelope.receipt.issuer}</strong></div>
                <div><span>Registry</span><strong>{receiptEnvelope.receipt.registryVersion}</strong></div>
                <div><span>Mint</span><code title={receiptEnvelope.receipt.mintAddress}>{shortAddress(receiptEnvelope.receipt.mintAddress)}</code></div>
                <div><span>Pyth reference</span><strong>{receiptEnvelope.receipt.pyth.status === 'available' ? money(receiptEnvelope.receipt.pyth.referencePrice ?? 0, 4) : 'Unavailable'}</strong><small>{receiptEnvelope.receipt.pyth.publishTime ? timestamp(receiptEnvelope.receipt.pyth.publishTime) : receiptEnvelope.receipt.pyth.reason}</small></div>
                <div><span>Expected output</span><strong>{(Number(receiptEnvelope.receipt.jupiterQuote.expectedOutputAmount) / 1_000_000).toFixed(2)} USDC</strong></div>
                <div><span>Price impact</span><strong>{receiptEnvelope.receipt.jupiterQuote.priceImpactPercent.toFixed(3)}%</strong></div>
                <div><span>Slippage used</span><strong>{(receiptEnvelope.receipt.jupiterQuote.slippageBps / 100).toFixed(1)}%</strong></div>
                <div><span>Transaction signature</span><code title={receiptEnvelope.receipt.transaction.signature}>{shortAddress(receiptEnvelope.receipt.transaction.signature)}</code></div>
              </div>

              <section className="conditions receipt-conditions" aria-label="Receipt conditions">
                <h2>Conditions observed</h2>
                {receiptEnvelope.receipt.conditions.map((condition) => (
                  <div className={condition.passed ? 'condition-pass' : 'condition-fail'} key={condition.id}>
                    <span aria-hidden="true">{condition.passed ? '\u2713' : '!'}</span>
                    <div><strong>{condition.label}</strong><small>{condition.observedValue}</small></div>
                  </div>
                ))}
              </section>

              <section className="receipt-findings">
                <h2>Authority findings</h2>
                {receiptEnvelope.receipt.verification.findings.length === 0 ? <p>No active authority findings.</p> : receiptEnvelope.receipt.verification.findings.map((finding, index) => (
                  <div key={`${finding.type}-${index}`}><span className={`finding-dot finding-dot-${finding.classification}`} /><div><strong>{finding.type.replaceAll('-', ' ')}</strong><small>{finding.summary}</small></div><code>{shortAddress(finding.address)}</code></div>
                ))}
              </section>

              <footer>
                <a href={receiptEnvelope.receipt.transaction.explorerUrl} target="_blank" rel="noreferrer">Swap transaction</a>
                {receiptEnvelope.memoExplorerUrl ? <a href={receiptEnvelope.memoExplorerUrl} target="_blank" rel="noreferrer">Memo proof</a> : <span>Memo proof pending</span>}
              </footer>
            </article>
          </div>
        )}
      </section>

      <footer className="footer"><span>On-chain identity</span><span>Pyth reference</span><span>Jupiter execution</span></footer>
    </main>
  )
}

export default App
