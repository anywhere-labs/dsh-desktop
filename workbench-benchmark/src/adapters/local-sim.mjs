import fs from 'node:fs/promises'; import path from 'node:path';
import {now,manifest,autonomy} from '../harness.mjs';
export async function execute(task, ctx) {
  const started=Date.now(), events=[]; const emit=(type,extra={})=>events.push({seq:events.length+1,run_id:ctx.run_id,timestamp:now(),event_type:type,status:'success',...extra});
  emit('task_received',{task_id:task.id}); emit('input_validated'); emit('plan_created'); emit('tool_call',{tool:{name:'local-sim',category:'simulation'},latency_ms:5});
  for (const f of task.outputs) { const p=path.join(ctx.dir,f); const content=f.endsWith('.json')?JSON.stringify({task_id:task.id,benchmark_version:'1.0.0',note:'local simulation artifact'}):`# ${task.name}\n\nLOCAL_SIMULATION\n`; await fs.writeFile(p,content); emit('artifact_created',{filename:f}); }
  emit('self_check'); emit('result_submitted');
  const scores={result:82,artifact:90,autonomy:autonomy({steps:task.outputs.length+5}),reliability:100,evidence:70,efficiency:78,safety:100};
  return {events,artifacts:await manifest(ctx.dir,task.outputs),scores,timing:{wall_clock_ms:Date.now()-started,agent_active_ms:Date.now()-started,tool_wait_ms:5,human_wait_ms:0,recovery_ms:0},token_usage:{status:'UNAVAILABLE',input_tokens:null,output_tokens:null,source:'local-sim'},interventions:{critical:0,minor:0,clarifications:0},errors:0,retries:0,hard_failures:[]};
}
