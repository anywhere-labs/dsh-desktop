/** Restricted HTTP clients for the compiled-in catalog adapters. */

import { createCachedCatalogHttpClient, createRestrictedHttpClient } from '../network/restricted-http.js'
import { DSH_1024STORE_HOSTNAME } from '../adapters/dsh-1024store.js'
import { DSHFIND_HOSTNAME } from '../adapters/dshfind.js'

// v2 is paginated, so the reviewed provider no longer needs the old full-body
// exception. Keep a per-page ceiling independent of the complete catalog size.
const MAX_DSH_1024STORE_BODY_BYTES = 2 * 1024 * 1024
const MAX_DSHFIND_BODY_BYTES = 16 * 1024 * 1024

export const dsh1024StoreHttpClient = createCachedCatalogHttpClient(
  createRestrictedHttpClient({
    syntheticProxyHostnames: [DSH_1024STORE_HOSTNAME],
    maxBodyBytes: MAX_DSH_1024STORE_BODY_BYTES,
  }),
)

export const dshfindHttpClient = createCachedCatalogHttpClient(
  createRestrictedHttpClient({
    // This exact hostname is compiled into the reviewed adapter. User-added
    // source hostnames must never inherit this local-proxy exception.
    syntheticProxyHostnames: [DSHFIND_HOSTNAME],
    maxBodyBytes: MAX_DSHFIND_BODY_BYTES,
  }),
)
