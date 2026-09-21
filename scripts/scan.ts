import { Connection, clusterApiUrl } from '@solana/web3.js'

import { scanMint } from '../src/lib/solana/inspect.js'

const mintAddress = process.argv[2]

if (!mintAddress) {
  console.error('Usage: npm run scan -- <mint-address>')
  process.exitCode = 1
} else {
  const endpoint = process.env.SOLANA_RPC_URL ?? clusterApiUrl('mainnet-beta')
  const connection = new Connection(endpoint, 'confirmed')

  try {
    const result = await scanMint(connection, mintAddress)
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
