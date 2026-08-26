async (page) => {
  return page.evaluate(async () => {
    const call = async (method, payload) => {
      const rpcId = crypto.randomUUID()
      const response = await fetch(`/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      })
      return { status: response.status, body: await response.json() }
    }

    return {
      setting: await call('settings.update', {
        ns: 'llm-deepseek',
        patch: { baseURL: 'http://127.0.0.1:51711' },
      }),
      credential: await call('credentials.set', {
        ref: 'DEEPSEEK_API_KEY',
        value: 'issue-641-local-mock',
      }),
    }
  })
}
