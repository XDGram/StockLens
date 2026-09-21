import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getDefaultAccountState,
  getExtensionData,
  getExtensionTypes,
  getGroupMemberPointerState,
  getGroupPointerState,
  getInterestBearingMintConfigState,
  getMetadataPointerState,
  getMintCloseAuthority,
  getNonTransferable,
  getPausableConfig,
  getPermanentDelegate,
  getPermissionedBurn,
  getScaledUiAmountConfig,
  getTokenGroupMemberState,
  getTokenGroupState,
  getTokenMetadata,
  getTransferFeeConfig,
  getTransferHook,
  unpackMint,
  type Mint,
} from '@solana/spl-token'
import { PublicKey, type Connection } from '@solana/web3.js'

import { ISSUER_REGISTRY, REGISTRY_VERSION, lookupMint } from '../registry'
import { classifyControls } from '../scoring/classify'
import type {
  JsonValue,
  MintExtensionResult,
  ScanResult,
} from '../../types'

type ExtensionDecoder = (
  mint: Mint,
  connection: Connection,
  mintAddress: PublicKey,
) => unknown | Promise<unknown>

const extensionDecoders = new Map<ExtensionType, ExtensionDecoder>([
  [ExtensionType.TransferFeeConfig, (mint) => getTransferFeeConfig(mint)],
  [ExtensionType.MintCloseAuthority, (mint) => getMintCloseAuthority(mint)],
  [ExtensionType.DefaultAccountState, (mint) => getDefaultAccountState(mint)],
  [ExtensionType.NonTransferable, (mint) => getNonTransferable(mint)],
  [ExtensionType.InterestBearingConfig, (mint) => getInterestBearingMintConfigState(mint)],
  [ExtensionType.PermanentDelegate, (mint) => getPermanentDelegate(mint)],
  [ExtensionType.TransferHook, (mint) => getTransferHook(mint)],
  [ExtensionType.MetadataPointer, (mint) => getMetadataPointerState(mint)],
  [
    ExtensionType.TokenMetadata,
    (_mint, connection, address) =>
      getTokenMetadata(connection, address, 'confirmed', TOKEN_2022_PROGRAM_ID),
  ],
  [ExtensionType.GroupPointer, (mint) => getGroupPointerState(mint)],
  [ExtensionType.TokenGroup, (mint) => getTokenGroupState(mint)],
  [ExtensionType.GroupMemberPointer, (mint) => getGroupMemberPointerState(mint)],
  [ExtensionType.TokenGroupMember, (mint) => getTokenGroupMemberState(mint)],
  [ExtensionType.ScaledUiAmountConfig, (mint) => getScaledUiAmountConfig(mint)],
  [ExtensionType.PausableConfig, (mint) => getPausableConfig(mint)],
  [ExtensionType.PermissionedBurn, (mint) => getPermissionedBurn(mint)],
])

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value)
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (value instanceof PublicKey) {
    return value.toBase58()
  }

  if (value instanceof Uint8Array) {
    return Array.from(value)
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue)
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toJsonValue(child)]),
    )
  }

  return String(value)
}

function extensionName(type: ExtensionType): string {
  return ExtensionType[type] ?? `UnknownExtension(${type})`
}

async function decodeExtensions(
  mint: Mint,
  connection: Connection,
  mintAddress: PublicKey,
): Promise<MintExtensionResult[]> {
  return Promise.all(
    getExtensionTypes(mint.tlvData).map(async (type) => {
      const decoder = extensionDecoders.get(type)
      const rawData = getExtensionData(type, mint.tlvData)
      const result: MintExtensionResult = {
        type: extensionName(type),
        typeId: type,
        recognized: decoder !== undefined,
        data: null,
        rawDataBase64: rawData?.toString('base64') ?? '',
      }

      if (!decoder) {
        result.decodingError =
          'No decoder is exported for this mint extension by the installed @solana/spl-token version.'
        return result
      }

      try {
        const decoded = await decoder(mint, connection, mintAddress)
        result.data = decoded === null || decoded === undefined ? null : toJsonValue(decoded)

        if (decoded === null || decoded === undefined) {
          result.recognized = false
          result.decodingError = 'The extension was present, but its decoder returned no data.'
        }
      } catch (error) {
        result.recognized = false
        result.decodingError = error instanceof Error ? error.message : String(error)
      }

      return result
    }),
  )
}

export async function scanMint(
  connection: Connection,
  mintAddress: string,
): Promise<ScanResult> {
  const address = new PublicKey(mintAddress)
  const accountInfo = await connection.getAccountInfo(address, 'confirmed')

  if (!accountInfo) {
    throw new Error(`Mint account not found: ${address.toBase58()}`)
  }

  const isToken2022 = accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
  const isLegacy = accountInfo.owner.equals(TOKEN_PROGRAM_ID)

  if (!isToken2022 && !isLegacy) {
    throw new Error(
      `Account ${address.toBase58()} is owned by ${accountInfo.owner.toBase58()}, not an SPL Token program.`,
    )
  }

  const tokenProgram = isToken2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
  const mint = unpackMint(address, accountInfo, tokenProgram)
  const registryEntry = lookupMint(address.toBase58())
  const extensions = isToken2022
    ? await decodeExtensions(mint, connection, address)
    : []
  const now = new Date().toISOString()
  const issuer = registryEntry
    ? {
        issuer: registryEntry.issuer,
        symbol: registryEntry.symbol,
        underlyingTicker: registryEntry.underlyingTicker,
        source: registryEntry.source,
        registryVersion: REGISTRY_VERSION,
        lastVerifiedAt: registryEntry.lastVerifiedAt,
      }
    : null
  const errors = extensions
    .filter((extension) => extension.decodingError !== undefined)
    .map(
      (extension) =>
        `${extension.type}: ${extension.decodingError ?? 'Unknown decoding error'}`,
    )

  const scan: ScanResult = {
    scanId: globalThis.crypto.randomUUID(),
    mintAddress: address.toBase58(),
    cluster: 'mainnet-beta',
    tokenProgram: tokenProgram.toBase58(),
    tokenProgramKind: isToken2022 ? 'token-2022' : 'legacy-spl',
    mint: {
      mintAuthority: mint.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
      supply: mint.supply.toString(),
      decimals: mint.decimals,
      isInitialized: mint.isInitialized,
    },
    extensions,
    issuer,
    scannedAt: now,
    verification: {
      status: registryEntry ? 'verified' : 'unverified',
      mintAddress: address.toBase58(),
      registryVersion: REGISTRY_VERSION,
      registryEntryId: registryEntry?.mint,
      issuer: registryEntry?.issuer,
      symbol: registryEntry?.symbol,
      underlyingSymbol: registryEntry?.underlyingTicker,
      officialSource: registryEntry?.source,
      verifiedAt: now,
    },
    controlFindings: [],
    errors,
  }

  const { findings, verification } = classifyControls(scan)
  return { ...scan, controlFindings: findings, verification }
}

export const REGISTERED_MINT_COUNT = ISSUER_REGISTRY.length
