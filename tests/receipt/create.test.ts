import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hashReceipt } from '../../src/lib/receipt/create.js'
import type { DecisionReceipt } from '../../src/types/index.js'

const receipt: DecisionReceipt = {
  receiptVersion: '1.0',
  receiptId: 'receipt-1',
  createdAt: '2026-09-24T12:00:00.000Z',
  walletAddress: 'wallet',
  mintAddress: 'mint',
  symbol: 'TSLAx',
  issuer: 'Backed (xStocks)',
  registryVersion: '2026-09-23.1',
  scanId: 'scan-1',
  verification: { status: 'verified', findings: [] },
  conditions: [{ id: 'verified-issuer', label: 'Verified issuer', passed: true }],
  pyth: { status: 'unavailable', feedId: null, reason: 'not configured' },
  jupiterQuote: {
    inputMint: 'mint',
    outputMint: 'usdc',
    inputAmount: '1000000',
    expectedOutputAmount: '2500000',
    minimumOutputAmount: '2487500',
    priceImpactPercent: 0.1,
    slippageBps: 50,
    quotedAt: '2026-09-24T12:00:01.000Z',
  },
  transaction: { signature: 'signature', explorerUrl: 'https://solscan.io/tx/signature' },
  memo: { mode: 'follow-up-transaction' },
}

test('receipt hashing is deterministic and covers the complete receipt body', async () => {
  const first = await hashReceipt(receipt)
  const second = await hashReceipt({ ...receipt })

  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.notEqual(first, await hashReceipt({ ...receipt, symbol: 'AAPLx' }))
})
