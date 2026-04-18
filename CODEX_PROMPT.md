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

This work is now focused on both:

- live/timed playback architecture
- porting wait mode away from legacy cursor-required-note semantics

Important wait-mode direction:

- wait mode is for learning finger positions, not time accuracy
- wait mode should eventually use `playbackTimeline` step/event truth instead
  of `notesService.calculateRequired(...)` / `isRequiredNotesPressed()`
- new work should not preserve deprecated grey-cursor / backing-track /
  autoplay behavior in wait mode just because the legacy implementation did

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

### Completion scorecard

- When a non-loop live run finishes, the app should show a congratulations / scorecard dialog.
- The first-pass scorecard shows:
  - number of hits
  - number of misses
  - number of mistakes
  - number of early notes
  - number of late notes
  - longest streak of hits
- The scorecard now separates accuracy percentage from score points.
- Accuracy percentage currently uses:
  - `hits + 0.5 * (early + late) - mistakes`
  - divided by the maximum playable note count for the active scorecard note set
  - clamped to a minimum of `0`
- The maximum playable note count must be based on the notes actually available to the active performer path:
  - if only one hand/staff is active, only those notes belong in the denominator
  - this rule also applies in debug short-run mode
- Score points currently use:
  - `hit` = `2` points
  - `early` = `1` point
  - `late` = `1` point
  - `miss` = `0` points
- Score points may also include streak bonuses.
- Current streak multipliers are:
  - `x2` at a `10`-hit streak
  - `x4` at a `50`-hit streak
  - `x10` at a `100`-hit streak
- Current grade mapping is:
  - `100%` => `S` (`perfect`)
  - `90%+` => `A`
  - `80%+` => `B`
  - `70%+` => `C`
  - `60%+` => `D`
  - below `60%` => `Try again`
- The scorecard also records run history during the current page session and renders an accuracy-history line graph:
  - y-axis = percentage
  - x-axis = run number
- Retry / close controls currently support:
  - mouse buttons in the dialog
  - computer keyboard shortcuts
  - piano-key shortcuts

### Completion scorecard debug mode

- There is now a debug-only short-run mode for the scorecard in the timed-live debug panel.
- The important controls are:
  - `debug congrats`
  - `auto-run stats`
  - `congrats bars`
- Intended behavior:
  - `debug congrats` enables short-run scorecard testing
  - `congrats bars` sets how many bars should be played before the scorecard auto-opens
  - the scorecard should appear automatically at a clean bar boundary, not from a manual button press
  - `auto-run stats` allows listen/simulated notes to feed the same scorecard pipeline for faster UI/debug iteration
- In debug short-run mode, the scorecard denominator, stats, and accuracy calculation must be scoped only to the notes inside the configured debug bar slice, not the entire selected range.

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

#### Candidate selection rule

- Realtime note matching should be done per pitch stream, not by searching every nearby note in the timeline.
- When a key is pressed for a given pitch:
  - first inspect the nearest unresolved previous note of that same pitch
  - if it is still inside the late consideration window, classify against it first
  - otherwise scan forward through same-pitch notes until either:
    - the first unresolved future note inside the early consideration window is found, or
    - the search leaves the early consideration window
- If no same-pitch candidate survives those checks, classify the played note as a `mistake`.
- Resolved same-pitch future notes should be skipped rather than stopping the forward scan, because the player may have played a rapid sequence where earlier same-pitch events were already classified.
- The previous unresolved same-pitch note should be preferred over a future same-pitch note when both could plausibly match. This biases the matcher toward "you were probably trying to hit the note you just missed" instead of assuming you intentionally skipped ahead.

#### Thresholds vs consideration window

- The inner early/late thresholds bound the green `correct` window.
- The outer early/late consideration bounds define how far away a note may still be considered `early` or `late`.
- Default working values are:
  - threshold: `50ms` on each side
  - consideration window: `100ms` on each side
- Outside the consideration window, an expected note should no longer be classified as early/late and should instead become `missed`.

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
- `09f4359` `Checkpoint timed playback scheduler before timeline refactor`
  Last checkpoint before the playback-timeline architecture shift began.
- `eae7d2d` `Updated codex_prompt to include idea for refactoring timeline representation`
  Expanded the prompt with the playback-timeline plan.
