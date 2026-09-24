import { type FormEvent, useEffect, useState } from 'react'

import type { ExitPreview } from './lib/jupiter/exitPreview'
import type { PythProPrice } from './lib/pyth/pro'
import type { ScanResult, VerificationStatus } from './types'

const AAPLX_MINT = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp'
const PERCENTAGES = [10, 25, 50, 100] as const
type Stage = 'input' | 'verification' | 'price' | 'exit'

interface AssetSummary { issuer: string; symbol: string; underlyingTicker: string }
interface PriceRadar { underlying: PythProPrice; token: ExitPreview; premiumDiscountPercentage: number | null }
interface ScanResponse { scan: ScanResult; asset: AssetSummary | null; priceRadar: PriceRadar }
interface ExitResponse {
  preview: ExitPreview
  exitAmount: string
  percentage: number
  referencePrice: { status: 'available'; price: number } | { status: 'unavailable' }
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

async function postJson<T>(url: string, body: object): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(result.error ?? 'Request failed.')
  return result
}

function Progress({ stage }: { stage: Stage }) {
  const activeIndex = stageLabels.findIndex((item) => item.key === stage)
  return (
    <nav className="progress" aria-label="Scan progress">
      {stageLabels.map((item, index) => (
        <span className={index === activeIndex ? 'is-current' : index < activeIndex ? 'is-complete' : ''} key={item.key}>{item.label}</span>
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
  const [stage, setStage] = useState<Stage>('input')
  const [mint, setMint] = useState('')
  const [result, setResult] = useState<ScanResponse | null>(null)
  const [positionSize, setPositionSize] = useState('1')
  const [percentage, setPercentage] = useState<(typeof PERCENTAGES)[number]>(100)
  const [exitResult, setExitResult] = useState<ExitResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [exitBusy, setExitBusy] = useState(false)
  const [error, setError] = useState('')

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
    if (stage !== 'exit' || !result?.asset) return
    const timer = window.setTimeout(async () => {
      setExitBusy(true)
      setError('')
      try {
        setExitResult(await postJson<ExitResponse>('/api/exit-preview', { mint: result.scan.mintAddress, positionSize, percentage }))
      } catch (caught) {
        setExitResult(null)
        setError(caught instanceof Error ? caught.message : 'The exit quote is unavailable.')
      } finally {
        setExitBusy(false)
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [stage, positionSize, percentage, result])

  const reset = () => {
    setStage('input')
    setMint('')
    setResult(null)
    setExitResult(null)
    setError('')
  }

  const status = result?.scan.verification.status ?? 'unverified'
  const critical = status === 'critical'
  const canContinue = Boolean(result?.asset) && !critical
  const expectedCount = result?.scan.controlFindings.filter((finding) => finding.classification === 'expected').length ?? 0

  return (
    <main className={`app status-theme-${status}`}>
      <header className="topbar">
        <button className="brand" type="button" onClick={reset} aria-label="StockLens home">Stock<span>Lens</span></button>
        <Progress stage={stage} />
        <span className="network">Solana mainnet</span>
      </header>

      <section className="experience" aria-live="polite">
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
                <label htmlFor="position">Your {result.asset?.symbol} position</label>
                <div className="position-field"><input id="position" inputMode="decimal" value={positionSize} onChange={(event) => setPositionSize(event.target.value)} /><span>{result.asset?.symbol}</span></div>
                <div className="presets" aria-label="Exit percentage">{PERCENTAGES.map((value) => <button className={percentage === value ? 'is-selected' : ''} key={value} type="button" onClick={() => setPercentage(value)}>{value}%</button>)}</div>
              </div>
              <div className="scene-actions"><button className="primary-action" type="button" onClick={reset}>Scan another mint <Arrow /></button><button className="text-action" type="button" onClick={() => setStage('price')}>Back to price radar</button></div>
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
      </section>

      <footer className="footer"><span>On-chain identity</span><span>Pyth reference</span><span>Jupiter execution</span></footer>
    </main>
  )
}

export default App
