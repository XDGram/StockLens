import type { IssuerRegistryEntry } from '../registry/index.js'

const DEFAULT_PYTH_PRO_URL = 'https://pyth-lazer.dourolabs.app'
const STALE_AFTER_SECONDS = 60

interface PythProFeed {
  priceFeedId: number
  price?: string
  confidence?: number | string
  exponent: number
  marketSession?: string
  feedUpdateTimestamp: number | string
  publisherCount?: number
}

interface PythProResponse {
  parsed?: {
    timestampUs: string
    priceFeeds: PythProFeed[]
  }
}

export interface AvailablePythProPrice {
  status: 'available'
  feedId: number
  symbol: string
  price: number
  confidence: number | null
  publishTime: string
  publishTimeUnix: number
  ageSeconds: number
  stale: boolean
  marketSession: string
  publisherCount: number | null
}

export interface UnavailablePythProPrice {
  status: 'unavailable'
  feedId: number | null
  symbol: string
  reason: string
}

export type PythProPrice = AvailablePythProPrice | UnavailablePythProPrice

function environmentVariable(name: string): string | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env?.[name]
}

function unavailable(
  entry: IssuerRegistryEntry,
  reason: string,
): UnavailablePythProPrice {
  return {
    status: 'unavailable',
    feedId: entry.pythProEquityFeedId ?? null,
    symbol: `Equity.US.${entry.underlyingTicker}/USD`,
    reason,
  }
}

export async function fetchPythProUnderlying(
  entry: IssuerRegistryEntry,
): Promise<PythProPrice> {
  const feedId = entry.pythProEquityFeedId
  const apiKey = environmentVariable('PYTH_API_KEY')

  if (!feedId) return unavailable(entry, 'No accessible Pyth Pro feed is configured for this asset.')
  if (!apiKey) return unavailable(entry, 'PYTH_API_KEY is not configured.')

  try {
    const response = await fetch(
      `${environmentVariable('PYTH_PRO_URL') ?? DEFAULT_PYTH_PRO_URL}/v1/latest_price`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceFeedIds: [feedId],
          properties: [
            'price',
            'confidence',
            'exponent',
            'marketSession',
            'feedUpdateTimestamp',
            'publisherCount',
          ],
          formats: ['leUnsigned'],
          channel: 'fixed_rate@1000ms',
        }),
        signal: AbortSignal.timeout(20_000),
      },
    )

    if (!response.ok) {
      const detail = await response.text()
      return unavailable(entry, `Pyth Pro returned ${response.status}: ${detail}`)
    }

    const body = (await response.json()) as PythProResponse
    const feed = body.parsed?.priceFeeds.find((candidate) => candidate.priceFeedId === feedId)

    if (!feed?.price) return unavailable(entry, 'Pyth Pro returned no current price.')

    const price = Number(feed.price) * 10 ** feed.exponent
    const confidence =
      feed.confidence === undefined ? null : Number(feed.confidence) * 10 ** feed.exponent
    const publishTimeUnix = Math.floor(Number(feed.feedUpdateTimestamp) / 1_000_000)
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000 - publishTimeUnix))

    if (!Number.isFinite(price) || !Number.isFinite(publishTimeUnix)) {
      return unavailable(entry, 'Pyth Pro returned a price that could not be parsed.')
    }

    return {
      status: 'available',
      feedId,
      symbol: `Equity.US.${entry.underlyingTicker}/USD`,
      price,
      confidence,
      publishTime: new Date(publishTimeUnix * 1000).toISOString(),
      publishTimeUnix,
      ageSeconds,
      stale: ageSeconds > STALE_AFTER_SECONDS,
      marketSession: feed.marketSession ?? 'unknown',
      publisherCount: feed.publisherCount ?? null,
    }
  } catch (error) {
    return unavailable(
      entry,
      `Pyth Pro request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
