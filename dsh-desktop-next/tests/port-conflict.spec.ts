import { expect, it } from 'vitest'
import { portConflict } from '../src/port-conflict.ts'

it('names the address when a listen failure names the port the preferences fix', () => {
  const failure = 'plugin-a (dsh-a): failed: Error: listen EADDRINUSE: address already in use 127.0.0.1:9000\n'
    + 'webserver (@deepseek-ai/dsh-host-webserver): failed: Error: listen EADDRINUSE: address already in use 127.0.0.1:3000\n    at Server.setupListenHandle'
  expect(portConflict(failure, 3000)).toEqual({ address: '127.0.0.1:3000', port: 3000 })
  expect(portConflict('Error: listen EADDRINUSE: address already in use :::8080', 8080)).toEqual({ address: ':::8080', port: 8080 })
})

it('ignores a plugin\'s own port, an automatic Host port and other failures', () => {
  expect(portConflict('plugin-a (dsh-a): failed: Error: listen EADDRINUSE: address already in use 127.0.0.1:9000', 3000)).toBeUndefined()
  expect(portConflict('Error: listen EADDRINUSE: address already in use 127.0.0.1:3000', 0)).toBeUndefined()
  expect(portConflict('listen EADDRINUSE', 3000)).toBeUndefined()
  expect(portConflict('Error: listen EACCES: permission denied 0.0.0.0:80', 80)).toBeUndefined()
  expect(portConflict('', 3000)).toBeUndefined()
})
