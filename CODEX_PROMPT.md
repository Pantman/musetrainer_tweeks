# Codex Project Prompt

Use this file as the starting prompt/context for future Codex sessions working in this repository.

## Project Summary

MuseTrainer is an Angular/Ionic piano-training app for practicing MusicXML scores with:

- listen mode
- wait mode
- realtime/live mode
- MIDI input/output support
- rendered score playback using OpenSheetMusicDisplay (OSMD)

The main active work is in `src/app/play/play.page.ts`, which contains most playback, cursor, feedback, and debug logic.

## Current Product Direction

The main long-term goal is to make live playback feel visually exact and robust:

- the green cursor should move in a way that always feels musically correct
- feedback bulbs must use the cursor the user actually sees on screen
- loop wraps and system changes must look intentional and never glitchy
- the code should be heavily commented so future prompt-driven edits do not regress behavior
- live mode behavior should be identical regardless of whether notes are played by the computer or by the human

This work is focused on live playback modes, not wait mode.

## Important Files

- `src/app/play/play.page.ts`
  This is the main implementation file for playback, cursors, feedback, debugging overlays, and loop/system wrap behavior.
- `src/app/play/play.page.html`
  Play screen markup, including the timed-live cursor overlay and debug controls.
- `src/app/play/play.page.scss`
  Visual styling for the play screen and cursor overlays.
- `src/app/notes.service.ts`
  Required-note calculation and playback-note registration logic.
- `tsconfig.json`
  Root TypeScript config. It was narrowed so VS Code stops indexing transient build artifacts.
- `README.md`
  Basic project setup info.

## Current Cursor Architecture

There are effectively two cursor layers:

1. Legacy OSMD cursors
- Cursor `0` is the play cursor/state cursor.
- Cursor `1` is the tempo cursor.
- These still help enumerate score state and drive some playback behavior.

2. Timed live cursor overlay
- This is the visible green line in timed/live playback.
- It is rendered from the timed-live timeline built from score events and overlays.
- In live playback, this overlay is the visual source of truth.

Important rule:

- Any feature that depends on where the user sees the green cursor should prefer the rendered timed-live cursor state, not raw OSMD cursor base positions.

## Cursor Contracts We Intend To Preserve

### Count-in / start behavior

- When start is pressed, the green cursor should already be visible.
- During the countdown, it should remain parked on the first playable timestamp.
- It must not blink as a countdown indicator.
- It must not start moving until the countdown completes.
- If the first timestamp is beat one, the cursor should already be on that timestamp before motion begins.

### Loop and system wraps

The intended mental model is:

- animation should look like playback is continuing normally into the next bar
- there is a portal at the end of the current bar/system
- when the cursor reaches that portal, it teleports instantly to the corresponding position in the destination bar/system
- the cursor must never visibly move backward
- the cursor must never sweep through skipped bars

### Feedback placement

- Red bulbs and other timing-feedback bulbs must follow the rendered cursor the user sees.
- This matters especially during:
  - system transitions
  - loop wraps
  - tie transitions
  - any animated cursor movement using transforms or overlay state

### Realtime feedback classification

Treat these as separate concepts:

- whether a note is allowed to satisfy or advance the current realtime step
- how that note is timing-classified
- whether that note or step is allowed to render a green hit

They are intentionally not equivalent.

When this file says "step advance", it means:

- the app is allowed to treat the current score step as complete enough to move the live/play cursor on to the next step
- this can happen even when the visual feedback is not a green hit
- this is why "accepted for step advance" and "green hit" must stay separate in the code

The intended classification model is symmetric:

- `early` and `late` should follow the same basic rules
- the main conceptual difference is the sign of the time offset relative to the target timestamp
- they should otherwise behave like mirror-image timing classes, with different colors and different stats buckets

If the implementation behaves asymmetrically, that is usually because of step-advance mechanics around "previous step" versus "next step", not because the classification contract itself is supposed to be different.

#### `correct`

- A note is `correct` only when it lands inside the accepted on-time window for its target timestamp.
- `correct` is the same thing as an on-time green hit.
- `correct` notes may count toward satisfying the current realtime step.
- `correct` notes may render green note feedback.
- A chord/step should only render green when every required note for that step was matched as `correct`.

#### `early`

- A note is `early` when it matches the expected pitch material for a target note, but arrives before the on-time hit window.
- `early` and `late` share the same rule shape:
  - they match an expected target note
  - they are outside the on-time hit window
  - they render timing feedback instead of a green hit
  - they must not be turned into green later by step-advance logic
- `early` uses the early-side timing window and early color.
- An `early` note may or may not count toward step advance depending on the live-mode tolerance rules, but it must never render as a green hit.