- `d1df420` `Checkpoint playback timeline for realtime computer notes`
  Introduced `src/app/play/playback-timeline.ts`, moved realtime computer-note
  playback onto the shared playback timeline, and separated visible/backing
  playback timing enough to fix the doubled backing-note/piano leak in the
  known repro around bars 25-26.
- `cf4f949` `Fix playback timeline tie spans across barlines`
  Fixed timeline note duration across tie chains so barline ties sustain
  correctly in playback.
- `8c1743b` `Fix stuck backing notes on stop during timeline playback`
  Fixed a stop-path bug where long/tied backing notes could remain sounding if
  multiple active route instances shared a pitch.
- `aa9b98e` `Checkpoint realtime matching handoff to playback note ids`
  Began moving realtime matching and scorecard dedupe from timed-live
  `event.id:index` bookkeeping to shared playback note ids.
- `1f2a390` `Checkpoint realtime notesService port to playback timeline`
  Moved another substantial chunk of timed-live realtime required-step logic
  off `notesService` and onto `playbackTimeline`.
- `792c714` `Checkpoint realtime notesService cleanup`
  Reduced more realtime dependency on `notesService` and stabilized tempo
  resolution during the transition.
- `9526403` `Checkpoint realtime isolation and loop-end stop fix`
  Fixed loop-end stuck-note stop behavior and further isolated realtime
  playback state.
- `bb7c2d1` `Checkpoint startup keyboard audio routing`
  Stabilized startup keyboard/manual-input routing behavior.
- `a2c3d85` `Checkpoint virtual keyboard timeline guide state`
  Began the virtual keyboard migration so bold vs desaturated key states can
  be driven from timeline/current-input state instead of old required-note
  overlap.
- `0295ba9` `Checkpoint playback lifecycle refactor`
  Centralized more playback lifecycle behavior and timeline note-bucket
  selection.
- `5037452` `Update Codex prompt for wait mode refactor`
  Captured the new wait-mode product direction before changing behavior.

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
- A first-pass congratulations scorecard exists for non-loop live runs.
- Debug short-run scorecard testing exists via the timed-live debug panel.
- Shared `playbackTimeline` infrastructure now exists in
  `src/app/play/playback-timeline.ts`.
- Realtime computer playback uses `playbackTimeline` rather than the old
  mixed cursor-derived `computerNotesService.playRequiredNotes(...)` path.
- Virtual keyboard state is now largely snapshot-driven rather than reading
  `NotesService` directly:
  - bold keys represent actual held input / computer keydown
  - desaturated keys are moving toward timeline-driven guide state
- Backing-track notes are now separated from visible/computer-piano playback
  more reliably in the known multi-track repro.
- Playback tie spans across barlines are working again in the known bars 25-26
  repro.
- Stop/release behavior for long backing notes is improved; the known stuck
  backing-note-on-stop issue was fixed.
- A shared playback-lifecycle helper layer now exists in `play.page.ts` for:
  - legacy service-driven note playback
  - timeline-driven note playback
- Wait mode has now started its migration onto `playbackTimeline`:
  - start validation requires at least one human-controlled hand
  - the warning is intentionally shown on pressing `Play`, not on toggling
    wait mode on
  - metronome/count-in are disabled in wait mode
  - the grey cursor is hidden in wait mode
  - wait-mode progression is now based on current timeline event notes for the
    enabled human-controlled hands
  - tie continuations no longer block wait-mode step progression
  - retrigger release handling

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

### 7. Playback timeline refactor is the next architectural step

The current multi-track/backing-track timing work exposed an architectural weakness:

- autoplay timing is still too dependent on OSMD cursor iteration
- visible-practice timing and backing-track timing are still partially coupled
- tactical scheduler filtering improved some measures but remains fragile,
  especially around ties and mixed visible/backing content

The next session should strongly consider replacing cursor-step-driven timed
playback with an explicit score-derived playback timeline.

The intended model is:

- one shared score timeline with stable event/note identities
- a visible/practice view of that timeline for:
  - green cursor timing
  - visible autoplay timing
  - human note matching/classification
- a backing view of that same timeline for:
  - backing audio only

Important architectural rule:

- backing tracks may contribute audio, but they must not decide when the main
  timed transport advances

Detailed implementation shape:

- introduce a real score-timeline module, likely in a new file such as
  `src/app/play/playback-timeline.ts`
