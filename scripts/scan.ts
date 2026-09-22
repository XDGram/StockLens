import { Connection, clusterApiUrl } from '@solana/web3.js'

import { comparePrices, type PriceComparison } from '../src/lib/pyth/index.js'
import { lookupMint } from '../src/lib/registry/index.js'
import { scanMint } from '../src/lib/solana/inspect.js'

const args = process.argv.slice(2)
const compare = args.includes('--compare')
const mintAddress = args.find((argument) => !argument.startsWith('--'))

function feedRow(
  label: string,
  feed: PriceComparison['underlying'],
): Record<string, string | number | boolean> {
  if (feed.status === 'unavailable') {
    return {
      Feed: label,
      Status: 'unavailable',
      Price: '—',
      Confidence: '—',
      Published: '—',
      'Age (s)': '—',
      Stale: '—',
      Note: feed.reason,
    }
  }

  return {
    Feed: label,
    Status: 'available',
    Price: feed.price,
    Confidence: `±${feed.confidence.amount} (${feed.confidence.lower}–${feed.confidence.upper})`,
    Published: feed.publishTime,
    'Age (s)': feed.ageSeconds,
    Stale: feed.stale,
    Note: feed.stalenessMessage,
  }
}

function printPriceRadar(comparison: PriceComparison): void {
  console.log('\nPrice Radar')
  console.table([
    feedRow(`${comparison.underlyingTicker} underlying`, comparison.underlying),
    feedRow(`${comparison.symbol} token`, comparison.token),
  ])
  console.log(`Market: ${comparison.market.status} — ${comparison.market.message}`)
  console.log(
    `Premium/discount: ${
      comparison.premiumDiscountPercentage === null
        ? 'unavailable'
        : `${comparison.premiumDiscountPercentage.toFixed(4)}%`
    }`,
  )
  if (comparison.reason) console.log(`Status: ${comparison.reason}`)
}

if (!mintAddress) {
  console.error('Usage: npm run scan -- <mint-address> [--compare]')
  process.exitCode = 1
} else {
  const endpoint = process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta')
  const connection = new Connection(endpoint, 'confirmed')

  try {
    const result = await scanMint(connection, mintAddress)
    console.log(JSON.stringify(result, null, 2))

    if (compare) {
      const registryEntry = lookupMint(mintAddress)

      if (!registryEntry) {
        console.log('\nPrice Radar unavailable: mint is not listed in the issuer registry.')
      } else {
        printPriceRadar(await comparePrices(registryEntry))
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
