import { Connection, clusterApiUrl } from '@solana/web3.js'

import { getExitPreview } from '../src/lib/jupiter/index.js'
import { fetchPythProUnderlying } from '../src/lib/pyth/index.js'
import { lookupMint } from '../src/lib/registry/index.js'
import { scanMint } from '../src/lib/solana/index.js'

const [mintAddress, amount = '1'] = process.argv.slice(2)

if (!mintAddress) {
  console.error('Usage: npm run exit-preview -- <mint-address> [token-amount]')
  process.exitCode = 1
} else {
  const registryEntry = lookupMint(mintAddress)

  if (!registryEntry) {
    console.error('Exit Preview requires a mint listed in the verified issuer registry.')
    process.exitCode = 1
  } else {
    const connection = new Connection(
      process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta'),
      'confirmed',
    )
    const [scan, pyth] = await Promise.all([
      scanMint(connection, mintAddress),
      fetchPythProUnderlying(registryEntry),
    ])
    const preview = await getExitPreview({
      inputMint: mintAddress,
      inputAmount: amount,
      inputDecimals: scan.mint.decimals,
      referencePriceUsd: pyth.status === 'available' ? pyth.price : undefined,
    })

    console.log('\nStockLens Exit Preview')
    console.table([
      {
        Asset: `${registryEntry.symbol} → USDC`,
        Verification: scan.verification.status,
        'Pyth underlying': pyth.status === 'available' ? `$${pyth.price.toFixed(5)}` : 'Unavailable',
        'Market session': pyth.status === 'available' ? pyth.marketSession : '—',
        'Jupiter exit': preview.status === 'available' ? `$${preview.expectedOutputUsd.toFixed(6)}` : 'Unavailable',
        'Minimum received': preview.status === 'available' ? `$${preview.minimumOutputUsd.toFixed(6)}` : '—',
        'Vs underlying':
          preview.status === 'available' && preview.executableDifferencePercentage !== null
            ? `${preview.executableDifferencePercentage.toFixed(4)}%`
            : '—',
        Route: preview.status === 'available' ? preview.routeLabels.join(' → ') : '—',
      },
    ])

    if (pyth.status === 'unavailable') console.log(`Pyth: ${pyth.reason}`)
    if (preview.status === 'unavailable') console.log(`Jupiter: ${preview.reason}`)
  }
}
