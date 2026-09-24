import { createJupiterApiClient } from '@jup-ag/api'

import { toRawAmount, USDC_MINT } from './exitPreview.js'

export interface BuildSwapRequest {
  inputMint: string
  inputAmount: string
  inputDecimals: number
  userPublicKey: string
  slippageBps: number
}

export interface BuiltSwap {
  swapTransaction: string
  lastValidBlockHeight: number
  quote: {
    inputMint: string
    outputMint: string
    inputAmount: string
    inputAmountRaw: string
    expectedOutputAmount: string
    expectedOutputUsd: number
    minimumOutputAmount: string
    minimumOutputUsd: number
    priceImpactPercentage: number
    slippageBps: number
    routeLabels: string[]
    quotedAt: string
  }
}

export async function buildSwap(request: BuildSwapRequest): Promise<BuiltSwap> {
  const inputAmountRaw = toRawAmount(request.inputAmount, request.inputDecimals)
  const amount = Number(inputAmountRaw)
  if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large to execute safely.')

  const api = createJupiterApiClient()
  const quote = await api.quoteGet({
    inputMint: request.inputMint,
    outputMint: USDC_MINT,
    amount,
    slippageBps: request.slippageBps,
    restrictIntermediateTokens: true,
  })

  const swap = await api.swapPost({
    swapRequest: {
      userPublicKey: request.userPublicKey,
      quoteResponse: quote,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: 'veryHigh',
          maxLamports: 1_000_000,
        },
      },
    },
  })

  return {
    swapTransaction: swap.swapTransaction,
    lastValidBlockHeight: swap.lastValidBlockHeight,
    quote: {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputAmount: request.inputAmount,
      inputAmountRaw,
      expectedOutputAmount: quote.outAmount,
      expectedOutputUsd: Number(quote.outAmount) / 1_000_000,
      minimumOutputAmount: quote.otherAmountThreshold,
      minimumOutputUsd: Number(quote.otherAmountThreshold) / 1_000_000,
      priceImpactPercentage: Number(quote.priceImpactPct),
      slippageBps: quote.slippageBps,
      routeLabels: quote.routePlan
        .map((step) => step.swapInfo.label)
        .filter((label): label is string => Boolean(label)),
      quotedAt: new Date().toISOString(),
    },
  }
}
