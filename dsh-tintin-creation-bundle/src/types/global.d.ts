// 宿主桥面类型（creation 包直接消费的子集）。完整契约的唯一真源在
// dsh-tintin-media-bundle/src/types/global.d.ts，此处只摘本包用到的通道，
// 形状 1:1 对齐该文件（dialog:* / env:*；2026-10-17 拆包时 CreationReferences
// 与 ensureServerBase 直访 window.tintin 所需）。

// dialog 通道（dialog:*；openFiles 多选=上传参考）
declare interface TintinBridgeDialog {
  openFile(params?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }): Promise<string | null>
  openFiles(params?: {
    title?: string
    filters?: Array<{ name: string; extensions: string[] }>
    multi: true
  }): Promise<string[] | null>
  openDir(params?: { title?: string }): Promise<string | null>
}

// 环境通道（env:*；serverPing=服务端基址探测）
declare interface TintinBridgeEnv {
  serverPing(): Promise<{ online: boolean; url: string; status?: number; latencyMs?: number }>
}

declare global {
  interface Window {
    tintin: Readonly<{
      dialog: TintinBridgeDialog
      env: TintinBridgeEnv
    }>
  }
}

export {}
