import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')
assert.match(source, /VITE_DEMO_VIDEO_URL/)
assert.match(source, /publishedDemoVideoUrl/)
assert.match(source, /publishedDemoVideoUrl \? "done" : "idle"/)
