import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyControls } from '../../src/lib/scoring/classify.js'
import { ISSUER_REGISTRY, REGISTRY_VERSION } from '../../src/lib/registry/index.js'
import type { MintExtensionResult, ScanResult, VerificationStatus } from '../../src/types/index.js'

const registeredMint = ISSUER_REGISTRY[0]

function fixture(
  overrides: {
    mintAddress?: string
    mintAuthority?: string | null
    freezeAuthority?: string | null
    extensions?: MintExtensionResult[]
    priorStatus?: VerificationStatus
    officialSource?: string
  } = {},
): ScanResult {
  const mintAddress = overrides.mintAddress ?? registeredMint.mint

  return {
    scanId: 'fixture-scan',
    mintAddress,
    cluster: 'mainnet-beta',
    tokenProgram: 'TokenProgramFixture',
    tokenProgramKind: 'token-2022',
    mint: {
      mintAuthority: overrides.mintAuthority ?? null,
      freezeAuthority: overrides.freezeAuthority ?? null,
      supply: '1000000',
      decimals: 6,
      isInitialized: true,
    },
    extensions: overrides.extensions ?? [],
    issuer: null,
    scannedAt: '2026-09-22T00:00:00.000Z',
    verification: {
      status: overrides.priorStatus ?? 'unverified',
      mintAddress,
      registryVersion: REGISTRY_VERSION,
      officialSource: overrides.officialSource,
      verifiedAt: '2026-09-22T00:00:00.000Z',
    },
    controlFindings: [],
    errors: [],
  }
}

test('verified: live registry controls match documented xStocks authorities', () => {
  const result = classifyControls(
    fixture({
      freezeAuthority: registeredMint.expectedControls.freezeAuthority,
      extensions: [
        {
          type: 'PermanentDelegate',
          typeId: 12,
          recognized: true,
          data: { delegate: registeredMint.expectedControls.permanentDelegate },
          rawDataBase64: 'fixture',
        },
        {
          type: 'DefaultAccountState',
          typeId: 6,
          recognized: true,
          data: { state: 1 },
          rawDataBase64: 'AQ==',
        },
      ],
    }),
  )

  assert.equal(result.verification.status, 'verified')
  assert.equal(result.verification.issuer, registeredMint.issuer)
  assert.equal(result.findings.length, 3)
  assert.deepEqual(
    result.findings.slice(0, 2).map(({ classification }) => classification),
    ['expected', 'expected'],
  )
  assert.match(result.findings[0]?.summary ?? '', /documented compliance operations/i)
  assert.match(result.findings[0]?.summary ?? '', /KYC\/AML/i)
  assert.equal(result.findings[2]?.classification, 'unknown')
})

test('known-wrapper: sourced mint match with a control mismatch', () => {
  const result = classifyControls(
    fixture({ freezeAuthority: 'UnexpectedFreezeAuthority1111111111111111111' }),
  )

  assert.equal(result.verification.status, 'known-wrapper')
  assert.equal(result.findings[0]?.classification, 'unexpected')
  assert.equal(result.findings[0]?.address, 'UnexpectedFreezeAuthority1111111111111111111')
  assert.match(result.findings[0]?.summary ?? '', /does not match/i)
})

test('unverified: unknown mint controls stay graded as unknown', () => {
  const result = classifyControls(
    fixture({
      mintAddress: 'UnknownMint111111111111111111111111111111111',
      extensions: [
        {
          type: 'DefaultAccountState',
          typeId: 6,
          recognized: true,
          data: { state: 1 },
          rawDataBase64: 'AQ==',
        },
      ],
    }),
  )

  assert.equal(result.verification.status, 'unverified')
  assert.equal(result.findings[0]?.classification, 'unknown')
  assert.match(result.findings[0]?.summary ?? '', /no verified issuer record/i)
})

test('critical: unknown mint with a permanent delegate', () => {
  const result = classifyControls(
    fixture({
      mintAddress: 'UnknownMint222222222222222222222222222222222',
      extensions: [
        {
          type: 'PermanentDelegate',
          typeId: 12,
          recognized: true,
          data: { delegate: 'UnknownDelegate11111111111111111111111111111' },
          rawDataBase64: 'fixture',
        },
      ],
    }),
  )

  assert.equal(result.verification.status, 'critical')
  assert.equal(result.findings[0]?.classification, 'unknown')
  assert.equal(result.findings[0]?.type, 'permanent-delegate')
  assert.match(result.findings[0]?.summary ?? '', /transfer or burn tokens/i)
})
