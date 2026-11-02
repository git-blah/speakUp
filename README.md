# Speak Up

Practise speaking on the spot. You get a random prompt (a word, topic, real-life situation, something to explain, or an impromptu speech), a short time to think, and then you speak to your camera until the timer runs out. Watch the take back, check yourself and go again.

The goal is to improve spoken English, clarity, quick thinking and confidence on camera and in front of an audience.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 and allow camera and microphone access. Optional features are switched on with keys in `.env.local`. Copy `.env.example` to get started. Browsers only allow camera access on `localhost` or over HTTPS. To use it on your phone, deploy it (for example on Vercel) rather than opening your laptop's IP address.

## How a session works

1. **Setup:** pick prompt types, difficulty, thinking time (0–60s) and speaking time (30s–3min).
2. **Ready:** the camera preview is on. The prompt stays hidden until you press *Reveal prompt*, and that's when the thinking clock starts.
3. **Think:** a countdown runs over the preview. You can start early or skip to a different prompt.
4. **Speak:** recording starts automatically and stops when time runs out. You can also press *Stop*.
5. **Review:** play the take back, tick the self-check list, download the video, then try the same prompt again or move to the next one.

After each take you get:

- **Stats:** pace (words per minute, with 130–160 as the target), fillers (um/uh plus possible fillers like "like", "you know", "basically"), long pauses (2 seconds or more), time to your first word, and word count with vocabulary variety.
- **Tips:** up to three concrete suggestions for your next take, based on those stats.
- **Transcript:** what you said, with fillers highlighted and long pauses marked. With Deepgram, clicking a word jumps the video to that moment.
- **On camera** (video takes): movement (natural, very still, a lot of movement, or the camera itself moving), lighting (good, too dark, washed out, backlit, or camera blocked), and a second-by-second movement timeline you can click to jump to that moment in the video.

### How the on-camera analysis works

While you speak, the app takes about 4 tiny greyscale snapshots a second (64×48 pixels) from the camera preview. Everything happens in your browser, and the snapshots are thrown away once the numbers are worked out.

- **Movement** is the share of the picture that changes between snapshots. Change in the frame's outer border means the camera moved, since a speaker moves in the middle while the background stays put. Change mostly in the middle means you moved.
- **Lighting** comes from overall brightness, plus centre-versus-edge brightness to spot a bright window behind you.

These are rough measures: hand gestures count as movement too, and there's no face tracking yet, so framing and eye contact aren't checked. The thresholds are at the top of `lib/videoAnalysis.ts` if they feel too strict or too lenient for your camera. The results are saved with each take, shown again when you reopen it from Progress, and passed to the AI coach.

Recording is capped at **60 fps**. The camera keeps its own rate (usually 30 fps) up to that limit, and the preview shows the resolution and frame rate in use.

With an AI coach turned on (Claude or a local Ollama model), you also get:

- **Coaching:** a short verdict, four scores out of 10 (clarity, structure, on topic, language), what worked, what to improve, grammar and word-choice fixes quoted from your transcript, and a stronger version of your answer.
- **A follow-up question** from an imaginary audience member. Press *Answer it now* to make it your next prompt, for quick-thinking practice.
- **A one-pager** on the topic (key points, perspectives, vocabulary with examples, an answer outline and strong openers) that you can print or save as a PDF.

## Progress

The **Progress** tab (at the top, next to Practice) shows:

- **Last 7 days:** takes, minutes spoken, pace, fillers per minute, time to first word and coach score, each compared with the 7 days before (▲/▼ with "better" or "worse"), plus a **focus for the next 7 days** picked from your weakest area.
- **Practice calendar:** the last 16 weeks, one square per day, darker for more takes.
- **Trends:** pace (with the 130–160 target band), fillers, first word and coach score over time, with a 5-take average line. Filter by date range and prompt type, hover or use the arrow keys for values, and click a point to open that take.
- **All takes:** a table of every take. Open one to rewatch the recording (if it was kept), see its stats, transcript and saved AI feedback, practise the same prompt again, or delete it.

## Where your data lives

Everything stays in your browser. Nothing is stored on a server.

- **Take history** (prompt, date, length, stats, coach score) is in `localStorage`, up to 1,000 takes.
- **Transcripts, tips and AI feedback** for each take are in IndexedDB.
- **Recordings** are in IndexedDB too, if *Save recordings* is on (setup screen: Off / last 10 / 30 / 100; default is the last 10). Older ones are deleted automatically. A one-minute video is roughly 5–15 MB.

Clearing your browser's site data deletes all of this, and it doesn't sync between devices or browsers. Download any recording you want to keep for good.

Speech is transcribed by your browser or, if you set it up, by Deepgram (see below). Video is never uploaded.

## Transcription

There are two options. The app picks automatically.

| | Browser (default) | Deepgram (recommended) |
|---|---|---|
| Setup | None | Add an API key |
| Works in | Chrome, Edge, Safari | Any browser |
| Filler words | Often drops "um"/"uh" | Keeps them (`filler_words=true`) |
| Pauses and click-to-seek | No (no word timings) | Yes |
| Privacy | Chrome sends audio to Google | Audio sent to Deepgram from your server |
| Cost | Free | About $0.004/min ($200 free credit on sign-up) |

