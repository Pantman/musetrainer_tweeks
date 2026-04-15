import { Injectable } from '@angular/core';
import { Cursor } from 'opensheetmusicdisplay';

export type NoteObject = {
  value: number;
  key: string;
  timestamp: number;
  staffId: number;
  voice: number;
  fingering: string;
  isGrace: boolean;
  midiInstrumentId: number | null;
};

@Injectable({
  providedIn: 'root',
})
export class NotesService {
  static readonly DEFAULT_TEMPO_BPM = 120;
  mapPressed: Map<string, number> = new Map();
  // Initialize maps of notes comming from Music Sheet
  mapRequired = new Map<string, NoteObject>();
  mapPrevRequired = new Map<string, NoteObject>();
  tempoInBPM: number;

  constructor() {
    this.tempoInBPM = NotesService.DEFAULT_TEMPO_BPM;
  }

  getMapRequired(): Map<string, NoteObject> {
    return this.mapRequired;
  }

  getMapPrevRequired(): Map<string, NoteObject> {
    return this.mapPrevRequired;
  }

  getMapPressed(): Map<string, number> {
    return this.mapPressed;
  }

  clear(): void {
    this.mapPressed.clear();
    this.mapRequired.clear();
    this.mapPrevRequired.clear();
  }

  press(name: string): void {
    this.mapPressed.set(name, 1);
  }

  release(name: string): void {
    this.mapPressed.delete(name);
  }

  private mergeRequiredNote(
    noteString: string,
    noteObj: NoteObject,
    isFreshAttack: boolean
  ): void {
    const existing = this.mapRequired.get(noteString);
    if (!existing) {
      this.mapRequired.set(noteString, {
        ...noteObj,
        value: isFreshAttack ? 0 : 1,
      });
      return;
    }

    // Multi-track playback can legitimately produce the same pitch from more
    // than one track at the same cursor timestamp. When that happens, the
    // pitch should stay active until the latest matching note ends, rather
    // than letting a shorter backing-track note overwrite and truncate a
    // longer foreground note. We therefore merge duplicate pitch entries by
    // keeping the furthest end timestamp and the "freshest" attack state.
    this.mapRequired.set(noteString, {
      ...existing,
      ...noteObj,
      timestamp: Math.max(existing.timestamp, noteObj.timestamp),
      value: Math.min(existing.value, isFreshAttack ? 0 : 1),
      midiInstrumentId:
        existing.midiInstrumentId ?? noteObj.midiInstrumentId,
    });
  }

  // Check that new notes have been pressed since the last succesful check (value===1)
  private isNewRequiredNotesPressed(): boolean {
    for (const [, noteObj] of this.mapRequired) {
      if (noteObj.value === 0) {
        if (this.mapPressed.has(noteObj.key)) {
          if ((this.mapPressed.get(noteObj.key) ?? -1) > 1) return false;
        } else {
          return false;
        }
      }
    }
    return true;
  }

  // Check required notes, if successful go to next cursor
  isRequiredNotesPressed(): boolean {
    // Check only new notes, hold notes with pedals would be to difficult
    if (this.isNewRequiredNotesPressed() === true) {
      // Check that no pressed key is unexpected (red key)
      for (const [key] of this.mapPressed) {
        if (!this.mapRequired.has(key)) return false;
      }

      // Mark all the notes as no longer new, go to next cycle
      for (const [key, value] of this.mapPressed) {
        this.mapPressed.set(key, value + 1);
      }

      return true;
    }
    return false;
  }

