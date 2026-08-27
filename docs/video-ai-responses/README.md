# Video playback / landscape — outside-AI responses

Drop the responses you get from other AIs (ChatGPT, Gemini, Grok, etc.) about the
video/landscape bug in **this folder**, one file per AI. I'll read them all and we'll
compare their diagnoses + proposed fixes together.

## How to add one
- Save each response as its own file here, e.g.:
  - `chatgpt.md`
  - `gemini.md`
  - `grok.md`
  - `claude-other.md`
- Plain text or markdown is fine. Paste the whole response — don't trim it.
- Name it after the AI so we can tell them apart.

## The question they're answering
See `docs/VIDEO_PLAYBACK_BRIEF.md` (the brief you're sending out). Core bug:
rotating to landscape to play/tag a video goes half-size → snaps back → takes a
few tries → then works, on native iOS. Leading hypothesis: `app.json`
`orientation: "portrait"` makes the app portrait-only at the OS level while both
screens force `ScreenOrientation.lockAsync(LANDSCAPE)` at runtime.

## When you've added them
Tell me "the video responses are in" and I'll read every file here, compare what
each AI says, flag where they agree/disagree, and recommend which fix to try.
