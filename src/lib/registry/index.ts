export const REGISTRY_VERSION = '2026-09-22.1'

export interface ExpectedControls {
  permanentDelegate: string | null
  freezeAuthority: string | null
}

export interface IssuerRegistryEntry {
  issuer: 'Backed (xStocks)' | 'Ondo Global Markets'
  mint: string
  symbol: string
  underlyingTicker: string
  source: string
  pythEquityFeed: string
  pythTokenFeed: string
  expectedControls: ExpectedControls
  lastVerifiedAt: string
}

const XSTOCKS_ASSET_API = 'https://api.xstocks.fi/api/v2/public/assets'
const ONDO_TOKEN_LIST =
  'https://www.dropbox.com/scl/fi/qjfxyg748mx0dwi6up86d/EXTERNAL-Ondo-GM-Tokens-Ondo-GM-Tokens.csv?rlkey=n3no1w78wrah3umsl0nr9s77i&st=spdit2q1&dl=1'

const noDocumentedControls: ExpectedControls = {
  permanentDelegate: null,
  freezeAuthority: null,
}

/**
 * Mint provenance (verified 2026-09-22):
 *
 * - Every xStocks mint below was copied from the `Solana` deployment returned
 *   by Backed's official xStocks Assets API for that symbol:
 *   https://api.xstocks.fi/api/v2/public/assets/{symbol}
 * - Every Ondo mint below was copied from the `Solana Deployed Address` column
 *   in Ondo's official "Ondo GM Tokens" CSV, linked from
 *   https://docs.ondo.finance/addresses under "Ondo Stocks".
 * - Pyth feed IDs were copied from the official Pyth symbology endpoint:
 *   https://pyth.dourolabs.app/v1/symbols
 * - Neither issuer source documents permanent-delegate or freeze-authority
 *   addresses for these mints, so those expected values intentionally remain
 *   null. Runtime on-chain findings must therefore be classified as unknown,
 *   not automatically expected or malicious.
 *
 * A token is verified only by an exact, case-sensitive mint match. Symbols and
 * tickers are discovery metadata and must never establish token identity.
 */
export const ISSUER_REGISTRY = [
  {
    issuer: 'Backed (xStocks)',
    mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
    symbol: 'AAPLx',
    underlyingTicker: 'AAPL',
    source: `${XSTOCKS_ASSET_API}/AAPLx`,
    pythEquityFeed: '49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
    pythTokenFeed: '978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    symbol: 'TSLAx',
    underlyingTicker: 'TSLA',
    source: `${XSTOCKS_ASSET_API}/TSLAx`,
    pythEquityFeed: '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
    pythTokenFeed: '47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    symbol: 'NVDAx',
    underlyingTicker: 'NVDA',
    source: `${XSTOCKS_ASSET_API}/NVDAx`,
    pythEquityFeed: 'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
    pythTokenFeed: '4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX',
    symbol: 'MSFTx',
    underlyingTicker: 'MSFT',
    source: `${XSTOCKS_ASSET_API}/MSFTx`,
    pythEquityFeed: 'd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1',
    pythTokenFeed: 'bb723a70af731ab56b9a650eb7e8ac22b7bc07ea77f8670bd1fa9a37bf6df3f5',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg',
    symbol: 'AMZNx',
    underlyingTicker: 'AMZN',
    source: `${XSTOCKS_ASSET_API}/AMZNx`,
    pythEquityFeed: 'b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a',
    pythTokenFeed: '7148fbe6e493ff2580305c92a8d7f8628c9943b11b9b253aebc24863fec290e8',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN',
    symbol: 'GOOGLx',
    underlyingTicker: 'GOOGL',
    source: `${XSTOCKS_ASSET_API}/GOOGLx`,
    pythEquityFeed: '5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6',
    pythTokenFeed: 'b911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu',
    symbol: 'METAx',
    underlyingTicker: 'META',
    source: `${XSTOCKS_ASSET_API}/METAx`,
    pythEquityFeed: '78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe',
    pythTokenFeed: 'bf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Backed (xStocks)',
    mint: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu',
    symbol: 'COINx',
    underlyingTicker: 'COIN',
    source: `${XSTOCKS_ASSET_API}/COINx`,
    pythEquityFeed: 'fee33f2a978bf32dd6b662b65ba8083c6773b494f8401194ec1870c640860245',
    pythTokenFeed: '641435d5dffb5311140b480517c79986d8488d5cf08a11eec53b83ad02cab33f',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Ondo Global Markets',
    mint: '123mYEnRLM2LLYsJW3K6oyYh8uP1fngj732iG638ondo',
    symbol: 'AAPLon',
    underlyingTicker: 'AAPL',
    source: ONDO_TOKEN_LIST,
    pythEquityFeed: '49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688',
    pythTokenFeed: 'e6734de88a83d9d2fb33072adab319004700aefd069653aba30ba9e3cac056f2',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Ondo Global Markets',
    mint: 'KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo',
    symbol: 'TSLAon',
    underlyingTicker: 'TSLA',
    source: ONDO_TOKEN_LIST,
    pythEquityFeed: '16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
    pythTokenFeed: 'c09ef687ed07091c047da444f1499f2da52cdc1c085104643ec565a9eb1af514',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Ondo Global Markets',
    mint: 'gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo',
    symbol: 'NVDAon',
    underlyingTicker: 'NVDA',
    source: ONDO_TOKEN_LIST,
    pythEquityFeed: 'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
    pythTokenFeed: '207ddea2a443d30b7e13a7c88a9e3f106765deb97049afc65a18cede50fffc82',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
  {
    issuer: 'Ondo Global Markets',
    mint: 'FRmH6iRkMr33DLG6zVLR7EM4LojBFAuq6NtFzG6ondo',
    symbol: 'MSFTon',
    underlyingTicker: 'MSFT',
    source: ONDO_TOKEN_LIST,
    pythEquityFeed: 'd0ca23c1cc005e004ccf1db5bf76aeb6a49218f43dac3d4b275e92de12ded4d1',
    pythTokenFeed: '29b228e9fd72bbd306bcca3b10c165d8dba5d535ef8d5aab6c6e4bc18912d150',
    expectedControls: noDocumentedControls,
    lastVerifiedAt: '2026-09-22',
  },
] as const satisfies readonly IssuerRegistryEntry[]

const entriesByMint = new Map<string, (typeof ISSUER_REGISTRY)[number]>(
  ISSUER_REGISTRY.map((entry) => [entry.mint, entry]),
)

export function lookupMint(address: string): (typeof ISSUER_REGISTRY)[number] | undefined {
  return entriesByMint.get(address.trim())
}

export function lookupTicker(ticker: string): readonly (typeof ISSUER_REGISTRY)[number][] {
  const normalizedTicker = ticker.trim().toUpperCase()

  return ISSUER_REGISTRY.filter(
    (entry) =>
      entry.underlyingTicker === normalizedTicker ||
      entry.symbol.toUpperCase() === normalizedTicker,
  )
}
