import { ChangeDetectorRef, Component } from '@angular/core';

import { NotesService } from '../notes.service';

export interface PianoKeyboardVisualState {
  autoPressedKeys: Set<string>;
  fingerByKey: Map<string, string>;
  pressedKeys: Set<string>;
  staffByKey: Map<string, string>;
  sustainedKeys: Set<string>;
  targetKeys: Set<string>;
}

@Component({
  selector: 'app-piano-keyboard',
  templateUrl: './piano-keyboard.component.html',
  styleUrls: ['./piano-keyboard.component.scss'],
})
export class PianoKeyboardComponent {
  // Piano keyboard
  keys: string[] = [];
  keyStates: string[] = [];
  keyFingers: string[] = [];
  keyStaffs: string[] = [];

  constructor(
    private notesService: NotesService,
    private changeDetectorRef: ChangeDetectorRef
  ) {
    // Initialize keboard to unpressed
    for (let i = 0; i < 88; i++) {
      this.keyStates.push('unpressed');
      this.keyFingers.push('');
    }
    // Generate keyboard
    this.keys = this.keys.concat(['white a', 'black as ', 'white b']);
    for (let i = 0; i < 7; i++) {
      this.keys = this.keys.concat([
        'white c',
        'black cs',
        'white d',
        'black ds',
        'white e',
        'white f',
        'black fs',
        'white g',
        'black gs',
        'white a',
        'black as',
        'white b',
      ]);
    }
    this.keys = this.keys.concat(['white c']);
  }

  // Update note status for piano keyboard
  updateNotesStatus(visualState?: PianoKeyboardVisualState | null): void {
    for (let i = 0; i < 88; i++) {
      this.keyStates[i] = 'unpressed';
      this.keyFingers[i] = '';
      this.keyStaffs[i] = '';
    }
    if (visualState) {
      this.updateNotesStatusFromVisualState(visualState);
      return;
    }

    if (this.notesService.getMapRequired().size) {
      for (const [key] of this.notesService.getMapPressed()) {
        let value;
        const idx = parseInt(key) - 9;
        if (
          this.notesService.getMapRequired().has(key) &&
          this.notesService.getMapPrevRequired().has(key)
        ) {
          this.keyStates[idx] = 'pressedkeep';
          value = this.notesService.getMapRequired().get(key);
        } else if (this.notesService.getMapRequired().has(key)) {
          this.keyStates[idx] = 'pressed';
          value = this.notesService.getMapRequired().get(key);
        } else if (this.notesService.getMapPrevRequired().has(key)) {
          this.keyStates[idx] = 'pressed';
          value = this.notesService.getMapPrevRequired().get(key);
        } else {
          this.keyStates[idx] = 'pressedwrong';
        }

        if (value && value.key !== '0') {
          this.keyStaffs[idx] = `${this.keyStates[idx]}__staff${value.staffId}`;
        }
      }

      for (const [key, value] of this.notesService.getMapRequired()) {
        if (value.key === '0') {
          continue;
        }

        const idx = parseInt(key) - 9;
        if (value.value === 0) {
          if (this.keyStates[idx] == 'unpressed') {
            this.keyStates[idx] = 'unpressedreq';
          } else if ((this.notesService.getMapPressed().get(key) ?? -1) > 1) {
            this.keyStates[idx] = 'pressedreq';
          }
        }

        this.keyFingers[idx] = value.fingering;
        this.keyStaffs[idx] = `${this.keyStates[idx]}__staff${value.staffId}`;
      }
    } else {
      for (const [key] of this.notesService.getMapPressed()) {
        this.keyStates[parseInt(key) - 9] = 'pressed';
      }
    }

    this.changeDetectorRef.detectChanges();
  }

  private updateNotesStatusFromVisualState(
    visualState: PianoKeyboardVisualState
  ): void {
    for (const key of visualState.pressedKeys) {
      const idx = parseInt(key) - 9;
      if (!Number.isFinite(idx) || idx < 0 || idx >= this.keyStates.length) {
        continue;
      }

      if (visualState.targetKeys.has(key)) {
        this.keyStates[idx] = 'pressed';
      } else if (
        visualState.sustainedKeys.has(key) ||
        visualState.autoPressedKeys.has(key)
      ) {
        this.keyStates[idx] = 'pressedkeep';
      } else {
        this.keyStates[idx] = 'pressedwrong';
      }

      const finger = visualState.fingerByKey.get(key) ?? '';
      const staff = visualState.staffByKey.get(key) ?? '';
      this.keyFingers[idx] = finger;
      this.keyStaffs[idx] = staff ? `${this.keyStates[idx]}__staff${staff}` : '';
    }

    for (const key of visualState.targetKeys) {
      const idx = parseInt(key) - 9;
      if (!Number.isFinite(idx) || idx < 0 || idx >= this.keyStates.length) {
        continue;
      }

      if (this.keyStates[idx] === 'unpressed') {
        this.keyStates[idx] = 'unpressedreq';
      }

      const finger = visualState.fingerByKey.get(key) ?? '';
      const staff = visualState.staffByKey.get(key) ?? '';
      if (finger) {
        this.keyFingers[idx] = finger;
      }
      if (staff) {
        this.keyStaffs[idx] = `${this.keyStates[idx]}__staff${staff}`;
      }
    }
  }
}
