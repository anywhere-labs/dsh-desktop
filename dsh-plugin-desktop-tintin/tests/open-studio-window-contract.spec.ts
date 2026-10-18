// tests/open-studio-window-contract.spec.ts — OpenFilm Studio 窗口地址白名单
// （共享契约：只允许本机 http 的 /open 或 /，防止渲染层拿壳桥开任意窗口）。
import { describe, expect, it } from 'vitest'
import { isStudioWindowUrl } from '../src/open-studio-window-contract.ts'

describe('isStudioWindowUrl', () => {
  it('接受 CLI 打印的本机 Studio 地址', () => {
    expect(isStudioWindowUrl('http://127.0.0.1:4747/open?key=abc&to=%2Fprojects%2F1')).toBe(true)
    expect(isStudioWindowUrl('http://localhost:4747/open?key=abc')).toBe(true)
    expect(isStudioWindowUrl('http://127.0.0.1:5000/')).toBe(true)
    expect(isStudioWindowUrl('http://[::1]:4747/open?key=abc')).toBe(true)
  })

  it('拒绝其他主机、协议与路径', () => {
    expect(isStudioWindowUrl('http://evil.example:4747/open?key=abc')).toBe(false)
    expect(isStudioWindowUrl('https://127.0.0.1:4747/open?key=abc')).toBe(false)
    expect(isStudioWindowUrl('file:///C:/Windows/System32')).toBe(false)
    expect(isStudioWindowUrl('javascript:alert(1)')).toBe(false)
    expect(isStudioWindowUrl('http://127.0.0.1:4747/projects/1')).toBe(false)
    expect(isStudioWindowUrl('')).toBe(false)
    expect(isStudioWindowUrl(null)).toBe(false)
    expect(isStudioWindowUrl(42)).toBe(false)
  })
})
