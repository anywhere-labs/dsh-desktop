/** Client presentation for the Host `/computer-use` command in the `/` trigger menu. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {
  CandidateRequest, ClientSessionContext, InputTriggerCandidate, InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

const COMPUTER_USE_COMMAND_NAME = 'computer-use'

function isOrderedSubsequence(target: string, query: string): boolean {
  if (query.length === 0) return true
  if (query.length > target.length) return false
  let queryIndex = 0
  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target.charAt(index) === query.charAt(queryIndex)) {
      queryIndex += 1
    }
  }
  return queryIndex === query.length
}

export function ComputerUseCommandIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.53 2.43L7.02 4.24" />
      <path d="M12.05 3.88L10.72 5.21" />
      <path d="M2.49 6.45L4.32 6.94" />
      <path d="M3.96 11.97L5.29 10.64" />
      <path d="M7.99 7.9L14.24 9.84L11.14 11.12L9.89 14.15Z" />
    </svg>
  )
}

export function ComputerUsePluginArtwork({ size = 36, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g
        stroke="url(#dsh-next-computer-use-art)"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14.9 7.93L15.73 11.01" />
        <path d="M24.29 10.4L22.02 12.66" />
        <path d="M8.03 14.77L11.14 15.6" />
        <path d="M10.53 24.15L12.79 21.89" />
        <path
          d="M17.38 17.23L28.01 20.53L22.74 22.7L20.61 27.86Z"
          fill="url(#dsh-next-computer-use-art)"
          fillOpacity={0.2}
        />
      </g>
      <defs>
        <linearGradient
          id="dsh-next-computer-use-art"
          x1="8"
          y1="8"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#54ECE7" />
          <stop offset="1" stopColor="#658EFF" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function computerUseCommandCopy(zh: boolean): { label: string; description: string } {
  return zh
    ? { label: '电脑操作', description: '开启或关闭 Computer Use' }
    : { label: 'Computer Use', description: 'Enable or disable Computer Use' }
}

export function enrichComputerUseCandidate(
  candidate: InputTriggerCandidate,
  zh: boolean,
): InputTriggerCandidate {
  if (candidate.name !== COMPUTER_USE_COMMAND_NAME) return candidate
  const copy = computerUseCommandCopy(zh)
  return {
    ...candidate,
    label: copy.label,
    description: copy.description,
    icon: ComputerUseCommandIcon,
  }
}

export function enrichComputerUseCandidates(
  candidates: readonly InputTriggerCandidate[],
  zh: boolean,
): readonly InputTriggerCandidate[] {
  let changed = false
  const next = candidates.map(candidate => {
    const enriched = enrichComputerUseCandidate(candidate, zh)
    if (enriched !== candidate) changed = true
    return enriched
  })
  return changed ? next : candidates
}

export function decorateCommandTriggerSource(
  source: InputTriggerSource,
  isZh: () => boolean,
): () => void {
  if (source.trigger !== '/' || source.name !== 'command') return () => {}
  const target = source as {
    candidates: (session: ClientSessionContext, req: CandidateRequest) => Promise<readonly InputTriggerCandidate[]>
  }
  const originalCandidates = target.candidates.bind(source)
  target.candidates = async (session: ClientSessionContext, req: CandidateRequest) => {
    const zh = isZh()
    const rows = await originalCandidates(session, req)
    const enriched = enrichComputerUseCandidates(rows, zh)
    if (req.query !== '' && !enriched.some(row => row.name === COMPUTER_USE_COMMAND_NAME)) {
      const copy = computerUseCommandCopy(zh)
      const lowerLabel = copy.label.toLowerCase()
      const lowerQuery = req.query.toLowerCase()
      if (isOrderedSubsequence(lowerLabel, lowerQuery)) {
        const allRows = await originalCandidates(session, { ...req, query: '' })
        const rawTarget = allRows.find(row => row.name === COMPUTER_USE_COMMAND_NAME)
        if (rawTarget !== undefined) {
          const { section: _section, ...withoutSection } = rawTarget
          const candidate = enrichComputerUseCandidate(withoutSection, zh)
          return lowerLabel.startsWith(lowerQuery)
            ? [candidate, ...enriched]
            : [...enriched, candidate]
        }
      }
    }
    return enriched
  }
  return () => {
    target.candidates = originalCandidates
  }
}

export function registerComputerUseCommandUi(ctx: Context): void {
  ctx.inject(['inputTriggers', 'locale'], inner => {
    inner.effect(() => {
      const t = inner.locale.bind('desktop-next')
      const isZh = (): boolean => t('language') === 'zh'
      const disposers = new Set<() => void>()
      const decorated = new WeakSet<InputTriggerSource>()

      const attach = (source: InputTriggerSource): void => {
        if (decorated.has(source)) return
        if (source.trigger !== '/' || source.name !== 'command') return
        decorated.add(source)
        const dispose = decorateCommandTriggerSource(source, isZh)
        disposers.add(() => {
          dispose()
          decorated.delete(source)
        })
      }

      const service = inner.inputTriggers as unknown as {
        registerSource: (src: InputTriggerSource) => () => void
        readonly live?: { readonly sources?: readonly InputTriggerSource[] }
      }
      for (const existing of service.live?.sources ?? []) {
        attach(existing)
      }

      const originalRegisterSource = service.registerSource.bind(inner.inputTriggers)
      service.registerSource = (src: InputTriggerSource): (() => void) => {
        attach(src)
        return originalRegisterSource(src)
      }

      return () => {
        service.registerSource = originalRegisterSource
        for (const dispose of disposers) dispose()
        disposers.clear()
      }
    }, 'Decorate /computer-use command trigger row')
  })
}
