export type SolanaCluster = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'

export type ControlClassification = 'expected' | 'unexpected' | 'unknown'

export type VerificationStatus =
  | 'verified'
  | 'known-wrapper'
  | 'unverified'
  | 'critical'

export type FindingSeverity = 'info' | 'warning' | 'critical'

export type ControlType =
  | 'mint-authority'
  | 'freeze-authority'
  | 'metadata-update-authority'
  | 'permanent-delegate'
  | 'transfer-hook'
  | 'transfer-fee'
  | 'default-account-state'
  | 'pausable-mint'
  | 'non-transferable'
  | 'scaled-ui-amount'
  | 'other-extension'

export interface FindingEvidence {
  source: 'onchain' | 'registry' | 'issuer' | 'simulation'
  label: string
  value?: string
  reference?: string
  observedAt?: string
}

export interface ControlFinding {
  id: string
  type: ControlType
  classification: ControlClassification
  severity: FindingSeverity
  title: string
  summary: string
  observedAuthority?: string | null
  expectedAuthority?: string | null
  evidence: FindingEvidence[]
}

export interface VerificationResult {
  status: VerificationStatus
  mintAddress: string
  registryVersion: string
  registryEntryId?: string
  issuer?: string
  symbol?: string
  underlyingSymbol?: string
  officialSource?: string
  verifiedAt: string
}

export interface ScanResult {
  scanId: string
  mintAddress: string
  cluster: SolanaCluster
  tokenProgram: string
  scannedAt: string
  verification: VerificationResult
  controlFindings: ControlFinding[]
  errors: string[]
}

export interface DecisionCondition {
  id: string
  label: string
  passed: boolean
  observedValue?: string
  requiredValue?: string
}

export interface DecisionReceipt {
  receiptVersion: string
  receiptId: string
  createdAt: string
  walletAddress: string
  mintAddress: string
  registryVersion: string
  scanId: string
  verificationStatus: VerificationStatus
  controlFindingIds: string[]
  conditions: DecisionCondition[]
  pyth?: {
    equityFeedId: string
    tokenFeedId?: string
    equityPrice: string
    tokenPrice?: string
    publishTime: string
    confidence?: string
  }
  jupiterQuote?: {
    inputMint: string
    outputMint: string
    inputAmount: string
    expectedOutputAmount: string
    minimumOutputAmount?: string
    priceImpactPercent?: string
  }
  transactionSignature?: string
  memoSignature?: string
  receiptHash?: string
}
