/** Where the updater keeps downloaded installers, away from folders a DSH sandbox can label. */
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Windows runs an executable at the lower of its parent's integrity level and the label of its file, which a download
 * takes from its folder. The DSH data directory can be a workspace-write workspace, which upstream labels Low for good,
 * and a Low installer can write neither the installation nor its log. Upstream never lets such a workspace contain
 * the system temporary directory.
 * @param platform - Platform the updater runs on.
 * @returns The download directory, or undefined to download beside the update state.
 */
export function updateDownloadDirectory(platform: string): string | undefined {
  return platform === 'win32' ? join(tmpdir(), 'dsh-plugin-desktop-beta-updates') : undefined
}
