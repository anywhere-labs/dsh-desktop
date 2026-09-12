import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
export async function manifest(dir, names) {
  return Promise.all(names.map(async filename => { const p=path.join(dir,filename); const b=await fs.readFile(p); return {artifact_id:`art_${sha256(b).slice(0,12)}`,filename,type:path.extname(filename).slice(1),size:b.length,sha256:sha256(b),validation_status:'pending'}; }));
}
export function autonomy({steps,critical=0,minor=0,clarifications=0}) { return Math.max(0, Math.min(100, (1-(5*critical+2*minor+0.5*clarifications)/Math.max(1,steps))*100)); }
export function scoreRun(spec, run) {
  const s=run.scores; const w=spec.weights;
  const workScore=Object.entries({result:s.result,artifact:s.artifact,autonomy:s.autonomy,reliability:s.reliability,evidence:s.evidence,efficiency:s.efficiency,safety:s.safety}).reduce((n,[k,v])=>n+v*w[k],0);
  const hardFail=run.hard_failures?.length>0;
  const band=hardFail?'W3':workScore>=90?'W0':workScore>=75?'W1':workScore>=60?'W2':'W3';
  return {...run,work_score:Number(workScore.toFixed(2)),band,hard_fail:hardFail};
}
