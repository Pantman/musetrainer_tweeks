export type PlaybackTimelineRole = 'visible' | 'backing';

export type PlaybackTimelineHandAssignment =
  | 'left'
  | 'right'
  | 'both'
  | 'unassigned';

export interface PlaybackTimelineTieMetadata {
  tieId: string | null;
  isStart: boolean;
  isStop: boolean;
  isContinuation: boolean;
}

export interface PlaybackTimelineRenderedLookupKey {
  measureNumber: number;
  timestamp: number;
  halfTone: number;
  staffId: number | null;
  sourceNoteId: string | null;
}

export interface TimelineNote {
  id: string;
  eventId: string;
  timestamp: number;
  endTimestamp: number;
  durationWholeNotes: number;
  measureNumber: number;
  beatInMeasure: number;
  halfTone: number;
  staffId: number | null;
  voiceId: number | null;
  handAssignment: PlaybackTimelineHandAssignment;
  role: PlaybackTimelineRole;
  noteId: string | null;
  midiInstrumentId: number | null;
  instrumentIndex: number | null;
  instrumentName: string | null;
  tie: PlaybackTimelineTieMetadata;
  renderedLookupKey: PlaybackTimelineRenderedLookupKey | null;
}

export interface PlaybackEvent {
  id: string;
  timestamp: number;
  measureNumber: number;
  beatInMeasure: number;
  visibleNotes: TimelineNote[];
  backingNotes: TimelineNote[];
  allNotes: TimelineNote[];
}

export interface PlaybackTimelineRange {
  lower: number;
  upper: number;
}

export interface PlaybackTimelineSummary {
  visibleEventCount: number;
  backingEventCount: number;
  visibleNoteCount: number;
  backingNoteCount: number;
}

export interface PlaybackTimeline {
  range: PlaybackTimelineRange;
  startTimestamp: number;
  endTimestamp: number;
  events: PlaybackEvent[];
  notes: TimelineNote[];
  summary: PlaybackTimelineSummary;
  builtAt: number;
}

export interface PlaybackEventSeed {
  timestamp: number;
  measureNumber: number;
  beatInMeasure: number;
  visibleNotes: Omit<TimelineNote, 'id' | 'eventId'>[];
  backingNotes: Omit<TimelineNote, 'id' | 'eventId'>[];
}

export interface PlaybackTimelineBuildInput {
  range: PlaybackTimelineRange;
  startTimestamp: number;
  endTimestamp: number;
  builtAt?: number;
  events: PlaybackEventSeed[];
}

export function buildPlaybackTimeline(
  input: PlaybackTimelineBuildInput
): PlaybackTimeline {
  const sortedSeeds = [...input.events].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }

    return left.measureNumber - right.measureNumber;
  });

  const events: PlaybackEvent[] = sortedSeeds.map((seed, eventIndex) => {
    const eventId = createPlaybackEventId(
      seed.measureNumber,
      seed.timestamp,
      eventIndex
    );
    const visibleNotes = seed.visibleNotes.map((note, noteIndex) =>
      createTimelineNote(note, eventId, noteIndex, 'visible')
    );
    const backingNotes = seed.backingNotes.map((note, noteIndex) =>
      createTimelineNote(note, eventId, noteIndex, 'backing')
    );

    return {
      id: eventId,
      timestamp: seed.timestamp,
      measureNumber: seed.measureNumber,
      beatInMeasure: seed.beatInMeasure,
      visibleNotes,
      backingNotes,
      allNotes: [...visibleNotes, ...backingNotes],
    };
  });

  const notes = events.flatMap((event) => event.allNotes);
  const summary: PlaybackTimelineSummary = {
    visibleEventCount: events.filter((event) => event.visibleNotes.length > 0).length,
    backingEventCount: events.filter((event) => event.backingNotes.length > 0).length,
    visibleNoteCount: events.reduce(
      (count, event) => count + event.visibleNotes.length,
      0
    ),
    backingNoteCount: events.reduce(
      (count, event) => count + event.backingNotes.length,
      0
    ),
  };

  return {
    range: input.range,
    startTimestamp: input.startTimestamp,
    endTimestamp: input.endTimestamp,
    events,
    notes,
    summary,
    builtAt: input.builtAt ?? Date.now(),
  };
}

function createPlaybackEventId(
  measureNumber: number,
  timestamp: number,
  eventIndex: number
): string {
  return `playback-event-${measureNumber}-${timestamp.toFixed(6)}-${eventIndex}`;
}

function createTimelineNote(
  note: Omit<TimelineNote, 'id' | 'eventId'>,
  eventId: string,
  noteIndex: number,
  role: PlaybackTimelineRole
): TimelineNote {
  return {
    ...note,
    eventId,
    role,
    id: `${eventId}-${role}-note-${noteIndex}`,
  };
}