- define stable structures such as:
  - `PlaybackEvent`
  - `TimelineNote`
  - optionally `RenderedTimelineAnchor`
- build the timeline from score data once after:
  - score load
  - reroute / hand remapping
  - loop or range change
  - any other operation that changes the playable score subset

Each event/note should carry enough data that later systems do not need to
rediscover ownership or timing from cursor iteration. Include:

- event id
- timestamp
- measure / beat
- note id
- pitch
- duration / end timestamp
- hand assignment
- backing vs visible role
- tie metadata
- rendered-note lookup keys if available

Split the timeline into roles:

- visible timeline
  - drives green cursor timing
  - drives visible autoplay timing
  - drives human note matching / classification
- backing timeline
  - drives backing audio only
- both should come from the same underlying score event model

Migration plan:

1. Introduce the timeline model without changing live behavior yet.
- Build `PlaybackEvent[]` / `TimelineNote[]`.
- Log and inspect them beside the current cursor-based behavior.
- Prove that they match intended score moments before swapping consumers.

2. Move timed autoplay onto the new timeline first.
- This is the safest first consumer.
- Stop using OSMD cursor iteration for playback timing.
- Keep OSMD only for rendering and screen geometry.

3. Add a render map after OSMD renders.
- Build a map from timeline note/event ids to screen positions.
- On resize/rerender, rebuild only this render map.
- Do not rebuild the musical timeline unless score/routing/range changed.

4. Drive green cursor rendering from:
- timeline timestamp
- plus render-map interpolation

5. Move human matching/classification onto the same timeline.
- Early/late/hit/miss/mistake should all match against stable `TimelineNote`
  identities.
- This should simplify note coloring and scorecard logic substantially.

6. Retire legacy cursor-driven required-note state gradually.
- Keep compatibility shims while migrating one subsystem at a time.
- Do not try to replace everything in one patch.

Why this should help:

- autoplay, green cursor timing, and human matching all consume the same
  score-time truth
- backing becomes a sidecar consumer of timeline events instead of a transport
  driver
- stable note identities should reduce complexity in matching / note
  classification / coloring code
- resize and rerender handling should become cleaner because only the render
  map needs rebuilding when geometry changes

Recommended first phase for the next session:

- introduce timeline types such as `PlaybackEvent` / `TimelineNote`
- build them from score data after load, reroute, or range change
- log/inspect them beside the current cursor-based behavior before swapping
  over live logic
- start by moving timed autoplay only
- leave compatibility shims in place for the older cursor-driven systems until
  each subsystem has migrated

Expected benefits:

- more reliable multi-track timing
- stable note identities for hit/early/late/missed/mistake classification
- simpler note-coloring and scorecard bookkeeping
- cleaner separation between score-time truth and rendered-position truth

Current checkpoint status before that refactor:

- multi-track hand routing and backing playback exist
- playback trace tooling exists in the timed debug panel
- a first scheduler split now tries to advance timed playback on visible score
  content rather than backing-only content
- that split improved measure 25 in a known repro, but measure 26 is still not
  fully correct
- treat the current scheduler filtering as a tactical bridge, not the target
  architecture

### 8. The timeline migration is partially complete, not finished

The architecture shift has started, but the codebase is in a mixed state:

- `playbackTimeline` now exists and is already used by:
  - realtime computer playback
  - parts of realtime matching identity/dedupe
  - some required-note / next-step prediction logic in timed-live realtime mode
- `timedLiveCursorTimeline` still exists and is still used for:
  - visible green cursor geometry/interpolation
  - rendered note placement / feedback placement
  - some timed-live note lookup glue
- `notesService` is still partially involved in realtime input bookkeeping
  even though score-time truth is starting to come from `playbackTimeline`

Important rule for future work:

- avoid reintroducing new cursor-derived logic if the same behavior can be
  expressed using stable `playbackTimeline` note/event identity

Important companion rule:

- while legacy code still exists, keep it behind an explicit legacy boundary
  instead of inlining `notesService` usage everywhere
- the goal is to make the remaining dependency obvious enough to port/remove,
  not to cosmetically flatten it

### 9. Known deferred issues after the recent timeline work

These came up after the last prompt refresh and should be remembered for future
sessions.

#### Same-pitch repeated-note matcher policy is still unresolved

