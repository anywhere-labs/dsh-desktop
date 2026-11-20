import { expect, it } from 'vitest'
import { UpdateDownloadError } from '../../dsh-plugin-desktop/src/update-download.ts'
import { updateDownloadFailure } from '../src/update-failure.ts'

const coded = (code: string, message: string = code) => Object.assign(new Error(message), { code })

it.each([
  ['a full disk', coded('ENOSPC'), 'space'],
  ['a read-only volume', coded('EROFS'), 'permission'],
  ['a folder it may not write', coded('EACCES'), 'permission'],
  ['a file another program holds, behind a failed cleanup', new AggregateError([coded('EBUSY')], 'Failed to download and clean up the update installer.'), 'busy'],
  ['a connection lost before the response', new UpdateDownloadError('network', 'The update installer could not be downloaded.', { cause: new Error('net::ERR_INTERNET_DISCONNECTED') }), 'network'],
  ['a connection reset during the body', new Error('net::ERR_CONNECTION_RESET'), 'network'],
  ['the transport idle timeout', coded('ETIMEDOUT', 'The update download received no data for 60000 ms.'), 'network'],
] as const)('classifies %s', (_description, error, kind) => {
  expect(updateDownloadFailure(error)).toBe(kind)
})

it('prefers a filesystem cause and names nothing it cannot explain', () => {
  expect(updateDownloadFailure(new AggregateError([coded('ETIMEDOUT'), coded('ENOSPC')]))).toBe('space')
  expect(updateDownloadFailure(new UpdateDownloadError('http-status', 'The update download service returned HTTP 503.', { status: 503 }))).toBeUndefined()
  // A redirect the transport refuses is a release-service problem, not the user's connection.
  expect(updateDownloadFailure(new UpdateDownloadError('network', 'The update installer could not be downloaded.', { cause: new Error('Too many update redirects') }))).toBeUndefined()
  expect(updateDownloadFailure('ENOSPC')).toBeUndefined()
})
