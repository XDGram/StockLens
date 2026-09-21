import assert from 'node:assert/strict'

import { PublicKey } from '@solana/web3.js'

import {
  ISSUER_REGISTRY,
  lookupMint,
  lookupTicker,
} from '../src/lib/registry/index.js'

assert.equal(ISSUER_REGISTRY.length, 12)
assert.equal(new Set(ISSUER_REGISTRY.map(({ mint }) => mint)).size, 12)

for (const entry of ISSUER_REGISTRY) {
  assert.equal(new PublicKey(entry.mint).toBase58(), entry.mint)
  assert.match(entry.pythEquityFeed, /^[0-9a-f]{64}$/)
  assert.match(entry.pythTokenFeed, /^[0-9a-f]{64}$/)
  assert.equal(lookupMint(entry.mint), entry)
}

assert.equal(lookupMint('not-a-mint'), undefined)
assert.equal(lookupTicker('aapl').length, 2)
assert.equal(lookupTicker('AAPLx')[0]?.symbol, 'AAPLx')
assert.equal(lookupTicker('unknown').length, 0)

console.log(`Registry smoke test passed (${ISSUER_REGISTRY.length} verified mints).`)
