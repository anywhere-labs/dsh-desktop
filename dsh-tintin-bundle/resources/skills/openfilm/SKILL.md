---
name: openfilm
description: Make real videos with OpenFilm, driven by TinTin's server models and media capabilities — you write the film as web pages, the person watches and edits it in Studio (embedded in the main window, opened from the left sidebar), and `render` exports the MP4. Use when the person asks to make a video, film, launch/demo/promo video, motion graphics, lyric video, slideshow with motion, screen demo, voice-over, or mentions OpenFilm; 中文触发词：做视频/拍个片子/宣传片/短视频/动画视频/产品演示视频/MV/视频海报/让 AI 做视频/配音/字幕。
---

<!-- tintin-managed: openfilm skill -->

# OpenFilm (TinTin · server-driven)

You make films with OpenFilm. A film is a web page, `film.html`, that cuts pages, footage, pictures and sound
together. A page is a web page that sets `window.film` and draws any moment t it is asked for. Studio, a local
editor, shows the person the film taking shape while you work, and they can change anything in it by hand.

**The models and media all come from the TinTin server.** You are the TinTin agent, running on the server's model;
voice-over, music, sound effects, transcripts, stock pictures and the LLM itself are the server's capabilities —
never ask the person for an API key or send them to connect ElevenLabs/OpenAI/Google.

## Environment (DSH desktop · Windows)

- In a packaged TinTin, the `openfilm` command is on PATH (vendored runtime with its own Node, headless Chromium
  and ffmpeg). In a dev checkout without it, use `npx -y openfilm@latest <command>` instead (the first run downloads
  the CLI and a headless browser — say so if the person is waiting).
- Never run `openfilm update`: the TinTin installer owns this copy.
- Studio: the person opens it from the left sidebar row **OpenFilm**; Studio is embedded in the main window (a native web view over the workbench area, with the directing chat on its right). When you need Studio
  running for `get` and it is not, run `openfilm open` first, with `$env:OPENFILM_NO_BROWSER='1'` set so it does not
  also open the system browser.
- Films live in a folder of their own under the session workspace, named after the film in kebab-case
  (`launch-video`). Run every command with that folder as the working directory; `openfilm get` acts on the project
  around the current folder.
- Never create, edit or delete anything inside `.film/` or `.git/` in the film folder: those belong to the tools.
- Reply to the person in their language; the film's own text follows what they asked for.
- Antivirus (Huorun and kin) can intermittently block ffmpeg from writing files when the command chain runs through
  cmd.exe or right after a folder was created. If `render` fails with "Permission denied", wait a few minutes and
  rerun the exact same command; if it persists, tell the person to whitelist ffmpeg or the film folder.

## Offline libraries (films must render with no network)

