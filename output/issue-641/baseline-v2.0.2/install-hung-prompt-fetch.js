async (page) => {
  return page.evaluate(() => {
    const original = globalThis.fetch.bind(globalThis)
    let intercepted = false
    globalThis.fetch = async (input, init) => {
      const response = await original(input, init)
      const url = input instanceof Request ? input.url : String(input)
      if (!intercepted && new URL(url, location.origin).pathname === '/api/session.prompt') {
        intercepted = true
        globalThis.__issue641HungPrompt = {
          responseReceivedAt: Date.now(),
          status: response.status,
          signal: init?.signal,
        }
        return new Promise(() => {})
      }
      return response
    }
    return { installed: true }
  })
}
