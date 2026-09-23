import { REGISTRY_VERSION, lookupMint } from '../registry/index.js'
import type { ExpectedControls } from '../registry/index.js'
import type {
  ControlClassification,
  ControlFinding,
  ControlType,
  JsonValue,
  ScanResult,
  VerificationResult,
} from '../../types/index.js'

interface LiveControl {
  id: string
  type: ControlType
  title: string
  address: string | null
  unknownExplanation: string
  expectedControl?: Exclude<keyof ExpectedControls, 'expectedExtensions'>
  extensionType?: string
}

const authorityKeyPattern =
  /^(authority|delegate|programId|rateAuthority|updateAuthority|closeAuthority|transferFeeConfigAuthority|withdrawWithheldAuthority)$/i
const UNSET_PUBLIC_KEY = '11111111111111111111111111111111'

function asRecord(value: JsonValue | null): Record<string, JsonValue> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
}

function permanentDelegateAddress(scan: ScanResult): string | null {
  const extension = scan.extensions.find(({ type }) => type === 'PermanentDelegate')
  const data = asRecord(extension?.data ?? null)
  return typeof data?.delegate === 'string' ? data.delegate : null
}

function explanationFor(type: string, key: string): string {
  if (type === 'TransferHook' && key === 'programId') {
    return 'An unidentified program runs during every transfer and may block or add conditions to transactions.'
  }

  if (type === 'TransferHook') {
    return 'An unidentified wallet can change the program that runs whenever this token is transferred.'
  }

  if (type === 'PausableConfig') {
    return 'An unidentified wallet can pause minting, transfers, and burns for this token.'
  }

  if (type === 'MetadataPointer' || type === 'TokenMetadata') {
    return 'An unidentified wallet can change token metadata, which may alter what wallets and apps display.'
  }

  if (type === 'TransferFeeConfig') {
    return key === 'withdrawWithheldAuthority'
      ? 'An unidentified wallet can withdraw fees collected from token transfers.'
      : 'An unidentified wallet can change the fees charged when this token moves.'
  }

  if (type === 'ScaledUiAmountConfig') {
    return 'An unidentified wallet can change the multiplier used to display token balances.'
  }

  if (type === 'MintCloseAuthority') {
    return 'An unidentified wallet can close this mint after its supply reaches zero.'
  }

  if (type === 'InterestBearingConfig') {
    return 'An unidentified wallet can change the rate used to calculate this token’s displayed value.'
  }

  if (type === 'PermissionedBurn') {
    return 'An unidentified wallet can authorize restricted token burns.'
  }

  return 'This address can change how the token behaves, but StockLens cannot link it to a verified issuer.'
}

function extensionControls(scan: ScanResult): LiveControl[] {
  return scan.extensions.flatMap<LiveControl>((extension): LiveControl[] => {
    if (extension.type === 'PermanentDelegate') return []

    const data = asRecord(extension.data)
    const authorities = data
      ? Object.entries(data).filter(
          ([key, value]) =>
            authorityKeyPattern.test(key) &&
            typeof value === 'string' &&
            value !== UNSET_PUBLIC_KEY,
        )
      : []

    if (authorities.length === 0) {
      return [
        {
          id: `extension:${extension.type}`,
          type:
            extension.type === 'DefaultAccountState'
              ? 'default-account-state'
              : extension.type === 'NonTransferable'
                ? 'non-transferable'
                : 'other-extension',
          title: extension.type,
          address: null,
          extensionType: extension.type,
          unknownExplanation: extension.recognized
            ? `This token uses the ${extension.type} feature, but StockLens has no verified issuer record explaining why it is enabled.`
            : `This token contains the ${extension.type} extension. The installed decoder cannot interpret it, so its purpose is not verified.`,
        } satisfies LiveControl,
      ]
    }

    return authorities.map(([key, value]) => ({
      id: `extension:${extension.type}:${key}`,
      type:
        extension.type === 'TransferHook'
          ? 'transfer-hook'
          : extension.type === 'TransferFeeConfig'
            ? 'transfer-fee'
            : extension.type === 'PausableConfig'
              ? 'pausable-mint'
              : extension.type === 'ScaledUiAmountConfig'
                ? 'scaled-ui-amount'
                : extension.type === 'TokenMetadata' || extension.type === 'MetadataPointer'
                  ? 'metadata-update-authority'
                  : 'other-extension',
      title: `${extension.type} ${key}`,
      address: value as string,
      expectedControl:
        extension.type === 'MetadataPointer' || extension.type === 'TokenMetadata'
          ? 'metadataAuthority'
          : extension.type === 'PausableConfig'
            ? 'pausableAuthority'
            : extension.type === 'TransferHook'
              ? 'transferHookAuthority'
              : extension.type === 'ScaledUiAmountConfig'
                ? 'scaledUiAmountAuthority'
                : undefined,
      extensionType: extension.type,
      unknownExplanation: explanationFor(extension.type, key),
    }))
  })
}

