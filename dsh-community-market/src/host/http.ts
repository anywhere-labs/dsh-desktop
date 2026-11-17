/** JSON responses, bounded request bodies and disconnect handling for the market's Host routes. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MarketCatalogErrorCode } from '../api-types.js'
import { CatalogContractError } from '../contracts/errors.js'
import { CatalogNetworkError } from '../network/restricted-http.js'
import { MarketInstallError } from '../install/service.js'

const MAX_BODY_BYTES = 16 * 1024

export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

export function sendInstallError(res: ServerResponse, cause: unknown): void {
  if (!(cause instanceof MarketInstallError)) {
    sendJson(res, 500, { error: 'market package operation failed', code: 'operation-failed' })
    return
  }
  const status = cause.code === 'invalid-request' ? 400
    : cause.code === 'not-available' ? 404
      : cause.code === 'conflict' ? 409
        : cause.code === 'intent-expired' ? 410
          : cause.code === 'verification-failed' ? 422
            : cause.code === 'operation-failed' ? 502
              : 500
  sendJson(res, status, {
    error: cause.message,
    code: cause.code,
    ...(cause.details === undefined ? {} : { details: cause.details }),
  })
}

export function sendCatalogFailure(res: ServerResponse, cause: unknown): void {
  let code: MarketCatalogErrorCode = 'catalog-unavailable'
  if (cause instanceof CatalogNetworkError && cause.code === 'timeout') code = 'catalog-timeout'
  else if (
    cause instanceof CatalogNetworkError && cause.code === 'response'
    || cause instanceof CatalogContractError
  ) code = 'catalog-invalid-response'
  const status = code === 'catalog-timeout' ? 504 : 502
  const error = code === 'catalog-timeout'
    ? 'catalog request timed out'
    : code === 'catalog-invalid-response'
      ? 'catalog response was invalid'
      : 'catalog source unavailable'
  sendJson(res, status, { error, code })
}

export function abortOnDisconnect(req: IncomingMessage, res: ServerResponse, controller: AbortController): () => void {
  const abort = () => controller.abort()
  const abortIfUnfinished = () => {
    if (!res.writableEnded) controller.abort()
  }
  req.once('aborted', abort)
  res.once('close', abortIfUnfinished)
  return () => {
    req.off('aborted', abort)
    res.off('close', abortIfUnfinished)
  }
}

export function readJson(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const abortReason = () => signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  if (signal.aborted) return Promise.reject(abortReason())
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      req.off('aborted', onRequestAbort)
      signal.removeEventListener('abort', onSignalAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_BODY_BYTES) {
        const cause = new Error('body too large')
        finish(() => {
          req.destroy(cause)
          reject(cause)
        })
        return
      }
      chunks.push(buffer)
    }
    const onEnd = () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        finish(() => resolve(value))
      } catch {
        finish(() => reject(new Error('invalid json')))
      }
    }
    const onError = (cause: Error) => finish(() => reject(cause))
    const onRequestAbort = () => finish(() => reject(new DOMException('The request was aborted', 'AbortError')))
    const onSignalAbort = () => finish(() => reject(abortReason()))
    req.on('data', onData)
    req.once('end', onEnd)
    req.once('error', onError)
    req.once('aborted', onRequestAbort)
    signal.addEventListener('abort', onSignalAbort, { once: true })
  })
}

export async function readOperationJson(req: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  try {
    return await readJson(req, signal)
  } catch (cause) {
    if (signal.aborted) throw cause
    throw new MarketInstallError('invalid-request', 'The package operation request body was invalid.')
  }
}
