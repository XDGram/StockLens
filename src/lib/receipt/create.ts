import type { DecisionReceipt, DecisionReceiptEnvelope } from '../../types/index.js'

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

export async function hashReceipt(receipt: DecisionReceipt): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(receipt))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function createReceiptEnvelope(receipt: DecisionReceipt): Promise<DecisionReceiptEnvelope> {
  return { receipt, receiptHash: await hashReceipt(receipt) }
}

export function downloadReceipt(envelope: DecisionReceiptEnvelope): void {
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `stocklens-receipt-${envelope.receipt.transaction.signature.slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
