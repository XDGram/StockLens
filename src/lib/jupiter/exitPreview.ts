import { createJupiterApiClient } from '@jup-ag/api'

export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

export interface ExitPreviewRequest {
  inputMint: string
  inputAmount: string
  inputDecimals: number
  referencePriceUsd?: number
  slippageBps?: number
}

export interface AvailableExitPreview {
  status: 'available'
  inputMint: string
  outputMint: typeof USDC_MINT
  inputAmount: string
  inputAmountRaw: string
  expectedOutputUsd: number
  minimumOutputUsd: number
  referenceValueUsd: number | null
  executableDifferencePercentage: number | null
  priceImpactPercentage: number
  slippageBps: number
  routeLabels: string[]
  quotedAt: string
}

export interface UnavailableExitPreview {
  status: 'unavailable'
  inputMint: string
  outputMint: typeof USDC_MINT
  inputAmount: string
  reason: string
}

export type ExitPreview = AvailableExitPreview | UnavailableExitPreview

export function toRawAmount(amount: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(amount)) throw new Error('Amount must be a positive number.')

  const [whole, fraction = ''] = amount.split('.')
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimals.`)

  const raw = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  if (BigInt(raw) <= 0n) throw new Error('Amount must be greater than zero.')
  return raw
}

export async function getExitPreview(request: ExitPreviewRequest): Promise<ExitPreview> {
  const slippageBps = request.slippageBps ?? 50

  try {
    const inputAmountRaw = toRawAmount(request.inputAmount, request.inputDecimals)
    const rawAsNumber = Number(inputAmountRaw)
    if (!Number.isSafeInteger(rawAsNumber)) throw new Error('Amount is too large to quote safely.')

    const api = createJupiterApiClient()
    const quote = await api.quoteGet({
      inputMint: request.inputMint,
      outputMint: USDC_MINT,
      amount: rawAsNumber,
      slippageBps,
      restrictIntermediateTokens: true,
    })
    const expectedOutputUsd = Number(quote.outAmount) / 1_000_000
    const minimumOutputUsd = Number(quote.otherAmountThreshold) / 1_000_000
    const referenceValueUsd =
      request.referencePriceUsd === undefined
        ? null
        : Number(request.inputAmount) * request.referencePriceUsd

    return {
      status: 'available',
      inputMint: request.inputMint,
      outputMint: USDC_MINT,
      inputAmount: request.inputAmount,
      inputAmountRaw,
      expectedOutputUsd,
      minimumOutputUsd,
      referenceValueUsd,
      executableDifferencePercentage:
        referenceValueUsd === null || referenceValueUsd === 0
          ? null
          : ((expectedOutputUsd - referenceValueUsd) / referenceValueUsd) * 100,
      priceImpactPercentage: Number(quote.priceImpactPct),
      slippageBps,
      routeLabels: quote.routePlan
        .map((step) => step.swapInfo.label)
        .filter((label): label is string => Boolean(label)),
      quotedAt: new Date().toISOString(),
    }
  } catch (error) {
    return {
      status: 'unavailable',
      inputMint: request.inputMint,
      outputMint: USDC_MINT,
      inputAmount: request.inputAmount,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