The official examples import three.js from jsDelivr; TinTin ships it instead, pinned to 0.184.0, at
`$env:DSH_HOME\openfilm-libs\three\` (`three.module.js`, `addons/loaders/FontLoader.js`, `TTFLoader.js`,
`addons/libs/opentype.module.js`, `LICENSE`). When a page needs three.js:

    Copy-Item "$env:DSH_HOME\openfilm-libs\three\three.module.js" lib\three.module.js
    Copy-Item -Recurse "$env:DSH_HOME\openfilm-libs\three\addons" lib\addons

and point that page's import map at the local files (every page carries its own map):

    <script type="importmap">{ "imports": { "three": "./lib/three.module.js", "three/addons/": "./lib/addons/" } }</script>

Never leave a CDN URL (jsDelivr, unpkg) in a film: open/look/render must work offline. When you reuse one of the
official examples, rewrite every page's import map first and copy the library into the project.

## Server media tools (preferred)

The server's media capabilities are exposed as DSH tools. They normalize parameters, land generated files in the
film project (default `assets/tintin/`), poll asynchronous jobs, and return `{ ok, error? }`. Prefer them over any
HTTP or `openfilm get` call.

- `tintin_capabilities` — the server's capability registry (39 entries: LLM, TTS, ASR, music, SFX, material,
  montage, digital human, ComfyUI, Dreamina…); filter by keyword to discover advanced ones.
- `tintin_voices` — list clone samples (`id` → `sample_id`) and Qwen3 preset speakers.
- `tintin_tts` — voice-over: `text` plus `sample_id`, or `engine:"qwen3"` + `speaker`. Lands
  `assets/tintin/vo-<ts>.wav` unless `out` says otherwise. Speak the whole line in one call (never split sentences).
- `tintin_asr` — transcript with word timings. Pass `vtt` to write a word-tagged WebVTT beside the media
  (`assets/tintin/line1.wav` → `assets/tintin/line1.vtt`).
- `tintin_beatmap` — bpm, beats, downbeats, bars, structure and smart cuts for beat-synced cuts.
- `tintin_bgm` — instrumental background music (3–60 s), lands in `assets/tintin/`.
- `tintin_sfx` — sound effects, lands in `assets/tintin/`.
- `tintin_stock_images` — search stock pictures/videos; `download` copies the first N into the project.
- `tintin_image_reverse` — a prompt from a local picture (vision).
- `tintin_comfyui` — submit a ComfyUI workflow (JSON file or inline); polls async results.
- `tintin_task_status` — read a long task later (`/tasks/unified/{id}`).
- `tintin_generate_image { prompt, aspect?, out? }` — text-to-image (semantic, single); lands in the
  project and returns the path. Multi-image: call it several times.
- `tintin_generate_video { prompt, resolution?, duration?, out? }` — text-to-video (semantic, single
  clip); minutes-long, the tool waits and returns the path (timeout → `tintin_task_status`).

### Voice-over (TTS) in practice

1. `tintin_voices` → choose a sample id (clone) or a Qwen3 speaker.
2. `tintin_tts { text, sample_id }` (or `engine:"qwen3", speaker`) → `path`.
3. `tintin_asr { file: path, vtt: "assets/tintin/line1.vtt" }` → word count + a word-tagged VTT for karaoke
   subtitles and word-synced page animation.

Place the audio as a film clip: `<audio src="assets/tintin/vo-….wav" at="<film second>"></audio>`. Never draw
subtitles in a page; the `.vtt` beside the media is how OpenFilm shows them.

### Music, effects, pictures

- `tintin_bgm { prompt, style, duration }` → a path; put it on a sound track (`<audio src="…" volume="0.6">`).
- `tintin_sfx { prompt, duration }` → a path; place each hit at its film second.
- `tintin_stock_images { query, kind:"image", per:6, download:3 }` → items and local paths; for generated
  pictures use `tintin_generate_image` instead of inventing one.

### Fallback (tools unavailable)

The same capabilities are reachable through OpenFilm's custom service while Studio runs:
`openfilm get call --service tintin --path <path> …`. Use it only when a tool above is missing.

### What the server does NOT provide (yet)

- Text-to-image and text-to-video **endpoints exist now** (`tintin_generate_image` / `tintin_generate_video`),
  but the backend (comfygen) contract was still aligning when this skill shipped — a call may fail with a
  server error. If that happens: say so plainly, fall back to stock search / material library / the person's
  own footage, and retry later once the server reports the backend aligned.
- Video transforms without generation come from image/video → video workflows (digital human: image + audio →
  talking video; face swap, background replace, lip sync) — use them only when the person supplies the
  required picture/footage.
- Subtitle translation: do it yourself (you are the server's LLM) when writing the `.vtt`; no provider call needed.

If the person asks for something in these gaps, say so plainly and offer the available alternative.

## The project

A folder:
- `film.html`: the film. The person edits it in Studio at any moment: read it right before you change it, and
  change only what you mean to.
- Pages (`*.html`): pictures written as code, with the files they load by relative path.
- `assets/`: media files (video, pictures, sound). The person sees every one in Studio: keep only what the film
  can use, and delete the pieces you made them from.
- Files and folders starting with a dot (`.film`, `.git`) belong to the tools: leave them.

## film.html

    <!doctype html>
    <html>
    <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=1920, height=1080">
    </head>
    <body>
    <section>
      <iframe src="title.html"></iframe>
      <img src="assets/logo.png#t=0,3" at="6" style="left: 1640px; top: 60px; width: 200px">
    </section>
    <section>
      <video src="assets/a.mp4#t=2,8" at="2" class="card" style="left: 160px; top: 90px; width: 1600px; height: 700px"></video>
    </section>
    <section>
      <audio src="assets/tintin/line1.wav" at="2"></audio>
    </section>
    </body>
    </html>

- The viewport is the film's frame, in CSS pixels; without it, 1920×1080.
- Each `<section>` is a track of clips that do not overlap; any clip goes on any track. The sections are the tracks
  as Studio's timeline shows them, top first: the first one's pictures are on top, so titles go before the footage
  they cover, and the background last. What a page does not paint is transparent; a moment with no clip is black.
- A track the person `locked` is theirs: change nothing on it. A `hidden` track shows and plays nothing; a `muted`
  one plays no sound.
- A clip is an element: `<iframe>` a page, `<video>`, `<img>` a picture, `<audio>` a sound.
  - `src`: its file, relative to film.html. `#t=in,out` says which seconds of it play, `#t=in` to its end; without
    it, all of them. A picture, or a page without a `duration`, needs `#t=0,length`: how long it stays.
  - `at`: where it starts in the film, in seconds; without it, 0.
  - `left`, `top`, `width`, `height` in its `style` (px) and `rotate` (degrees, clockwise): where it sits. Without
    them, a video or picture is the stage, and a page is its own size, centered.
  - Its look is CSS, in `class` or `style`; a video or picture fits whole in its box unless you say otherwise
    (`object-fit: cover` crops it to the box). The film's CSS holds still; what moves is a page.
  - `speed` (video and sound): 0.25 to 4; the clip lasts `(out − in) / speed`. Change `speed` only — never
    re-encode a file at another speed, nor move its `.vtt`'s times.
  - `volume` (video and sound): 1 is the file's own level; `muted` silences it.
  - `id`: a name, unique in the film. `overrides`: the person's Studio edits — keep them as they are.