There is a tricky realtime classification case with repeated same-pitch notes
or chords, especially repeated eighth-note chords:

- if the player is slightly late on the first repeated chord, the system can
  still feel like it is matching against the "wrong" note in the sequence
- this is partly about timing-window width and partly about candidate-selection
  policy
- the current behavior sits in an uncomfortable middle ground: pure nearest
  timestamp distance is not always musically satisfying, but adding too much
  tactical matcher logic before the rearchitecture is complete risks more
  churn

#### Tie-continuation feedback classification is still incomplete

- tied playback duration across barlines has been fixed
- but visual/classification behavior for held tie continuations is still not a
  finished system
- future work should likely solve this from stable tie-chain / playback-note
  identity, not pitch-only held-key memory

### 10. Wait mode should be redefined, not blindly ported

Wait mode is now expected to follow these product rules:

- wait mode is for finger-position practice, not time training
- the green cursor remains the only cursor source of truth
- the old grey cursor / expected-position cursor is deprecated in wait mode
- backing tracks should not play in wait mode
- computer-controlled hand tracks should not autoplay in wait mode
- loops must still work in wait mode for short-section drilling
- metronome is probably unnecessary in wait mode and should default off

#### Hand / control rules

- left and right hands must respect the existing hand enable controls
- enabled human-controlled hands should be the only ones that block step
  advancement
- if both hands are enabled for the user, one hand must not advance past a
  step that still requires the other hand
- if one hand has an earlier timeline step than the other, that earlier step
  must be satisfied first
- if both hands are set to computer in wait mode, the app should not start
  normally; show a clear explicit message instead of inventing strange
  behavior

#### Tie / hold rule

- tied continuations should not block wait-mode progression
- for wait mode, progression should be based on the current step's playable
  onset notes rather than requiring held tie continuations
- holding a tied note must never count as a failure by itself

#### Visual / keyboard rule

- virtual keyboard guide behavior in wait mode should show the current required
  step only, not future notes
- this should align with the same step the green cursor is currently pointing at

#### Architectural direction for wait mode

The next meaningful legacy-removal step is likely:

- replace wait-mode / non-timed progression with `playbackTimeline` step truth
- advance a timeline step pointer when the current required visible notes are
  satisfied
- move OSMD cursor/render state to follow that step, instead of using
  `notesService.calculateRequired(...)` as the source of truth

Current implementation progress:

- wait mode has begun this migration
- current required wait notes are now taken from the current
  `playbackTimeline` event for the enabled human-controlled hands
- non-human hands should not block progression
- tie continuations are intentionally excluded from wait progression
- remaining work is mainly cursor/bootstrap cleanup and full removal of the
  remaining legacy wait-mode branches

This is probably the largest remaining reason `notesService` still exists in
normal play behavior.

Current recommendation:

- treat repeated same-pitch matcher refinement as deferred until the broader
  timeline migration is more complete
- when revisiting it, use stable playback-note identity and explicitly decide
  the intended policy for:
  - unresolved previous same-pitch note
  - future same-pitch note
  - overlapping early/late consideration windows

Do not assume "closest by absolute timestamp" is automatically the desired
musical rule.

#### Tie-continuation feedback classification is still incomplete

Playback tie spans are fixed, but tie-continuation feedback/rendering in
realtime classification is not fully solved yet:

- tie continuations should turn green when the tied note chain was accepted and
  the key is still held
- tie continuations should turn red when the held note was released too early
- current behavior improved somewhat, but still does not fully classify held
  tie continuations correctly

Current recommendation:

- defer full tie-continuation feedback polish until the remaining human/realtime
  rearchitecture is further along
- when revisiting it, solve it from tie-chain / stable-note identity, not only
  by pitch-based held-key memory

#### Main lesson from the recent regressions

Several regressions after the recent timeline work came from mixing:

- pitch identity
- rendered/timed-live note identity
- stable playback note identity

Future sessions should prefer:

- `playbackTimeline` for score-time truth and note identity
- `timedLiveCursorTimeline` only for rendered cursor/note placement
- explicit tie-chain identity when reasoning about held continuations

If a bug involves a note turning green and later red, or a repeated same-pitch
note matching the "wrong" score note, first check whether the code is using:

- pitch only
- render-event index
- or stable playback-note identity

Most of the recent regressions were caused by those three notions drifting out
of sync.

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