#### `late`

- A note is `late` when it matches the expected pitch material for a target note, but arrives after the on-time hit window.
- `late` uses the late-side timing window and late color.
- A `late` note may still be accepted for step advance/tolerance purposes in realtime mode.
- `late` notes should render late timing feedback, not green hit feedback.
- `late` notes must never cause either the current step or the previous step to paint green during a later cursor advance.

#### `miss`

- `miss` covers the red-bulb cases.
- A note is `miss` when any of the following is true:
  - the played pitch does not match any currently expected note and is therefore just wrong
  - the note is so early or so late that it falls outside the accepted early/late tolerance windows and should no longer be treated as an accepted timing variation
  - the cursor advances and one or more expected notes for that step were never matched on time
- `miss` feedback must never render as green.
- Miss evaluation at step advance should compare the step's required-note set against the notes that were actually matched as `correct`.
- Wrong-pitch unmatched notes should stay in the red/miss family. They should not be reinterpreted as early, late, or green unless they are explicitly matched to an expected target note by the classification logic.

#### Green-hit source of truth

- In realtime mode, "all required keys are currently down" is not sufficient to justify green success rendering.
- Green success must be based on the subset of required notes that were actually classified as `correct` for the current step.
- This distinction protects against regressions where early/late notes can still allow step advance but are incorrectly rendered as green hits.

## Progress So Far

These fixes have already been made and committed:

- `3d1dc9e` `Formalize live cursor behavior and add play build badge`
  Added stronger comments and a visible build label.
- `276efeb` `Keep timed cursor parked on first timestamp during count-in`
  Fixed the count-in start position.
- `facbe3b` `Restore portal-style timed cursor wraps`
  Restored portal-style live wrap behavior for the timed cursor.
- `fc771a7` `Use rendered live cursor for incorrect feedback placement`
  Made incorrect/red feedback use the rendered live cursor position.

There is also a stash that may still be useful:

- `stash@{0}` `timed live cursor teleport experiment`

That stash represents an alternate wrap implementation that was intentionally set aside.

## Current Known Good Behaviors

- The play screen shows a build label inside the white score pane.
- The build marker lives in `PlayPageComponent.PLAY_SCREEN_BUILD_MARKER`.
- The build marker must be incremented on every code change.
- The green cursor count-in positioning has been improved.
- Portal-style wraps are restored.
- Incorrect feedback placement has been updated to use the visible cursor path.

## Known Gotchas

### 1. `play.page.ts` is very large

Do not make assumptions after reading only one section. Cursor behavior is split across:

- legacy OSMD cursor stepping
- timed-live timeline generation
- rendered timed-live overlay updates
- feedback placement logic
- debug helpers

### 2. Base cursor position is not always the visible cursor position

Some older helpers read `style.left` / `style.top` or legacy cursor DOM state.
That can be wrong during:

- transform-based cursor alignment
- timed overlay animation
- wraps
- transitions

Prefer helpers that use rendered cursor state or `getBoundingClientRect()`-based rendered positions.

### 3. Live behavior must not depend on who is playing

If a bugfix only works in autoplay or only works in human input mode, it is probably incomplete.
The cursor contract should be shared across live mode.

### 4. Build number discipline

Every change should bump:

- `PlayPageComponent.PLAY_SCREEN_BUILD_MARKER`

This is how the user verifies they are looking at the newest build in the browser.

### 5. Dev server status

The normal local entry point is:

```sh
npm run start -- --host 0.0.0.0
```

The dev server may need elevated permissions in this environment to bind to port `4200`.

### 6. TypeScript config

The root `tsconfig.json` was narrowed to avoid VS Code indexing transient build outputs such as `www/*`.
Be cautious about broadening it again unless you also handle editor noise.

## Working Rules For Future Codex Sessions

- Read the relevant cursor/feedback sections before editing.
- Prefer small checkpoint commits after each bugfix.
- Keep comments strong where behavior is subtle or easy to regress.
- Do not remove build-marker bumps.
- Preserve the distinction between:
  - score-state cursors
  - rendered live cursor
- When debugging placement bugs, ask:
  - “Which cursor is actually visible?”
  - “Which position source is the feedback code reading?”
  - “Is this using rendered position or base position?”

## Suggested Prompt Stub

Use something like this as the opening context for a future Codex session:

```text
Read CODEX_PROMPT.md first.
This repo is MuseTrainer. The current priority is live playback cursor correctness in src/app/play/play.page.ts.
Preserve the existing count-in, portal-wrap, and rendered-cursor feedback contracts.
Increment PLAY_SCREEN_BUILD_MARKER on every change.
Prefer checkpoint commits after each bugfix.
```
