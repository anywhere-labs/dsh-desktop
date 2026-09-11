import { describe, expect, it } from 'vitest'
import { registerXinianWorkbench, type XinianWebServer } from '../src/host/routes.js'

describe('昔年工作台静态服务', () => {
  it('注册无尾斜杠重定向和工作台入口', () => {
    const routes: any[] = []; const server: XinianWebServer = { port: 4317, register(route) { routes.push(route); return () => undefined } }
    registerXinianWorkbench(server)
    expect(routes.some(route => route.path === '/xinian-commerce')).toBe(true)
    expect(routes.some(route => route.path === '/xinian-commerce/')).toBe(true)
  })
})
