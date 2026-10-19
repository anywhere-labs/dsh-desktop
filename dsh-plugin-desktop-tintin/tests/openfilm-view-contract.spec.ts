// tests/openfilm-view-contract.spec.ts — 原生 Studio 视图地址/边界校验
import { describe, expect, it } from 'vitest'
import { isOpenFilmBounds, isOpenFilmStudioUrl } from '../src/openfilm-view-contract.ts'

describe('isOpenFilmStudioUrl', () => {
  it('接受本机 Studio 地址', () => {
    expect(isOpenFilmStudioUrl('http://127.0.0.1:4788/open?key=abc')).toBe(true)
    expect(isOpenFilmStudioUrl('http://localhost:4788/')).toBe(true)
    expect(isOpenFilmStudioUrl('http://[::1]:4788/open?key=abc')).toBe(true)
  })

  it('拒绝其他主机/协议/路径', () => {
    expect(isOpenFilmStudioUrl('http://evil.example:4788/open')).toBe(false)
    expect(isOpenFilmStudioUrl('https://127.0.0.1:4788/open')).toBe(false)
    expect(isOpenFilmStudioUrl('file:///C:/Windows')).toBe(false)
    expect(isOpenFilmStudioUrl('http://127.0.0.1:4788/projects/1')).toBe(false)
    expect(isOpenFilmStudioUrl('')).toBe(false)
    expect(isOpenFilmStudioUrl(null)).toBe(false)
  })
})

describe('isOpenFilmBounds', () => {
  it('接受整数边界，拒绝畸形值', () => {
    expect(isOpenFilmBounds({ x: 0, y: 0, width: 1000, height: 800 })).toBe(true)
    expect(isOpenFilmBounds({ x: 0, y: 0, width: Number.NaN, height: 800 })).toBe(false)
    expect(isOpenFilmBounds({ x: '0', y: 0, width: 10, height: 10 })).toBe(false)
    expect(isOpenFilmBounds(null)).toBe(false)
  })
})
