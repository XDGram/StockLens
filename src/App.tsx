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

const statusCopy: Record<VerificationStatus, { label: string; title: string; body: string }> = {
  verified: { label: 'Verified issuer', title: 'This mint matches the official registry.', body: 'Live controls match the issuer configuration documented by StockLens.' },
  'known-wrapper': { label: 'Known wrapper', title: 'The asset is known, but a control has changed.', body: 'Review the unexpected control before deciding whether to continue.' },
  unverified: { label: 'Unverified', title: 'StockLens cannot verify this mint.', body: 'The address is not linked to a supported issuer in the current registry.' },
  critical: { label: 'Critical control risk', title: 'An unidentified wallet retains powerful control.', body: 'This mint is unverified and can still be changed in a way that may harm holders.' },
}

function shortAddress(address: string | null): string {
  return address ? `${address.slice(0, 5)}...${address.slice(-5)}` : 'No address exposed'
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

function StepIndicator({ stage }: { stage: Stage }) {
  const stages: Stage[] = ['input', 'verification', 'price', 'exit']
  const activeIndex = stages.indexOf(stage)
  return (
    <ol className="steps" aria-label="Scan progress">
      {['Mint', 'Verify', 'Price', 'Exit'].map((label, index) => (
        <li className={index <= activeIndex ? 'is-active' : ''} key={label}><span>{index + 1}</span>{label}</li>
      ))}
    </ol>
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
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (stage !== 'exit' || !result?.asset) return
    const timer = window.setTimeout(async () => {
      setExitBusy(true)
      setError('')
      try {
        setExitResult(await postJson<ExitResponse>('/api/exit-preview', {
          mint: result.scan.mintAddress, positionSize, percentage,
        }))
      } catch (caught) {
        setExitResult(null)
        setError(caught instanceof Error ? caught.message : 'The exit quote is unavailable.')
      } finally { setExitBusy(false) }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [stage, positionSize, percentage, result])

  const reset = () => {
    setStage('input'); setMint(''); setResult(null); setExitResult(null); setError('')
  }
  const status = result?.scan.verification.status ?? 'unverified'
  const critical = status === 'critical'
  const canContinue = Boolean(result?.asset) && !critical

  return (
    <main className="shell">
      <header className="masthead">
        <a className="brand" href="#top" aria-label="StockLens home">Stock<span>Lens</span></a>
        <p>See the asset behind the token.</p>
      </header>

      <section className="workspace" id="top">
        <div className="workspace-heading">
          <p className="eyebrow">Pre-trade safety for tokenized stocks</p>
          <h1>Know what you hold.<br />Know what you can exit.</h1>
          <p className="lede">Verify the issuer, inspect live controls, compare prices, and preview a real USDC exit before you trade.</p>
        </div>
        <StepIndicator stage={stage} />

        <div className="stage" key={stage}>
          {stage === 'input' && (
            <form className="panel input-panel" onSubmit={scan}>
              <div className="panel-kicker">Start with the only identity that matters</div>
              <h2>Paste the Solana mint address</h2>
              <label htmlFor="mint">Token mint</label>
              <div className="input-row">
                <input id="mint" value={mint} onChange={(event) => setMint(event.target.value)} placeholder="Paste a base58 mint address" autoComplete="off" spellCheck={false} required />
                <button className="button primary" disabled={busy || !mint.trim()} type="submit">{busy ? 'Scanning...' : 'Scan mint'}</button>
              </div>
              <p className="helper">No wallet connection required. StockLens reads public on-chain data only.</p>
              <button className="example-link" type="button" onClick={() => setMint(AAPLX_MINT)}>Use verified AAPLx example</button>
              {error && <div className="inline-error" role="alert">{error}</div>}
            </form>
          )}

          {stage === 'verification' && result && (
            <article className={`panel result-panel status-${status}`}>
              <div className="result-header">
                <div>
                  <span className={`status-badge status-${status}`}>{statusCopy[status].label}</span>
                  <h2>{statusCopy[status].title}</h2>
                  <p>{statusCopy[status].body}</p>
                </div>
                <div className="asset-mark"><strong>{result.asset?.symbol ?? 'Unknown'}</strong><span>{result.asset?.issuer ?? 'No verified issuer'}</span></div>
              </div>
              <div className="mint-line"><span>Mint</span><code title={result.scan.mintAddress}>{shortAddress(result.scan.mintAddress)}</code></div>
              <div className="findings" aria-label="Control findings">
                {result.scan.controlFindings.length === 0 ? (
                  <div className="finding finding-empty"><strong>No active issuer controls detected</strong><p>StockLens found no live authority or extension controls to explain.</p></div>
                ) : result.scan.controlFindings.map((finding) => (
                  <div className={`finding finding-${finding.classification}`} key={finding.id}>
                    <div className="finding-topline">
                      <span className="finding-class">{finding.classification === 'expected' ? 'Documented compliance' : finding.classification}</span>
                      <code title={finding.address ?? undefined}>{shortAddress(finding.address)}</code>
                    </div>
                    <strong>{finding.title}</strong><p>{finding.summary}</p>
                  </div>
                ))}
              </div>
              {critical && <div className="critical-callout"><strong>Do not treat this token as the company it claims to represent.</strong><p>An active mint authority can create more supply. Verify the exact mint through the issuer before proceeding.</p></div>}
              <div className="actions">
                <button className="button secondary" type="button" onClick={reset}>Scan another mint</button>
                {canContinue && <button className="button primary" type="button" onClick={() => setStage('price')}>Continue to price radar</button>}
              </div>
            </article>
          )}

          {stage === 'price' && result && (
            <article className="panel price-panel">
              <div className="panel-heading-row">
                <div><p className="panel-kicker">Price Radar</p><h2>Reference price versus executable price</h2></div>
                {result.priceRadar.premiumDiscountPercentage !== null && <div className="difference-chip">{result.priceRadar.premiumDiscountPercentage >= 0 ? '+' : ''}{result.priceRadar.premiumDiscountPercentage.toFixed(2)}%<span>{result.priceRadar.premiumDiscountPercentage >= 0 ? 'premium' : 'discount'}</span></div>}
              </div>
              <div className="price-grid">
                <section className="price-card">
                  <span>Pyth underlying</span>
                  {result.priceRadar.underlying.status === 'available' ? <>
                    <strong>{money(result.priceRadar.underlying.price, 4)}</strong>
                    <dl><div><dt>Feed</dt><dd>{result.priceRadar.underlying.symbol}</dd></div><div><dt>Published</dt><dd>{timestamp(result.priceRadar.underlying.publishTime)}</dd></div><div><dt>Confidence</dt><dd>{result.priceRadar.underlying.confidence === null ? 'Not supplied' : `±${money(result.priceRadar.underlying.confidence, 4)}`}</dd></div></dl>
                  </> : <div className="unavailable-state"><strong>Reference feed unavailable</strong><p>{result.priceRadar.underlying.reason}</p></div>}
                </section>
                <section className="price-card">
                  <span>Jupiter token price</span>
                  {result.priceRadar.token.status === 'available' ? <>
                    <strong>{money(result.priceRadar.token.expectedOutputUsd, 4)}</strong>
                    <dl><div><dt>Quote size</dt><dd>1 {result.asset?.symbol}</dd></div><div><dt>Quoted</dt><dd>{timestamp(result.priceRadar.token.quotedAt)}</dd></div><div><dt>Impact</dt><dd>{result.priceRadar.token.priceImpactPercentage.toFixed(3)}%</dd></div></dl>
                  </> : <div className="unavailable-state"><strong>Token quote unavailable</strong><p>No executable Jupiter route was found for this asset.</p></div>}
                </section>
              </div>
              <p className="data-note">Pyth shows the underlying equity reference when entitled. Jupiter shows what the token can currently route to USDC.</p>
              <div className="actions"><button className="button secondary" type="button" onClick={() => setStage('verification')}>Back</button><button className="button primary" type="button" onClick={() => setStage('exit')}>Preview my exit</button></div>
            </article>
          )}

          {stage === 'exit' && result && (
            <article className="panel exit-panel">
              <div className="panel-heading-row"><div><p className="panel-kicker">Exit Preview</p><h2>What reaches your wallet?</h2></div><span className="live-label">Live Jupiter quote</span></div>
              <label htmlFor="position">Your {result.asset?.symbol} position</label>
              <div className="position-input"><input id="position" inputMode="decimal" value={positionSize} onChange={(event) => setPositionSize(event.target.value)} /><span>{result.asset?.symbol}</span></div>
              <div className="presets" aria-label="Exit percentage">
                {PERCENTAGES.map((value) => <button className={percentage === value ? 'is-selected' : ''} key={value} type="button" onClick={() => setPercentage(value)}>{value}%</button>)}
              </div>
              <p className="helper">Previewing {percentage}% of your position. Quotes refresh after each change.</p>
              {exitBusy ? <div className="quote-loading" aria-live="polite">Finding the best executable route...</div> : exitResult?.preview.status === 'available' ? (
                <div className="exit-numbers">
                  <div><span>Displayed value</span><strong>{exitResult.preview.referenceValueUsd === null ? 'Unavailable' : money(exitResult.preview.referenceValueUsd)}</strong></div>
                  <div><span>Estimated USDC out</span><strong>{money(exitResult.preview.expectedOutputUsd)}</strong></div>
                  <div className="exit-difference"><span>Exit difference</span><strong>{exitResult.preview.referenceValueUsd === null ? 'No reference' : money(exitResult.preview.expectedOutputUsd - exitResult.preview.referenceValueUsd)}</strong><small>{exitResult.preview.executableDifferencePercentage === null ? 'Pyth reference unavailable' : `${exitResult.preview.executableDifferencePercentage >= 0 ? '+' : ''}${exitResult.preview.executableDifferencePercentage.toFixed(2)}% versus displayed value`}</small></div>
                  <dl className="quote-details"><div><dt>Exit amount</dt><dd>{exitResult.exitAmount} {result.asset?.symbol}</dd></div><div><dt>Price impact</dt><dd>{exitResult.preview.priceImpactPercentage.toFixed(3)}%</dd></div><div><dt>Minimum received</dt><dd>{money(exitResult.preview.minimumOutputUsd)}</dd></div></dl>
                </div>
              ) : <div className="unavailable-state exit-unavailable"><strong>Exit quote unavailable</strong><p>Jupiter could not find a route for this position size. Try a smaller amount.</p></div>}
              {error && <div className="inline-error" role="alert">{error}</div>}
              <div className="actions"><button className="button secondary" type="button" onClick={() => setStage('price')}>Back</button><button className="button primary" type="button" onClick={reset}>Scan another mint</button></div>
            </article>
          )}
        </div>
      </section>
      <footer>On-chain controls, Pyth reference data, and Jupiter executable quotes. Always verify the mint.</footer>
    </main>
  )
}

export default App