To use Deepgram, create a key at https://console.deepgram.com and add it to `.env.local` (and to your host's environment variables when you deploy):

```bash
DEEPGRAM_API_KEY=your_key_here
```

Restart `npm run dev`. The setup screen will say "Transcripts come from Deepgram". Only a small audio-only copy of each take (about 0.4 MB/min) is uploaded, never the video. That also keeps uploads under the 4.5 MB request limit on Vercel.

Known limitation: on Android Chrome, browser speech recognition can conflict with the camera's microphone. Use Deepgram there.

## AI coach: Claude or a local model

Pick the coach on the setup screen: **Claude**, **Ollama** or **Off**. Providers that aren't configured are greyed out.

### Claude

Add your key to `.env.local` (create one at https://console.anthropic.com):

```bash
ANTHROPIC_API_KEY=sk-ant-...
# optional, default claude-sonnet-5-5
ANTHROPIC_MODEL=claude-sonnet-5-5
```

Each take costs roughly 1–2 cents for coaching, plus about the same for a one-pager. One-pagers are cached in your browser, so asking again for the same prompt is free.

### Ollama (free, runs on your computer, nothing leaves your machine)

1. Install Ollama from https://ollama.com and start it.
2. Pull a model:
   ```bash
   ollama pull llama3.1:8b      # good default, about 5 GB, runs on most laptops with 8 GB+ RAM
   # or: ollama pull qwen3:8b   # often better at structured feedback
   # or: ollama pull gemma3:12b # stronger if you have 16 GB+ RAM
   ```
3. Restart `npm run dev`. **Ollama** becomes selectable, with a dropdown of your installed models.

Optional settings: `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`) and `OLLAMA_MODEL` (the default model to select).

Notes:
- Ollama is called from the app's server, so it works when you run the app on your own computer (`npm run dev` or `npm start`). A deployed copy (for example on Vercel) can't reach the Ollama on your laptop. Use Claude there, or point `OLLAMA_BASE_URL` at an Ollama server it can reach.
- The app uses Ollama's structured outputs (`format` set to a JSON Schema), which needs Ollama 0.5 or newer. Small models can still give weaker feedback than Claude. If replies look thin, try a bigger model.
- A first request can take 10–60 seconds while the model loads into memory. Later requests are faster.

## Project layout

```
app/                 Next.js App Router entry (layout, page, global styles)
components/Practice.tsx  The whole practice flow (setup → ready → prep → speaking → review)
components/Feedback.tsx  Stats tiles, tips and highlighted transcript
app/api/transcribe/  Server route that forwards audio to Deepgram (needs DEEPGRAM_API_KEY)
lib/prompts.ts       Prompt library (~100 prompts across 5 modes × 3 difficulties) + picker
lib/analysis.ts      Pace, fillers, pauses, vocabulary and tips (unit tested: npm test)
components/Coach.tsx     AI coach feedback and one-pager panels
app/api/coach/       GET: available AI providers; POST: coaching feedback on a take
app/api/learn/       POST: one-pager for a prompt
lib/coach/           Prompts, JSON Schemas + normalizers, Claude/Ollama provider layer
lib/useRecorder.ts   Camera/mic stream (capped at 60 fps) + MediaRecorder (video plus a small audio-only copy)
lib/videoAnalysis.ts Movement and lighting from small greyscale frames (unit tested)
lib/useFrameSampler.ts  Samples the live preview ~4×/s while a take records
components/VideoFeedback.tsx  "On camera" tiles, tips and movement timeline
lib/useSpeechRecognition.ts  Live browser transcription fallback
components/App.tsx       App shell: header, Practice/Progress tabs, shared settings and history
components/Progress.tsx  Weekly review, practice calendar, trend charts and take table
components/charts.tsx    SVG trend chart (crosshair, keyboard) and calendar heatmap
components/TakeDetail.tsx  Dialog for a past take: recording, stats, transcript, feedback
lib/progress.ts      Weekly review, focus, streaks, rolling averages, calendar (unit tested)
lib/takeStore.ts     IndexedDB store for recordings and per-take details (unit tested)
lib/history.ts       Take history in localStorage and streak calculation
lib/settings.ts      Settings defaults and persistence
```

To add prompts, add a `[difficulty, "text"]` entry under the right mode in `lib/prompts.ts`.

## Roadmap

- ~~Phase 2: transcription and stats~~ ✅
- ~~Phase 3: AI coach and one-pager (Claude or local Ollama)~~ ✅
- ~~Phase 4: progress (weekly review, trends, saved recordings, take history)~~ ✅
- **Next ideas:** export and import your history as a backup, and an AI-written weekly review based on your saved feedback.
- **Later:** an audience mode (live follow-up questions), a comprehension mode (listen, then summarise), a debate mode (argue the other side) and an eye-contact check.
