import { REGISTRY_VERSION } from '../src/lib/registry/index.js'
import type { VerificationResult } from '../src/types/index.js'

const result: VerificationResult = {
  status: 'unverified',
  mintAddress: '11111111111111111111111111111111',
  registryVersion: REGISTRY_VERSION,
  verifiedAt: new Date(0).toISOString(),
}

console.log(JSON.stringify(result, null, 2))