  // Calculate required notes deleting outphased onces and keeping track of new notes
  calculateRequired(
    cursor: Cursor,
    staffIdEnabled: Record<number, boolean>,
    back = false,
    instruments: any[] | null = null
  ): void {
    // Get current source time stamp
    const timestamp = cursor.iterator.CurrentSourceTimestamp.RealValue;

    // Keep track of previous to avoid red keys before release, increment value
    this.mapPrevRequired.clear();
    for (const [key, noteObj] of this.mapRequired) {
      this.mapPrevRequired.set(key, noteObj);
      this.mapRequired.set(key, { ...noteObj, value: noteObj.value + 1 });
    }

    // Delete expired notes
    for (const [key, value] of this.mapRequired) {
      if (back || timestamp >= value.timestamp) {
        this.mapRequired.delete(key);
      }
    }

    // Register new notes under the cursor
    const visibleVoices = cursor.VoicesUnderCursor() ?? [];
    const extraInstrumentVoices =
      instruments && instruments.length > 0
        ? instruments.flatMap((instrument) => {
            const audibleVoices =
              cursor?.iterator?.CurrentAudibleVoiceEntries?.(instrument) ?? [];
            return audibleVoices.length > 0
              ? audibleVoices
              : cursor.VoicesUnderCursor(instrument) ?? [];
          })
        : [];
    // Hidden backing tracks still need to contribute audible notes even when
    // OSMD is only rendering the visible practice tracks. We therefore start
    // with the normal visible voices under the cursor, then append any
    // explicitly requested instrument voices for hidden backing parts.
    const voices = Array.from(
      new Set([...visibleVoices, ...extraInstrumentVoices])
    );

    voices.forEach((voice) => {
      voice.Notes.forEach((value) => {
        const tempoInBPM = value.SourceMeasure.TempoInBPM;
        // Imported scores do not always provide a usable tempo on every measure.
        // Keep the last valid tempo so playback does not collapse into 0 ms timeouts.
        if (Number.isFinite(tempoInBPM) && tempoInBPM > 0) {
          this.tempoInBPM = tempoInBPM;
        }
        // value.ParentStaff.idInMusicSheet = 0,1,2,3
        // value.ParentStaff.Id = 1,2
        if (staffIdEnabled[value.ParentStaff.idInMusicSheet]) {
          // Only honor rests in listen mode
          if (value.isRest() === false) {
            const noteString = value.halfTone.toString();
            const noteTimestamp = timestamp + value.Length.RealValue;
            const fingering = value.Fingering ? value.Fingering.value : '';
            const midiInstrumentId = this.getMidiInstrumentIdForSourceNote(value);

            const noteObj = {
              value: 0,
              key: noteString,
              timestamp: noteTimestamp,
              staffId: value.ParentStaff.Id,
              voice: voice.ParentVoice.VoiceId,
              fingering: fingering,
              isGrace: value.IsGraceNote,
              midiInstrumentId,
            };

            // In case of tie, check that it is a start note
            this.mergeRequiredNote(
              noteString,
              noteObj,
              typeof value.NoteTie === 'undefined' ||
                value === value.NoteTie.StartNote
            );
          }
        }
      });
    });
  }

  // Update note status for piano keyboard
  playRequiredNotes(
    notePress: (note: number, velocity: number, noteObj: NoteObject) => void,
    noteRelease: (
      note: number,
      noteObj: NoteObject | null,
      retrigger?: boolean
    ) => void
  ): void {
    // Release notes no longer required
    for (const [key] of this.mapPressed) {
      if (!this.mapRequired.has(key)) {
        noteRelease(parseInt(key) + 12, this.mapPrevRequired.get(key) ?? null);
      }
    }

    // Press new notes
    for (const [key, value] of this.mapRequired) {
      if (value.value === 0) {
        // If already pressed, release first
        if (this.mapPressed.has(key)) {
          noteRelease(parseInt(key) + 12, value, true);
        }
        notePress(parseInt(key) + 12, 60, value);
      }
    }
  }

  private getMidiInstrumentIdForSourceNote(note: any): number | null {
    const parentInstrument = note?.ParentStaff?.ParentInstrument;
    const playbackInstrumentId = note?.PlaybackInstrumentId;
    const matchingSubInstrument = (parentInstrument?.SubInstruments ?? []).find(
      (subInstrument: any) => subInstrument?.idString === playbackInstrumentId
    );
    const candidates = [
      matchingSubInstrument?.midiInstrumentID,
      parentInstrument?.MidiInstrumentId,
      parentInstrument?.SubInstruments?.[0]?.midiInstrumentID,
    ];
    const midiInstrumentId = candidates.find((value) => Number.isFinite(value));

    return Number.isFinite(midiInstrumentId) ? Number(midiInstrumentId) : null;
  }
}
