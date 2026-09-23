import { HermesClient, type PriceUpdate } from '@pythnetwork/hermes-client'

import type { IssuerRegistryEntry } from '../registry'

const DEFAULT_HERMES_URL = 'https://pyth.dourolabs.app/hermes'
const STALE_AFTER_SECONDS = 60
const US_EQUITY_TIME_ZONE = 'America/New_York'

export interface ConfidenceInterval {
  amount: number
  lower: number
  upper: number
  percentageOfPrice: number | null
}

export interface AvailablePriceFeed {
  status: 'available'
  feedId: string
  price: number
  publishTime: string
  publishTimeUnix: number
  ageSeconds: number
  stale: boolean
  staleWarning: boolean
  stalenessMessage: string
  confidence: ConfidenceInterval
}

export interface UnavailablePriceFeed {
  status: 'unavailable'
  feedId: string
  reason: string
}

export type PriceFeedSnapshot = AvailablePriceFeed | UnavailablePriceFeed

export interface EquityMarketStatus {
  status: 'open' | 'closed'
  timeZone: typeof US_EQUITY_TIME_ZONE
  checkedAt: string
  message: string
}

export interface PriceComparison {
  status: 'available' | 'unavailable'
  symbol: string
  underlyingTicker: string
  underlying: PriceFeedSnapshot
  token: PriceFeedSnapshot
  premiumDiscountPercentage: number | null
  market: EquityMarketStatus
  reason?: string
}

type ParsedPrice = NonNullable<PriceUpdate['parsed']>[number]

function normalizeFeedId(feedId: string): string {
  return feedId.replace(/^0x/i, '').toLowerCase()
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (/401|unauthorized/i.test(message)) {
    return 'Pyth Hermes authentication failed. Set a valid PYTH_API_KEY.'
  }

  if (/403|not entitled/i.test(message)) {
    return 'Pyth API key is valid but not entitled to this feed. Enable the required feed grant in Pyth Terminal.'
  }

  return `Pyth Hermes request failed: ${message}`
}

function environmentVariable(name: string): string | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env?.[name]
}

function easternTimeParts(at: Date): {
  weekday: string
  hour: number
  minute: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: US_EQUITY_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''

  return {
    weekday: part('weekday'),
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  }
}

export function getEquityMarketStatus(at = new Date()): EquityMarketStatus {
  const { weekday, hour, minute } = easternTimeParts(at)
  const weekdaySession = !['Sat', 'Sun'].includes(weekday)
  const minutesAfterMidnight = hour * 60 + minute
  const regularSession = minutesAfterMidnight >= 9 * 60 + 30 && minutesAfterMidnight < 16 * 60
  const open = weekdaySession && regularSession

  return {
    status: open ? 'open' : 'closed',
    timeZone: US_EQUITY_TIME_ZONE,
    checkedAt: at.toISOString(),
    message: open
      ? 'US equity regular session is open.'
      : 'US markets closed — comparing against last close.',
  }
}

function unavailableFeed(feedId: string, reason: string): UnavailablePriceFeed {
  return { status: 'unavailable', feedId, reason }
}

function snapshot(
  feedId: string,
  parsed: ParsedPrice | undefined,
  now: Date,
  market: EquityMarketStatus,
  isEquity: boolean,
): PriceFeedSnapshot {
  if (!parsed) return unavailableFeed(feedId, 'Hermes returned no parsed update for this feed.')

  const price = Number(parsed.price.price) * 10 ** parsed.price.expo
  const confidenceAmount = Number(parsed.price.conf) * 10 ** parsed.price.expo
  const ageSeconds = Math.max(0, Math.floor(now.getTime() / 1000 - parsed.price.publish_time))
  const stale = ageSeconds > STALE_AFTER_SECONDS
  const marketClosedLastClose = isEquity && stale && market.status === 'closed'

  if (!Number.isFinite(price) || !Number.isFinite(confidenceAmount)) {
    return unavailableFeed(feedId, 'Hermes returned a price that could not be parsed.')
  }

  return {
    status: 'available',
    feedId,
    price,
    publishTime: new Date(parsed.price.publish_time * 1000).toISOString(),
    publishTimeUnix: parsed.price.publish_time,
    ageSeconds,
    stale,
    staleWarning: stale && !marketClosedLastClose,
    stalenessMessage: !stale
      ? 'Fresh price update.'
      : marketClosedLastClose
        ? market.message
        : `Price update is older than ${STALE_AFTER_SECONDS} seconds.`,
    confidence: {
      amount: confidenceAmount,
      lower: price - confidenceAmount,
      upper: price + confidenceAmount,
      percentageOfPrice: price === 0 ? null : (confidenceAmount / Math.abs(price)) * 100,
    },
  }
}

async function fetchSnapshot(
  client: HermesClient,
  feedId: string,
  now: Date,
  market: EquityMarketStatus,
  isEquity: boolean,
): Promise<PriceFeedSnapshot> {
  try {
    const response = await client.getLatestPriceUpdates([feedId], {
      parsed: true,
      ignoreInvalidPriceIds: true,
    })
    const parsed = (response.parsed ?? []).find(
      (update) => normalizeFeedId(update.id) === feedId,
    )

    return snapshot(feedId, parsed, now, market, isEquity)
  } catch (error) {
    return unavailableFeed(feedId, errorMessage(error))
  }
}

export async function comparePrices(
  registryEntry: IssuerRegistryEntry,
): Promise<PriceComparison> {
  const now = new Date()
  const market = getEquityMarketStatus(now)
  const equityFeedId = normalizeFeedId(registryEntry.pythEquityFeed)
  const tokenFeedId = normalizeFeedId(registryEntry.pythTokenFeed)

  try {
    const client = new HermesClient(environmentVariable('PYTH_HERMES_URL') ?? DEFAULT_HERMES_URL, {
      accessToken: environmentVariable('PYTH_API_KEY'),
      timeout: 20_000,
      httpRetries: 2,
    })
    const [underlying, token] = await Promise.all([
      fetchSnapshot(client, equityFeedId, now, market, true),
      fetchSnapshot(client, tokenFeedId, now, market, false),
    ])
    const available = underlying.status === 'available' && token.status === 'available'

    return {
      status: available ? 'available' : 'unavailable',
      symbol: registryEntry.symbol,
      underlyingTicker: registryEntry.underlyingTicker,
      underlying,
      token,
      premiumDiscountPercentage: available
        ? ((token.price - underlying.price) / underlying.price) * 100
        : null,
      market,
      reason: available ? undefined : 'One or more required Pyth feeds are unavailable.',
    }
  } catch (error) {
    const reason = errorMessage(error)

    return {
      status: 'unavailable',
      symbol: registryEntry.symbol,
      underlyingTicker: registryEntry.underlyingTicker,
      underlying: unavailableFeed(equityFeedId, reason),
      token: unavailableFeed(tokenFeedId, reason),
      premiumDiscountPercentage: null,
      market,
      reason,
    }
  }
}
