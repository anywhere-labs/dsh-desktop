/**
 * Official names that differ between the DSH releases Next and Beta follow. Like
 * src/upstream-family.ts, this file is a declared difference between the variants
 * (scripts/verify-desktop-variants.mjs); it stays free of imports because renderer bundles use it.
 */

/** How the official `@deepseek-ai/dsh-experimental-plugin-market-bundle` presents itself in its locale files. */
export const OFFICIAL_PLUGIN_INDEX = {
  title: { zh: '自定义插件索引', en: 'Custom plugin indexes' },
  description: {
    zh: '在插件页添加“发现”标签页，从你添加的插件索引中浏览和安装插件。',
    en: 'Adds a Discover tab to Plugins, where you browse and install plugins from plugin indexes you add.',
  },
} as const

/**
 * The official OAR subagent provider, as its locale files present it. Desktop ships it as an optional bundle whose
 * rows are the README's Codex and Claude Code example, with Claude Code accepting file edits instead of running
 * read-only (`patches/dsh-experimental-subagent-oar@<version>.patch`). Each provider row's configuration page offers
 * these launch choices; the shipped one equals the row the patch declares.
 */
export const OFFICIAL_OAR_SUBAGENTS = {
  bundle: '@deepseek-ai/dsh-experimental-subagent-oar',
  title: { zh: 'OAR 子智能体', en: 'OAR subagents' },
  description: {
    zh: '通过 OAR 向已安装的编程智能体委派任务，并提供 Codex 和 Claude Code 配置。',
    en: 'Delegate tasks to installed coding agents through OAR, with Codex and Claude Code configurations.',
  },
  experimental: true,
  rows: [
    {
      id: 'experimental-subagent-oar-codex',
      tag: 'Codex',
      title: { zh: 'Codex 沙箱', en: 'Codex sandbox' },
      presets: [
        {
          id: 'read-only',
          title: { zh: '只读', en: 'Read only' },
          description: {
            zh: '命令在只读沙箱里运行，不能修改文件。',
            en: 'Runs commands in a read-only sandbox, so it cannot change files.',
          },
          launchArgs: ['-c', 'sandbox_mode="read-only"'],
        },
        {
          id: 'workspace-write',
          title: { zh: '可写工作区', en: 'Workspace write' },
          description: {
            zh: '可以修改任务目录里的文件并在沙箱里运行命令，写不了任务目录以外的位置，默认也不能联网。这是官方示例的配置。',
            en: 'Changes files in the task directory and runs commands in a sandbox that cannot write elsewhere and has no network access by default. This is the official example.',
          },
          launchArgs: ['-c', 'sandbox_mode="workspace-write"'],
          shipped: true,
        },
        {
          id: 'danger-full-access',
          title: { zh: '不限制', en: 'Full access' },
          description: {
            zh: '不使用沙箱，可以运行任何命令、修改任何文件，DSH 的沙箱也不约束它。只在你信任任务时使用。',
            en: 'Runs without a sandbox, so it can run any command and change any file, and the DSH sandbox does not confine it. Use it only for tasks you trust.',
          },
          launchArgs: ['-c', 'sandbox_mode="danger-full-access"'],
          unrestricted: true,
        },
      ],
    },
    {
      id: 'experimental-subagent-oar-claude',
      tag: 'Claude Code',
      title: { zh: 'Claude Code 权限', en: 'Claude Code permissions' },
      presets: [
        {
          id: 'dontAsk',
          title: { zh: '只读', en: 'Read only' },
          description: {
            zh: '可以读文件、运行只读命令；需要确认的操作一律拒绝，除非 Claude Code 自己的设置已预先放行。这是官方示例的配置。',
            en: 'Reads files and runs read-only commands. Anything that would ask for approval is refused unless the Claude Code settings pre-approve it. This is the official example.',
          },
          launchArgs: ['--permission-mode', 'dontAsk', '--permission-prompts', 'none'],
        },
        {
          id: 'acceptEdits',
          title: { zh: '可改文件', en: 'Edit files' },
          description: {
            zh: '还能修改任务目录里的文件，并使用 mkdir、touch、mv、cp 等常见文件命令；其他需要确认的命令仍会被拒绝。',
            en: 'Also changes files in the task directory and uses common file commands such as mkdir, touch, mv and cp. Other commands that would ask for approval are still refused.',
          },
          launchArgs: ['--permission-mode', 'acceptEdits', '--permission-prompts', 'none'],
          shipped: true,
        },
        {
          id: 'auto',
          title: { zh: '自动审核', en: 'Auto review' },
          description: {
            zh: '由 Claude Code 的分类器在每个操作前审核，放行的直接执行，其余拒绝。需要你的 Claude 账号可以使用 auto 模式。',
            en: 'The Claude Code classifier reviews each action before it runs; approved actions run and the rest are refused. Your Claude account must be able to use auto mode.',
          },
          launchArgs: ['--permission-mode', 'auto', '--permission-prompts', 'none'],
        },
        {
          id: 'bypassPermissions',
          title: { zh: '完全放行', en: 'Bypass permissions' },
          description: {
            zh: '跳过权限检查，几乎可以运行任何命令、修改任何文件，DSH 的沙箱也不约束它。只在你信任任务时使用。',
            en: 'Skips permission checks, so it can run almost any command and change almost any file, and the DSH sandbox does not confine it. Use it only for tasks you trust.',
          },
          launchArgs: ['--permission-mode', 'bypassPermissions', '--permission-prompts', 'none'],
          unrestricted: true,
        },
      ],
    },
  ],
} as const
