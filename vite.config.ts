import react from '@vitejs/plugin-react'
import { Connection, clusterApiUrl } from '@solana/web3.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Connect } from 'vite'

import { getExitPreview } from './src/lib/jupiter/exitPreview.js'
import { fetchPythProUnderlying } from './src/lib/pyth/pro.js'
import { lookupMint } from './src/lib/registry/index.js'
import { scanMint } from './src/lib/solana/inspect.js'

interface ScanBody { mint?: string }
interface ExitBody extends ScanBody { positionSize?: string; percentage?: number }

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function publicReason(reason: string): string {
  if (reason.includes('No accessible Pyth Pro feed')) {
    return 'This reference feed is not included in the current Pyth plan.'
  }
  if (reason.includes('PYTH_API_KEY')) return 'The reference feed is not configured.'
  return 'The reference feed is temporarily unavailable.'
}

function amountForPercentage(positionSize: string, percentage: number): string {
  if (!/^\d+(\.\d+)?$/.test(positionSize)) throw new Error('Enter a valid position size.')
  if (![10, 25, 50, 100].includes(percentage)) throw new Error('Choose a valid exit percentage.')
  const result = Number(positionSize) * (percentage / 100)
  if (!Number.isFinite(result) || result <= 0) throw new Error('Position size must be greater than zero.')
  return result.toFixed(9).replace(/\.?0+$/, '')
}

function stockLensApi(): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (request.method !== 'POST' || !request.url?.startsWith('/api/')) {
      next()
      return
    }

    try {
      const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta'), 'confirmed')

      if (request.url === '/api/scan') {
        const { mint = '' } = await readJson<ScanBody>(request)
        const scan = await scanMint(connection, mint.trim())
        const entry = lookupMint(scan.mintAddress)

        if (!entry) {
          sendJson(response, 200, {
            scan,
            asset: null,
            priceRadar: {
              underlying: { status: 'unavailable', feedId: null, symbol: 'Unknown', reason: 'Reference pricing requires a verified registry entry.' },
              token: { status: 'unavailable', inputMint: scan.mintAddress, outputMint: '', inputAmount: '1', reason: 'Exit pricing is withheld for unverified tokens.' },
              premiumDiscountPercentage: null,
            },
          })
          return
        }

        const underlying = await fetchPythProUnderlying(entry)
        const token = await getExitPreview({
          inputMint: entry.mint,
          inputAmount: '1',
          inputDecimals: scan.mint.decimals,
          referencePriceUsd: underlying.status === 'available' ? underlying.price : undefined,
        })

        sendJson(response, 200, {
          scan,
          asset: { issuer: entry.issuer, symbol: entry.symbol, underlyingTicker: entry.underlyingTicker },
          priceRadar: {
            underlying: underlying.status === 'available' ? underlying : { ...underlying, reason: publicReason(underlying.reason) },
            token,
            premiumDiscountPercentage:
              token.status === 'available' && underlying.status === 'available'
                ? ((token.expectedOutputUsd - underlying.price) / underlying.price) * 100
                : null,
          },
        })
        return
      }

      if (request.url === '/api/exit-preview') {
        const { mint = '', positionSize = '', percentage = 100 } = await readJson<ExitBody>(request)
        const entry = lookupMint(mint.trim())
        if (!entry) throw new Error('Exit Preview is available only for registry-verified assets.')

        const [scan, underlying] = await Promise.all([
          scanMint(connection, entry.mint),
          fetchPythProUnderlying(entry),
        ])
        const exitAmount = amountForPercentage(positionSize, percentage)
        const preview = await getExitPreview({
          inputMint: entry.mint,
          inputAmount: exitAmount,
          inputDecimals: scan.mint.decimals,
          referencePriceUsd: underlying.status === 'available' ? underlying.price : undefined,
        })
        sendJson(response, 200, {
          preview,
          exitAmount,
          percentage,
          referencePrice: underlying.status === 'available'
            ? { status: 'available', price: underlying.price }
            : { status: 'unavailable' },
        })
        return
      }

      next()
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'The request could not be completed.' })
    }
  }
}

export default defineConfig(({ mode }) => {
  const serverEnvironment = loadEnv(mode, process.cwd(), ['PYTH_', 'SOLANA_'])
  if (!process.env.PYTH_API_KEY && serverEnvironment.PYTH_API_KEY) process.env.PYTH_API_KEY = serverEnvironment.PYTH_API_KEY
  if (!process.env.PYTH_PRO_URL && serverEnvironment.PYTH_PRO_URL) process.env.PYTH_PRO_URL = serverEnvironment.PYTH_PRO_URL
  if (!process.env.SOLANA_RPC_URL && serverEnvironment.SOLANA_RPC_URL) process.env.SOLANA_RPC_URL = serverEnvironment.SOLANA_RPC_URL
  const api = stockLensApi()

  return {
    plugins: [react(), {
      name: 'stocklens-api',
      configureServer(server) { server.middlewares.use(api) },
      configurePreviewServer(server) { server.middlewares.use(api) },
    }],
  }
})
