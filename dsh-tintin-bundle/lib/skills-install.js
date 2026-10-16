// skills-install — 客户端技能包安装（2026-10-16 用户裁决：安装升级=芯片注册+真技能包落盘一体）。
// GET <server>/skills/{id}/download → 存 <DSH_HOME>/skills/<id>.zip → PowerShell
// Expand-Archive 解压到 <DSH_HOME>/skills/<id>/（rank400 用户级装位；重装=清目录覆盖）。
// Windows 通道专用（TinTin 发行面即 Windows）。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function installSkillPackage(id, serverBase, dshHome) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return { error: '非法技能 id' }
  const base = String(serverBase || '').replace(/\/$/, '')
  if (!base) return { error: '服务端地址未配置' }
  const home = String(dshHome || '').trim()
  if (!home) return { error: 'DSH_HOME 未设置' }
  const skillsDir = join(home, 'skills')
  const zipPath = join(skillsDir, `${id}.zip`)
  const destDir = join(skillsDir, id)
  let buf
  try {
    const res = await fetch(`${base}/skills/${encodeURIComponent(id)}/download`)
    if (!res.ok) return { error: `技能包下载失败 HTTP ${res.status}` }
    buf = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    return { error: `技能包下载失败：${err instanceof Error ? err.message : String(err)}` }
  }
  if (!buf.length) return { error: '技能包为空（服务端未提供下载）' }
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(zipPath, buf)
  rmSync(destDir, { recursive: true, force: true })
  const code = await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`], { stdio: 'ignore' })
    child.on('exit', (c) => resolve(c ?? -1))
    child.on('error', () => resolve(-1))
  })
  if (code !== 0) return { error: `技能包解压失败（Exit ${code}）——zip 已留存于 ${zipPath}` }
  return { dir: destDir, zipPath, skillMd: existsSync(join(destDir, 'SKILL.md')) }
}
