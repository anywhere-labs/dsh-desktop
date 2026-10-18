# TinTin packaged media resources

fetch-tintin-binaries.mjs fills bin/ (ffmpeg/ffprobe/yt-dlp) and
fetch-tintin-ext-assets.mjs fills ext-assets/ (browser extensions) from
the TinTin_Client_Electron checkout; both ship via extraResources.

fetch-openfilm-runtime.mjs (dsh-tintin-bundle/scripts) fills bin/openfilm.cmd,
openfilm/ (npm install tree + bin/node.exe) and playwright-browsers/
(headless Chromium) — the vendored OpenFilm runtime. node.exe stays out of
bin/ on purpose: a node-in-bin parent would pin spawned `ffmpeg` to the
vendored binary (CreateProcess resolves the parent exe's directory before
PATH) instead of preferring the system's. Run all three before
packaging; nothing here is committed.

`yarn workspace dsh-tintin-bundle fetch:openfilm` runs the OpenFilm fetch, and
`package:tintin:dir:full` calls it before packaging. Every TinTin packaging
script starts with `verify:resources`, which fails the build when openfilm/ or
playwright-browsers/ is missing — an installer built without them shows
"OpenFilm 运行时未安装" as soon as the OpenFilm entry is opened.
