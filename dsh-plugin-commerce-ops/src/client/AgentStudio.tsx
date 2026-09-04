import { useState } from 'react'

type StudioNode = { readonly id: string; readonly kind: string; readonly label: string }
const initialNodes: readonly StudioNode[] = [
  { id: 'collect', kind: 'Fetch', label: '采集店铺数据' },
  { id: 'analyze', kind: 'Analyze', label: '分析经营指标' },
  { id: 'policy', kind: 'Policy', label: '平台规则校验' },
  { id: 'approval', kind: 'Approval', label: '人工审批' },
]

export function AgentStudio(): JSX.Element {
  const [nodes, setNodes] = useState<readonly StudioNode[]>(initialNodes)
  const [selected, setSelected] = useState('analyze')
  const selectedNode = nodes.find(node => node.id === selected) ?? nodes[0]
  return <section className="opsStudio"><aside className="opsStudioLibrary"><div className="opsPanelTitle">Agent Studio</div><div className="opsStudioGroup"><small>Agent</small>{['运营总控 Agent', '店铺经营 Agent', '商品经营 Agent', '数据分析 Agent'].map(item => <button className="opsStudioItem" key={item}>{item}</button>)}</div><div className="opsStudioGroup"><small>Skill</small>{['每日经营日报', '商品健康评分', '库存预警', '平台规则检查'].map(item => <button className="opsStudioItem" key={item}>{item}</button>)}</div></aside><div className="opsStudioCanvas"><header className="opsPageHeader"><div><h1 className="opsPageTitle">每日经营日报</h1><p className="opsPageSubtitle">v0.1 草稿 · 修改后需校验才能发布</p></div><div className="opsActions"><button className="opsButton">保存草稿</button><button className="opsButton">校验流程</button><button className="opsButton opsButtonPrimary">Dry Run</button></div></header><div className="opsFlow">{nodes.map((node, index) => <div key={node.id} className="opsFlowNodeWrap"><button className="opsFlowNode" data-selected={selected === node.id} onClick={() => setSelected(node.id)}><small>{node.kind}</small><strong>{node.label}</strong></button>{index < nodes.length - 1 && <span className="opsFlowArrow">→</span>}</div>)}</div><button className="opsButton opsStudioAdd" onClick={() => setNodes([...nodes, { id: `step-${nodes.length}`, kind: 'Event', label: '记录运行事件' }])}>+ 添加节点</button></div><aside className="opsStudioInspector"><div className="opsPanelTitle">节点属性</div><label>节点名称<input value={selectedNode?.label ?? ''} onChange={event => setNodes(nodes.map(node => node.id === selected ? { ...node, label: event.target.value } : node))} /></label><label>节点类型<select value={selectedNode?.kind ?? ''} onChange={event => setNodes(nodes.map(node => node.id === selected ? { ...node, kind: event.target.value } : node))}><option>Fetch</option><option>Analyze</option><option>Policy</option><option>Approval</option><option>Event</option></select></label><div className="opsStudioNotice">高风险动作必须经过审批节点，未通过校验不能发布。</div></aside></section>
}