- Cut a long recording by trimming it: every clip of it is the same file with its own `#t=`. Never cut, crop or
  re-encode media into new files; CSS crops.

## A page

    <script type="module">
    window.film = {
      frame(t) { /* draw the whole picture at t seconds */ },
      duration: 6,
      ready: loadEverything(),
    };
    </script>

**The one rule: the picture depends only on t.** The same t always draws the same picture, whatever was drawn
before and in whatever order.

- One shot per page: a film of five shots is five pages cut together in film.html, so the person can trim, reorder
  and replace each one.
- Studio edits elements, not pixels: make what the person may change a DOM element.
- Without `width`/`height`, a page is the size of the stage; with them, its clip's style puts it in place.
- The host calls `frame(t)`; a page never animates by itself (no animation loop, no autoplay). Create a WebGL
  context with `preserveDrawingBuffer: true`.
- A page has no sound: every sound is a clip in film.html. A shot's sound effect goes at the film second it plays:
  the page clip's `at`, plus the page's t, less the clip's in point.

## Check your work visually

`look` draws frames; you can see them through the server's vision model:

1. `openfilm look` (contact sheet) or `openfilm look 12.5` (one frame) — the output names the PNG path.
2. Call `vision_analyze { image_path: "<absolute path to that PNG>", question: "…" }` with a concrete question:
   composition, text legibility or clipping, color, whether the frame matches the brief.
3. Fix what it names, then `look` again. Do this at least once before rendering, and whenever a page's design
   matters. Keep the sheet small enough to read (a few frames); `look a-b` for a dense stretch.

## Tools

Run them in the film folder as `openfilm <command>` (`npx -y openfilm@latest <command>` on a dev checkout). Each
one's `--help` lists its options:
- `open [folder]`: start or open a project. Existing Studio instances switch to it. The TinTin app normally opens
  Studio from the sidebar; use `open` when you created a new film and want the person to watch it land.
- `look`: a contact sheet of the whole film with its sound, and a check that the same t draws the same picture.
  `look 4.5` is one frame at full size, `look 3-6` a stretch, `look assets/a.mp4` a media file. Run it after
  meaningful changes.
- `render`: the MP4, beside film.html (30 fps unless `--fps`). Only when the person asks for the file.
- `get`: the server capabilities above; with no verb it lists what is usable now (yours: `call` → `tintin`).
- `skills`: the film-making skills this project can use; `openfilm skill <name>` prints one whole. Follow it when
  the person names one or it fits what they ask; copy what the film uses into the project.

OpenFilm is by [openfilm.dev](https://openfilm.dev), MIT License — source
[openfilm/openfilm](https://github.com/openfilm/openfilm). This skill embeds its MANUAL.md; `openfilm` with no
arguments prints the live manual, which wins if they disagree.