function collectLiveControls(scan: ScanResult): LiveControl[] {
  const controls: LiveControl[] = []

  if (scan.mint.mintAuthority) {
    controls.push({
      id: 'mint-authority',
      type: 'mint-authority',
      title: 'Mint authority',
      address: scan.mint.mintAuthority,
      expectedControl: 'mintAuthority',
      unknownExplanation:
        'An unidentified wallet can create more of this token, which can dilute existing holders.',
    })
  }

  if (scan.mint.freezeAuthority) {
    controls.push({
      id: 'freeze-authority',
      type: 'freeze-authority',
      title: 'Freeze authority',
      address: scan.mint.freezeAuthority,
      expectedControl: 'freezeAuthority',
      unknownExplanation:
        'An unidentified wallet can freeze holder accounts and prevent those tokens from moving.',
    })
  }

  const delegate = permanentDelegateAddress(scan)
  if (delegate) {
    controls.push({
      id: 'permanent-delegate',
      type: 'permanent-delegate',
      title: 'Permanent delegate',
      address: delegate,
      expectedControl: 'permanentDelegate',
      unknownExplanation:
        'An unidentified wallet can transfer or burn tokens from holder accounts.',
    })
  }

  return [...controls, ...extensionControls(scan)]
}

function classificationFor(
  control: LiveControl,
  registryEntry: ReturnType<typeof lookupMint>,
): ControlClassification {
  if (!registryEntry) return 'unknown'

  // Only controls with an explicit registry slot can be compared safely.
  // Other Token-2022 controls stay visible as unknown instead of becoming a
  // false mismatch merely because the registry has not modeled them yet.
  if (!control.expectedControl) {
    return control.extensionType &&
      registryEntry.expectedControls.expectedExtensions.includes(control.extensionType)
      ? 'expected'
      : 'unknown'
  }

  const expectedAddress = registryEntry.expectedControls[control.expectedControl]

  return expectedAddress === control.address ? 'expected' : 'unexpected'
}

function explanationForClassification(
  control: LiveControl,
  classification: ControlClassification,
  registryEntry: ReturnType<typeof lookupMint>,
): string {
  if (classification === 'unknown') {
    return registryEntry
      ? `${registryEntry.issuer} is verified for this mint, but the registry does not yet document ${control.title} as an expected control. Review the live control before relying on it.`
      : control.unknownExplanation
  }

  if (classification === 'expected') {
    const documentation = registryEntry?.controlDocumentation
    return `${registryEntry?.issuer ?? 'The verified issuer'} retains this authority for documented compliance operations. ${documentation?.note ?? ''}`.trim()
  }

  if (!control.expectedControl) {
    return `${registryEntry?.issuer ?? 'The verified issuer'} is verified for this mint, but its registry entry does not list ${control.title} as an expected control. Confirm why it is active before using this token.`
  }

  if (registryEntry?.expectedControls[control.expectedControl] === null) {
    return `${control.title} is active even though the registry expects no holder for this control. Confirm the change with ${registryEntry.issuer} before using this token.`
  }

  return `${control.title} does not match the address documented for ${registryEntry?.issuer ?? 'the verified issuer'}. Confirm the change with the issuer before using this token.`
}

export function classifyControls(
  scan: ScanResult,
): { findings: ControlFinding[]; verification: VerificationResult } {
  const registryEntry = lookupMint(scan.mintAddress)
  const controls = collectLiveControls(scan)
  const findings = controls.map((control) => {
    const classification = classificationFor(control, registryEntry)

    return {
      id: control.id,
      type: control.type,
      address: control.address,
      classification,
      severity:
        classification === 'unexpected'
          ? 'warning'
          : classification === 'unknown' &&
              (control.type === 'mint-authority' || control.type === 'permanent-delegate')
            ? 'critical'
            : 'info',
      title: control.title,
      summary: explanationForClassification(control, classification, registryEntry),
      observedAuthority: control.address,
      expectedAuthority: control.expectedControl
        ? (registryEntry?.expectedControls[control.expectedControl] ?? null)
        : undefined,
      evidence: [
        {
          source: 'onchain',
          label: control.title,
          value: control.address ?? undefined,
          reference: scan.mintAddress,
          observedAt: scan.scannedAt,
        },
      ],
    } satisfies ControlFinding
  })
  const hasUnexpectedControls = findings.some(
    ({ classification }) => classification === 'unexpected',
  )
  const hasSourcedWrapperMatch =
    !registryEntry &&
    scan.verification.status === 'known-wrapper' &&
    Boolean(scan.verification.officialSource)
  const hasCriticalUnknownControl =
    !registryEntry &&
    (scan.mint.mintAuthority !== null || permanentDelegateAddress(scan) !== null)
  const status = registryEntry
    ? hasUnexpectedControls
      ? 'known-wrapper'
      : 'verified'
    : hasSourcedWrapperMatch
      ? 'known-wrapper'
      : hasCriticalUnknownControl
        ? 'critical'
        : 'unverified'

  return {
    findings,
    verification: {
      status,
      mintAddress: scan.mintAddress,
      registryVersion: REGISTRY_VERSION,
      registryEntryId: registryEntry?.mint,
      issuer: registryEntry?.issuer ?? scan.verification.issuer,
      symbol: registryEntry?.symbol ?? scan.verification.symbol,
      underlyingSymbol:
        registryEntry?.underlyingTicker ?? scan.verification.underlyingSymbol,
      officialSource: registryEntry?.source ?? scan.verification.officialSource,
      verifiedAt: scan.scannedAt,
    },
  }
}
