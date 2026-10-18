---
name: openfilm
description: Make real videos with OpenFilm, driven by TinTin's server models and media capabilities — you write the film as web pages, the person watches and edits it in Studio (a separate window opened from the left sidebar), and `render` exports the MP4. Use when the person asks to make a video, film, launch/demo/promo video, motion graphics, lyric video, slideshow with motion, screen demo, voice-over, or mentions OpenFilm; 中文触发词：做视频/拍个片子/宣传片/短视频/动画视频/产品演示视频/MV/视频海报/让 AI 做视频/配音/字幕。
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
- Studio: the person opens it from the left sidebar row **OpenFilm** (a separate window). When you need Studio
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

## Server capabilities (use these instead of paid providers)

Media comes through OpenFilm's custom service **`tintin`**, registered by the TinTin app. Call it in the film
folder with:

    openfilm get call --service tintin --path <path> [--method POST --json '<json>'] [--file file=<project file>] [--out <name>]

- Files it returns land under `assets/tintin/<out>.<ext>`; `--out` is a bare name (no folder, no extension).
- JSON answers are printed as text: read them and make the follow-up call they name.
- PowerShell: write JSON in single quotes (`--json '{"text":"..."}'`). If a shell mangles a `/path` argument
  (Git Bash converts it), prefix the command with `MSYS_NO_PATHCONV=1`.

### Voice-over (TTS) — two calls

1. Pick a voice. Server samples carry the reference audio:

       openfilm get call --service tintin --path /voice/samples
       openfilm get call --service tintin --path /indextts/qwen3/voices     # qwen3 preset speakers

   Use a sample's `id` as `sample_id`. Clone voices sound like the sample; Qwen3 preset voices use
   `engine:"qwen3"` + `speaker:"<name>"`.

2. Speak the line (expect ~0.25 s per character; a short sentence can take a minute):

       openfilm get call --service tintin --path /indextts/tts --method POST --json '{"text":"<line>","resp":"json","sample_id":1285}'

   The answer is `{"audio_url":"/output/tts/….wav", …}`. Land it under assets:

       openfilm get call --service tintin --path <audio_url> --out line1

   Now `assets/tintin/line1.wav` exists. Speech is a clip in `film.html`, never inside a page:
   `<audio src="assets/tintin/line1.wav" at="<film second>"></audio>`.

### Subtitles (ASR) — word timings from the same audio

    openfilm get call --service tintin --path /whisper/transcribe --method POST --file file=assets/tintin/line1.wav --form fmt=json --form mode=raw

`mode=raw` returns `{"segments":[{"start","end","text","words":[{"word","start","end"}]}]}` — word-level timings,
the same the official examples get from ElevenLabs. Write the WebVTT beside the media with the same base name
(`assets/tintin/line1.wav` → `assets/tintin/line1.vtt`): `WEBVTT` first, one cue per segment, and each word's
start as an inline timestamp tag — `为<00:00:00.240>了<00:00:00.320>…` (mm:ss.mmm). Line-level subtitles
(cue text only) are fine when word sync is not needed. Never draw subtitles in a page.

Use the same word timings to time a page's moves on the narration: a line's words back to back,
`start`/`end` in seconds relative to that audio file.

### Music (BGM) — one call, absolute URL

    openfilm get call --service tintin --path /audio/gen/bgm --method POST --json '{"prompt":"<what it sounds like>","style":"electronic","duration":8}'

The answer carries `url` (absolute) and `duration`. Land it with the URL's path part:

    openfilm get call --service tintin --path <path of url> --out bed

`assets/tintin/bed.wav` is the film's music track (`<audio src="assets/tintin/bed.wav" volume="0.6"></audio>`).
Sound effects: `/audio/gen/sfx` (same shape) or the server library `/sfx/library`.

### Stock pictures (image search) — JSON, then download

    openfilm get call --service tintin --path /material/stock_search --method POST --json '{"query":"city night","kind":"image","per":6}'

The answer lists `items[].url` (Pexels/Pixabay). Download the ones you use into the project yourself, e.g.
`Invoke-WebRequest -Uri <url> -OutFile assets/stock/1.jpg`, then place them in `film.html`.

### What the server does NOT provide (yet)

- **No text-to-image.** No prompt → picture endpoint is available. Use stock search, the material library
  (`/material/list`), the person's own files, or CSS/SVG/canvas drawn in a page. (Comfygen-based generation is
  being added server-side; use it once it appears in `openfilm get`/the server docs, not before.)
- **No text-to-video.** Video comes from the person's footage or the material library. The server does have
  image/video → video workflows (digital human: image + audio → talking video; image-to-video, face swap,
  background replace, lip sync) — use them only when the person supplies the required picture/footage.
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
