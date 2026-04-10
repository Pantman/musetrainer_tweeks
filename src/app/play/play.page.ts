import { Component, HostListener, OnInit, ViewChild } from '@angular/core';
import {
  IonContent,
  NavController,
  Platform,
  RefresherCustomEvent,
  ToastController,
} from '@ionic/angular';
import { Piano } from '@tonejs/piano';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { CapacitorMuseTrainerMidi } from 'capacitor-musetrainer-midi';
import { ActivatedRoute } from '@angular/router';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { now as toneNow, start as startTone, Synth } from 'tone';

import { NotesService } from '../notes.service';
import { PianoKeyboardComponent } from '../piano-keyboard/piano-keyboard.component';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import packageJson from '../../../package.json';

declare const Ionic: any;

type TempoPreset = 'normal' | 'slow' | 'verySlow' | 'custom';
type RangeHandle = 'start' | 'end';

interface MeasureOverlay {
  measureNumber: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface MeasureRange {
  lower: number;
  upper: number;
}

interface PracticeGraphicalNote {
  graphicalNote: any;
  anchorElement: SVGElement;
  groupElement: SVGElement;
  halfTone: number;
}

interface PlayCursorLoopWrapAnimation {
  boundaryTimeMs: number;
  boundaryDurationMs: number;
  finalNoteBaseLeft: number;
  finalNoteX: number;
  endBarlineX: number;
  restarted: boolean;
  restartBaseLeft: number | null;
  restartDurationMs: number;
  startBarlineX: number;
  firstNoteX: number;
}

interface CursorDebugMarker {
  id: string;
  left: number;
  top: number;
  height: number;
  timestamp: number;
  durationToNext: number;
  measureNumber: number;
  actionable: boolean;
}

interface CursorWrapDebugSnapshot {
  measureNumber: number;
  timestamp: number;
  actionable: boolean;
  targetX: number | null;
  actionableTargets: number[];
  allTargets: number[];
  noteTargets: string[];
  baseLeft: number | null;
  renderedLeft: number | null;
  renderedTop: number | null;
}

interface RealtimeDebugStats {
  playedTotal: number;
  acceptedOnTime: number;
  acceptedLate: number;
  early: number;
  rejected: number;
  missedExpected: number;
  lastPitch: string;
  lastResult: string;
  toleranceMs: number;
  lateWindowRemainingMs: number;
}

@Component({
  selector: 'app-home',
  templateUrl: 'play.page.html',
  styleUrls: ['play.page.scss'],
})
export class PlayPageComponent implements OnInit {
  private static readonly DEFAULT_TEMPO_BPM = 120;
  private static readonly OSMD_UNIT_IN_PIXELS = 10;
  private static readonly MIN_SPEED_PERCENT = 30;
  private static readonly MAX_SPEED_PERCENT = 180;
  private static readonly TEMPO_STEP_BPM = 5;
  private static readonly AUDIO_SCHEDULE_AHEAD_SEC = 0.05;
  private static readonly REALTIME_ACCEPT_TOLERANCE_WHOLE_NOTES = 1 / 4;
  private static readonly FEEDBACK_CORRECT_COLOR = '#16a34a';
  private static readonly FEEDBACK_ERROR_COLOR = '#dc2626';
  private static readonly ENABLE_CURSOR_TRACE = false;
  @ViewChild(IonContent, { static: false }) content!: IonContent;
  @ViewChild(PianoKeyboardComponent)
  private pianoKeyboard?: PianoKeyboardComponent;
  openSheetMusicDisplay!: OpenSheetMusicDisplay;

  playVersion = '';

  // Music Sheet GUI
  isMobileLayout = false;
  staffIdList: number[] = [];
  staffIdEnabled: Record<number, boolean> = {};
  listenMode: boolean = false;
  fileLoadError: boolean = false;
  fileLoaded: boolean = false;
  running: boolean = false;
  checkboxColor: boolean = false;
  checkboxKeyboard: boolean = true;
  checkboxMidiOut: boolean = false;
  checkboxMetronome: boolean = true;
  checkboxWaitMode: boolean = false;
  checkboxFeedback: boolean = true;
  showRangePicker: boolean = false;
  inputMeasure = { lower: 0, upper: 0 };
  inputMeasureRange = { lower: 0, upper: 0 };
  measureOverlays: MeasureOverlay[] = [];
  checkboxRepeat: boolean = false;
  savedLoopRange: MeasureRange | null = null;
  loopPass: number = 0;
  zoomValue: number = 1;
  zoomText: string = '100%';
  startFlashCount: number = 0;

  // MIDI Devices
  midiAvailable = false;
  midiDevice = 'None';

  // Initialize maps of notes comming from MIDI Input
  mapNotesAutoPressed = new Map();

  // Play
  timePlayStart: number = 0;
  playbackStartScoreTimestamp: number = 0;
  skipPlayNotes: number = 0;
  tempoInBPM: number = 120;
  speedValue: number = 100;
  tempoPreset: TempoPreset = 'normal';
  timeouts: NodeJS.Timeout[] = [];
  realtimeMode: boolean = false;
  currentStepSatisfied: boolean = false;
  debugRealtimeStats: RealtimeDebugStats = {
    playedTotal: 0,
    acceptedOnTime: 0,
    acceptedLate: 0,
    early: 0,
    rejected: 0,
    missedExpected: 0,
    lastPitch: '',
    lastResult: 'none',
    toleranceMs: 0,
    lateWindowRemainingMs: 0,
  };
  suppressPlayCursorAnimation: boolean = false;
  playCursorAlignmentFrame: number | null = null;
  loopStartCursorTargetX: number | null = null;
  loopStartMeasureLeftX: number | null = null;
  playCursorLoopWrapAnimation: PlayCursorLoopWrapAnimation | null = null;
  pendingLoopRestartCursorTeleport: boolean = false;
  suppressPlayCursorAlignmentForStep: boolean = false;
  private lastPlayCursorTransitionDurationMs: number = 0;
  private pendingDeferredTieStepAdvance: boolean = false;
  private activeRangeHandle: RangeHandle | null = null;
  private activeRangeSelectionStart: number | null = null;

  // tonejs/piano
  piano: Piano | null = null;
  metronome: Synth | null = null;
  computerPressedNotes = new Map<string, number>();
  computerNotesService: NotesService;
  private correctNoteheadElements = new Map<string, HTMLElement>();
  private incorrectNoteheadElements = new Map<string, HTMLElement>();
  private activePracticeNoteElements: SVGElement[] = [];
  private activePracticeGraphicalNotes: PracticeGraphicalNote[] = [];
  private realtimePreviousStepKeys = new Set<string>();
  private realtimePreviousStepMatchedKeys = new Set<string>();
  private realtimePreviousStepElements: SVGElement[] = [];
  private realtimePreviousStepGraphicalNotes: PracticeGraphicalNote[] = [];
  private realtimePreviousStepTimestamp = 0;
  private realtimeLateToleranceUntil = 0;
  private realtimeNextStepKeys = new Set<string>();
  private realtimeCurrentStepMatchedKeys = new Set<string>();
  realtimeDebugEvents: string[] = [];
  cursorTraceEvents: string[] = [];
  cursorDebugMarkers: CursorDebugMarker[] = [];
  showCursorDebugOverlay: boolean = true;
  showDebugConsoleOverlay: boolean = false;
  showCursorWrapDebugOverlay: boolean = false;
  cursorWrapDebugEvents: string[] = [];
  cursorWrapDebugSnapshot: CursorWrapDebugSnapshot | null = null;
  private cursorDebugRefreshTimeout: number | null = null;
  // Midi handlers
  midiHandlers: PluginListenerHandle[] = [];

  constructor(
    public platform: Platform,
    public navCtrl: NavController,
    private notesService: NotesService,
    private toastCtrl: ToastController,
    private route: ActivatedRoute
  ) {
    this.computerNotesService = new NotesService();
  }

  ngOnInit(): void {
    this.playVersion = packageJson.version;
    this.openSheetMusicDisplay = new OpenSheetMusicDisplay('osmdContainer');
    this.openSheetMusicDisplay.setOptions({
      backend: 'svg',
      drawTitle: true,
      coloringMode: this.checkboxColor ? 1 : 0,
      followCursor: true,
      useXMLMeasureNumbers: false,
      cursorsOptions: [
        { type: 1, color: '#33e02f', alpha: 0.8, follow: true },
        { type: 2, color: '#ccc', alpha: 0.8, follow: false },
      ],
    });
    // Adjust zoom for mobile devices
    if (window.innerWidth <= 991) {
      this.isMobileLayout = true;
      this.zoomValue = 0.7;
      this.zoomText = this.zoomValue * 100 + '%';
      this.openSheetMusicDisplay.zoom = this.zoomValue;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.fileLoaded) {
      this.refreshMeasureOverlaysDeferred();
    }
  }

  ionViewWillEnter() {
    this.platform.ready().then(() => {
      this.pianoSetup();
      this.metronomeSetup();
      this.midiSetup();
      this.keepAwake();
    });
  }

  ionViewDidEnter() {
    const fileURI =
      this.route.snapshot.paramMap.get('file') ||
      this.route.snapshot.queryParamMap.get('file');
    if (fileURI) {
      const src = Capacitor.convertFileSrc(fileURI);
      if (src.startsWith('/DOCUMENTS') && !Ionic.WebView) {
        Filesystem.readFile({ path: src }).then((file) => {
          fetch(`data:application/octet-stream;base64,${file.data}`).then(
            (res) => res.blob().then((blob) => this.osmdLoadFiles([blob]))
          );
        });
      } else {
        this.osmdLoadURL(src);
      }
    }
  }

  ionViewWillLeave() {
    // osmd
    this.osmdReset();
    this.openSheetMusicDisplay.clear();
    // piano
    this.piano = null;
    this.metronome = null;
    // wake
    this.allowSleep();
    // midi
    this.midiRelease();
  }

  pianoSetup() {
    let url = '/assets/audio';
    if (Ionic.WebView) {
      url = 'capacitor://localhost/assets/audio';
    }

    // create the piano and load 1 velocity steps to reduce memory consumption
    this.piano = new Piano({
      url,
      velocities: 1,
    });

    //connect it to the speaker output
    this.piano.toDestination();
    this.piano.load();
  }

  metronomeSetup() {
    this.metronome = new Synth({
      oscillator: {
        type: 'square',
      },
      envelope: {
        attack: 0.001,
        decay: 0.03,
        sustain: 0,
        release: 0.03,
      },
      volume: -10,
    }).toDestination();
  }

  // GUI Zoom
  updateZoom(qp: string): void {
    this.zoomValue = parseInt(qp) / 100;
    if (isNaN(this.zoomValue)) this.zoomValue = 1;
    if (this.zoomValue < 0.1) this.zoomValue = 0.1;
    if (this.zoomValue > 2) this.zoomValue = 2;
    this.zoomText = (this.zoomValue * 100).toFixed(0) + '%';
    this.openSheetMusicDisplay.Zoom = this.zoomValue;
    this.openSheetMusicDisplay.render();
    this.refreshMeasureOverlaysDeferred();
    this.refreshCursorDebugMarkersDeferred();
  }

  updateTempoPreset(preset: TempoPreset): void {
    this.tempoPreset = preset;

    switch (preset) {
      case 'normal':
        this.speedValue = 100;
        break;
      case 'slow':
        this.speedValue = 75;
        break;
      case 'verySlow':
        this.speedValue = 50;
        break;
      default:
        break;
    }
  }

  adjustTempo(deltaBPM: number): void {
    const nextTempo = this.getEffectiveTempoBPM() + deltaBPM;
    this.setEffectiveTempoBPM(nextTempo);
  }

  setEffectiveTempoBPM(nextTempoBPM: number): void {
    const baseTempo = this.getScoreTempoBPM();
    const clampedTempo = Math.max(nextTempoBPM, 20);
    const nextSpeedPercent = Math.round((clampedTempo / baseTempo) * 100);

    this.speedValue = Math.min(
      Math.max(nextSpeedPercent, PlayPageComponent.MIN_SPEED_PERCENT),
      PlayPageComponent.MAX_SPEED_PERCENT
    );
    this.tempoPreset = 'custom';
  }

  // GUI Repeat
  updateRepeat(): void {
    this.loopPass = 0;
  }

  listMeasure(): number[] {
    const from = this.inputMeasureRange.lower;
    const range = this.inputMeasureRange.upper - from + 1;
    return Array.from(Array(range).keys(), (item) => item + from);
  }

  toggleRangePicker(): void {
    if (this.running || !this.fileLoaded) {
      return;
    }

    if (this.checkboxRepeat || this.showRangePicker) {
      this.clearLoopRange();
    } else {
      this.restoreLoopRange();
    }

    this.refreshMeasureOverlaysDeferred();
  }

  closeRangePicker(): void {
    this.showRangePicker = false;
    this.refreshCursorDebugMarkersDeferred();
  }

  getRangeSummary(): string {
    return `Bars ${this.inputMeasure.lower}-${this.inputMeasure.upper}`;
  }

  isLoopEnabled(): boolean {
    return this.checkboxRepeat || this.showRangePicker;
  }

  getRangeShadedMeasures(): MeasureOverlay[] {
    if (!this.checkboxRepeat) {
      return [];
    }

    return this.measureOverlays.filter(
      (measure) =>
        measure.measureNumber < this.inputMeasure.lower ||
        measure.measureNumber > this.inputMeasure.upper
    );
  }

  getRangeHandleStyle(handle: RangeHandle): Record<string, string> {
    const measure = this.getMeasureOverlayForHandle(handle);
    if (!measure) {
      return {};
    }

    const left = handle === 'start' ? measure.left : measure.right;
    const height = Math.max(measure.bottom - measure.top, 1);

    return {
      left: `${left}px`,
      top: `${Math.max(measure.top - 20, 0)}px`,
      height: `${height + 20}px`,
    };
  }

  getMeasureShadeStyle(measure: MeasureOverlay): Record<string, string> {
    return {
      left: `${measure.left}px`,
      top: `${measure.top}px`,
      width: `${Math.max(measure.right - measure.left, 1)}px`,
      height: `${Math.max(measure.bottom - measure.top, 1)}px`,
    };
  }

  // GUI Lower measure
  updateLowerMeasure(qp: string): void {
    this.inputMeasure.lower = parseInt(qp);
    if (isNaN(this.inputMeasure.lower)) {
      this.inputMeasure.lower = this.inputMeasureRange.lower;
    }
    if (this.inputMeasure.lower < this.inputMeasureRange.lower) {
      this.inputMeasure.lower = this.inputMeasureRange.lower;
    }
    // Push upper if required
    if (this.inputMeasure.lower > this.inputMeasure.upper) {
      if (this.inputMeasure.lower > this.inputMeasureRange.upper) {
        this.inputMeasure.lower = this.inputMeasureRange.upper;
      }
      this.inputMeasure.upper = this.inputMeasure.lower;
    }

    this.syncRepeatToMeasureRange();
  }

  // GUI Upper Measure
  updateUpperMeasure(qp: string): void {
    this.inputMeasure.upper = parseInt(qp);
    if (isNaN(this.inputMeasure.upper)) {
      this.inputMeasure.upper = this.inputMeasureRange.upper;
    }
    if (this.inputMeasure.upper > this.inputMeasureRange.upper) {
      this.inputMeasure.upper = this.inputMeasureRange.upper;
    }
    // Push lower if required
    if (this.inputMeasure.upper < this.inputMeasure.lower) {
      if (this.inputMeasure.upper < this.inputMeasureRange.lower) {
        this.inputMeasure.upper = this.inputMeasureRange.lower;
      }
      this.inputMeasure.lower = this.inputMeasure.upper;
    }

    this.syncRepeatToMeasureRange();
  }

  updateRangeStart(qp: string): void {
    this.updateLowerMeasure(qp);
  }

  updateRangeEnd(qp: string): void {
    this.updateUpperMeasure(qp);
  }

  startRangeHandleDrag(handle: RangeHandle, event: PointerEvent): void {
    if (!this.showRangePicker || this.running) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.activeRangeHandle = handle;
    this.updateRangeHandleFromPointer(handle, event);
    window.addEventListener('pointermove', this.onRangeHandlePointerMove);
    window.addEventListener('pointerup', this.onRangeHandlePointerUp);
  }

  startRangeSelection(event: PointerEvent): void {
    if (this.running || !this.fileLoaded) {
      return;
    }

    event.preventDefault();
    const measure = this.findClosestMeasureOverlayAtPointer(event);
    if (!measure) {
      return;
    }

    this.activeRangeSelectionStart = measure.measureNumber;
    this.applyDraggedRange(measure.measureNumber, measure.measureNumber);
    window.addEventListener('pointermove', this.onRangeSelectionPointerMove);
    window.addEventListener('pointerup', this.onRangeSelectionPointerUp);
  }

  // Load selected file
  osmdLoadFiles(files: Blob[]): void {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const reader = new FileReader();
      reader.onload = (event: ProgressEvent<FileReader>) => {
        // Load Music Sheet
        this.openSheetMusicDisplay
          .load(event.target?.result?.toString() ?? '')
          .then(
            () => {
              this.openSheetMusicDisplay.zoom = this.zoomValue;
              this.openSheetMusicDisplay.render();
              this.fileLoaded = true;
              this.fileLoadError = false;
              this.osmdReset();
              this.refreshMeasureOverlaysDeferred();
            },
            () => {
              this.fileLoaded = false;
              this.fileLoadError = true;
            }
          );
      };
      reader.readAsBinaryString(file);
    }
  }

  // Load selected file
  osmdLoadURL(url: string): void {
    // Load Music Sheet
    this.openSheetMusicDisplay.load(url).then(
      () => {
        this.openSheetMusicDisplay.zoom = this.zoomValue;
        this.openSheetMusicDisplay.render();
        this.fileLoaded = true;
        this.fileLoadError = false;
        this.osmdReset();
        this.refreshMeasureOverlaysDeferred();
      },
      () => {
        this.fileLoaded = false;
        this.fileLoadError = true;
      }
    );
  }

  startTransport(): void {
    void startTone().catch(() => undefined);
    this.updateRepeat();
    this.osmdStop();
    if (this.checkboxWaitMode) {
      this.osmdPractice();
      return;
    }
    if (this.isRealtimePlaybackOnly()) {
      this.osmdListen();
      return;
    }
    this.osmdPracticeRealtime();
  }

  isListening(): boolean {
    return this.running && this.listenMode;
  }

  isPracticing(): boolean {
    return this.running && !this.listenMode;
  }

  canStartTransport(): boolean {
    if (!this.fileLoaded) {
      return false;
    }

    if (this.checkboxWaitMode) {
      return this.midiAvailable;
    }

    return this.isRealtimePlaybackOnly() || this.midiAvailable;
  }

  getTransportLabel(): string {
    if (this.running) {
      return 'STOP';
    }

    return 'PLAY';
  }

  getStaffToggleLabel(id: number): string {
    if (this.checkboxWaitMode) {
      return `Staff ${id + 1}`;
    }

    return `Computer staff ${id + 1}`;
  }

  getStaffToolbarIcon(id: number): string {
    if (id === 0) {
      return 'hand-right-outline';
    }

    if (id === 1) {
      return 'hand-left-outline';
    }

    return 'musical-note-outline';
  }

  getStaffToolbarLabel(id: number): string {
    if (id === 0) {
      return 'Staff 1';
    }

    if (id === 1) {
      return 'Staff 2';
    }

    return `Staff ${id + 1}`;
  }

  toggleWaitMode(): void {
    this.checkboxWaitMode = !this.checkboxWaitMode;

    if (this.checkboxWaitMode) {
      this.staffIdEnabled = this.staffIdList.reduce(
        (selection, id) => ({
          ...selection,
          [id]: true,
        }),
        {} as Record<number, boolean>
      );
    }
  }

  clearFeedback(): void {
    this.osmdResetFeedback();
  }

  toggleCursorDebugOverlay(): void {
    this.showCursorDebugOverlay = !this.showCursorDebugOverlay;
    this.refreshCursorDebugMarkersDeferred();
  }

  // Reset selection on measures and set the cursor to the origin
  osmdReset(): void {
    this.osmdStop();
    this.osmdResetFeedback();
    this.inputMeasure.lower = 1;
    this.inputMeasure.upper =
      this.openSheetMusicDisplay.Sheet.SourceMeasures.length;
    this.inputMeasureRange.lower = 1;
    this.inputMeasureRange.upper =
      this.openSheetMusicDisplay.Sheet.SourceMeasures.length;
    this.showRangePicker = false;

    this.staffIdList = this.openSheetMusicDisplay.Sheet.Staves.map(
      (s) => s.idInMusicSheet
    );
    this.staffIdEnabled = this.staffIdList
      .map((id) => ({ [id]: true }))
      .reduce((a, b) => ({ ...a, ...b }));

    this.initializeTempoFromScore();
    this.syncRepeatToMeasureRange();
    this.refreshMeasureOverlaysDeferred();
  }

  osmdStop(): void {
    this.running = false;
    this.realtimeMode = false;
    this.currentStepSatisfied = false;
    this.resetPlayCursorTransition();
    this.osmdCursorStop();
    this.timeouts.map((to) => clearTimeout(to));
    this.timeouts = [];
    this.releaseComputerPressedNotes();
    this.loopStartCursorTargetX = null;
    this.loopStartMeasureLeftX = null;
    this.playCursorLoopWrapAnimation = null;
    this.pendingLoopRestartCursorTeleport = false;
    this.lastPlayCursorTransitionDurationMs = 0;
    this.pendingDeferredTieStepAdvance = false;
    this.refreshCursorDebugMarkersDeferred();
  }

  // Play
  osmdListen(): void {
    this.running = true;
    this.skipPlayNotes = 0;
    this.osmdResetFeedback();
    this.clearCursorTraceEvents();
    this.markCursorTraceLoopBoundary('listen start');
    this.listenMode = true;
    this.realtimeMode = false;
    this.startFlashCount = 0;
    this.osmdCursorStart();
  }

  // Practice
  osmdPractice(): void {
    this.running = true;
    this.skipPlayNotes = 0;
    this.osmdResetFeedback();
    this.clearCursorTraceEvents();
    this.markCursorTraceLoopBoundary('practice start');
    this.listenMode = false;
    this.realtimeMode = false;
    this.startFlashCount = 4;
    this.osmdCursorStart();
  }

  osmdPracticeRealtime(): void {
    this.running = true;
    this.skipPlayNotes = 0;
    this.osmdResetFeedback();
    this.clearCursorTraceEvents();
    this.resetRealtimeDebugStats();
    this.markCursorTraceLoopBoundary('realtime start');
    this.listenMode = false;
    this.realtimeMode = true;
    this.currentStepSatisfied = false;
    this.startFlashCount = 4;
    this.osmdCursorStart();
  }

  // Move cursor to next note
  osmdCursorMoveNext(index: number): boolean {
    const shouldAnimate =
      index === 0 &&
      this.shouldAnimatePlayCursor() &&
      !this.suppressPlayCursorAnimation;
    const previousPosition = shouldAnimate ? this.getPlayCursorPosition() : null;
    const previousTargetX =
      shouldAnimate && index === 0
        ? this.getCurrentPlayCursorTargetX()
        : null;
    const previousMeasureNumber =
      index === 0
        ? this.openSheetMusicDisplay.cursors[index].iterator.CurrentMeasureIndex + 1
        : null;
    const previousTimestamp =
      shouldAnimate && index === 0
        ? this.openSheetMusicDisplay.cursors[index].iterator.CurrentSourceTimestamp
            .RealValue
        : null;
    const previousMeasureEndTimestamp =
      shouldAnimate && index === 0
        ? this.openSheetMusicDisplay.cursors[index].iterator.CurrentMeasure
            .AbsoluteTimestamp.RealValue +
          this.openSheetMusicDisplay.cursors[index].iterator.CurrentMeasure.Duration
            .RealValue
        : null;
    const transitionDuration = shouldAnimate
      ? this.getCursorStepDelayMs(index)
      : 0;

    if (index === 0) {
      this.lastPlayCursorTransitionDurationMs = transitionDuration;
    }

    if (index === 0) {
      const container = document.getElementById('scoreOverlayHost');
      const visualDebug = container
        ? this.getCurrentPlayCursorVisualDebug(container)
        : null;
      this.tracePlayCursor('move start', `dur ${Math.round(transitionDuration)}`);
      this.appendCursorWrapDebugEvent(
        `step m${previousMeasureNumber ?? '?'} t${
          previousTimestamp !== null ? previousTimestamp.toFixed(3) : '?'
        } dur ${Math.round(transitionDuration)}`
      );
      if (visualDebug) {
        this.appendCursorWrapDebugEvent(
          `vis a[${this.formatCursorDebugTargets(
            visualDebug.actionableTargets
          )}] all[${this.formatCursorDebugTargets(
            visualDebug.allTargets
          )}] use[${
            this.formatCursorDebugTargets(visualDebug.preferredTargets)
          }] ${visualDebug.noteTargets.join(' ') || 'none'}`
        );
      }
    }

    if (shouldAnimate && transitionDuration > 0) {
      this.applyPlayCursorTransition(transitionDuration);
    }

    this.openSheetMusicDisplay.cursors[index].next();
    // Move to first valid measure
    if (
      this.inputMeasure.lower >
      this.openSheetMusicDisplay.cursors[index].iterator.CurrentMeasureIndex + 1
    ) {
      return this.osmdCursorMoveNext(index);
    }

    if (shouldAnimate) {
      const nextPosition = this.getPlayCursorPosition();
      const nextTimestamp =
        index === 0
          ? this.openSheetMusicDisplay.cursors[index].iterator.CurrentSourceTimestamp
              .RealValue
          : null;
      const nextMeasureNumber =
        index === 0
          ? this.openSheetMusicDisplay.cursors[index].iterator.CurrentMeasureIndex + 1
          : null;
      if (
        !previousPosition ||
        !nextPosition ||
        Math.abs(nextPosition.top - previousPosition.top) > 4
      ) {
        const shouldTreatAsSystemWrap =
          previousMeasureNumber !== null &&
          nextMeasureNumber !== null &&
          this.isPlayCursorSystemWrap(previousMeasureNumber, nextMeasureNumber);
        const startedSystemWrapAnimation =
          shouldTreatAsSystemWrap &&
          index === 0 &&
          previousMeasureNumber !== null &&
          previousTimestamp !== null &&
          previousMeasureEndTimestamp !== null &&
          nextTimestamp !== null &&
          nextMeasureNumber !== null &&
          this.startPlayCursorSystemWrapAnimation({
            previousPosition,
            nextPosition,
            previousTargetX,
            previousMeasureNumber,
            previousTimestamp,
            previousMeasureEndTimestamp,
            nextMeasureNumber,
            nextTimestamp,
          });

        if (!startedSystemWrapAnimation) {
          this.suppressPlayCursorAlignmentForStep = true;
          this.resetPlayCursorTransition();
          this.tracePlayCursor('move wrap', 'snap');
          this.appendCursorWrapDebugEvent(
            `wrap fallback m${previousMeasureNumber}->${nextMeasureNumber} x${
              previousPosition ? Math.round(previousPosition.left) : '?'
            }->${
              nextPosition ? Math.round(nextPosition.left) : '?'
            } t${
              previousTimestamp !== null ? previousTimestamp.toFixed(3) : '?'
            }->${
              nextTimestamp !== null ? nextTimestamp.toFixed(3) : '?'
            }`
          );
        } else {
          this.tracePlayCursor('move wrap', 'system teleport');
          this.appendCursorWrapDebugEvent(
            `wrap system m${previousMeasureNumber}->${nextMeasureNumber} t${
              previousTimestamp !== null ? previousTimestamp.toFixed(3) : '?'
            }->${
              nextTimestamp !== null ? nextTimestamp.toFixed(3) : '?'
            }`
          );
        }
      }
    }

    if (index === 0) {
      this.tracePlayCursor('move end');
      this.refreshCursorWrapDebugSnapshot();
    }

    return true;
  }

  // Move cursor to next note
  osmdCursorTempoMoveNext(): void {
    // Required to stop next calls if stop is pressed during play
    if (!this.running) return;

    if (!this.osmdEndReached(1)) this.osmdCursorMoveNext(1);
    const currentTimestamp =
      this.openSheetMusicDisplay.cursors[1].iterator.CurrentSourceTimestamp
        .RealValue;
    const audioTime = this.getScheduledAudioTime();

    if (this.realtimeMode) {
      this.advanceRealtimePractice(audioTime);
    }

    let nextTimestamp = currentTimestamp;

    // if ended reached check repeat and start or stop
    if (this.osmdEndReached(1)) {
      // Caculate time to end of compass
      const iter = this.openSheetMusicDisplay.cursors[1].iterator;
      nextTimestamp =
        iter.CurrentMeasure.AbsoluteTimestamp.RealValue +
        iter.CurrentMeasure.Duration.RealValue;
      const timeout = this.getPlaybackDelayMs(
        nextTimestamp - iter.CurrentSourceTimestamp.RealValue
      );
      this.timeouts.push(
        setTimeout(() => {
          this.openSheetMusicDisplay.cursors[1].hide();
        }, timeout)
      );
    } else {
      // Move to Next
      const iter = this.openSheetMusicDisplay.cursors[1].iterator;
      const it2 = this.openSheetMusicDisplay.cursors[1].iterator.clone();
      it2.moveToNext();
      nextTimestamp = it2.CurrentSourceTimestamp.RealValue;
      let timeout = this.getPlaybackDelayMs(
        nextTimestamp - iter.CurrentSourceTimestamp.RealValue
      );

      // On repeat sign, manually calculate
      if (timeout < 0) {
        const currMeasure =
          this.openSheetMusicDisplay.cursors[1].iterator.CurrentMeasure;
        nextTimestamp =
          currMeasure.AbsoluteTimestamp.RealValue +
          currMeasure.Duration.RealValue;
        timeout = this.getPlaybackDelayMs(
          nextTimestamp - iter.CurrentSourceTimestamp.RealValue
        );
      }

      this.timeouts.push(
        setTimeout(() => {
          this.osmdCursorTempoMoveNext();
        }, timeout)
      );
    }

    this.scheduleMetronomeWindow(currentTimestamp, nextTimestamp, audioTime);

    // Play note in listen mode, so the play cursor can advance forward
    if (this.listenMode) {
      this.playNote(audioTime);
    }
  }

  osmdEndReached(cursorId: number): boolean {
    // Check end reached
    let endReached = false;
    if (this.openSheetMusicDisplay.cursors[cursorId].iterator.EndReached) {
      endReached = true;
    } else {
      const it2 = this.openSheetMusicDisplay.cursors[cursorId].iterator.clone();
      it2.moveToNext();
      if (
        it2.EndReached ||
        this.inputMeasure.upper < it2.CurrentMeasureIndex + 1
      ) {
        endReached = true;
      }
    }
    return endReached;
  }

  // Move cursor to next note
  osmdCursorPlayMoveNext(): void {
    // Required to stop next calls if stop is pressed during play
    if (!this.running) return;

    if (this.notesService.getMapRequired().size > 0) {
      this.markCurrentNotesCorrect();
    }

    // if ended reached check repeat and start or stop
    if (this.osmdEndReached(0)) {
      const iter = this.openSheetMusicDisplay.cursors[0].iterator;
      const timeout = this.getPlaybackDelayMs(
        iter.CurrentMeasure.AbsoluteTimestamp.RealValue +
          iter.CurrentMeasure.Duration.RealValue -
          iter.CurrentSourceTimestamp.RealValue
      );
      if (this.checkboxRepeat) {
        const startedLoopWrapAnimation = this.startPlayCursorLoopWrapAnimation(
          timeout,
          () => {
            this.loopPass++;
            this.markCursorTraceLoopBoundary('loop wrap');
            this.osmdCursorStart();
          }
        );
        if (!startedLoopWrapAnimation) {
          this.timeouts.push(
            setTimeout(() => {
              this.loopPass++;
              this.markCursorTraceLoopBoundary('loop wrap');
              this.osmdCursorStart();
            }, timeout)
          );
        }
      } else {
        this.openSheetMusicDisplay.cursors[0].hide();
        this.timeouts.push(
          setTimeout(() => {
            this.osmdCursorStop();
          }, timeout)
        );
      }
      return;
    }

    // Move to next
    if (!this.osmdCursorMoveNext(0)) return;

    // Calculate notes
    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getPracticeStaffSelection()
    );
    this.activePracticeGraphicalNotes = this.getCurrentPracticeGraphicalNotes();
    this.activePracticeNoteElements = this.getCurrentPracticeNoteElements();
    this.updatePlayCursorVisualAlignment();

    this.tempoInBPM = this.notesService.tempoInBPM;

    // Update keyboard
    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();

    // If ties occured, move to next and skip one additional note
    if (this.notesService.isRequiredNotesPressed()) {
      this.skipPlayNotes++;
      if (this.shouldDeferAutoAdvanceForTieOnlyStep()) {
        this.scheduleDeferredTieStepAdvance();
      } else {
        this.osmdCursorPlayMoveNext();
      }
    }
  }

  // Stop cursor
  osmdCursorStop(): void {
    this.listenMode = false;
    this.realtimeMode = false;
    this.running = false;

    this.openSheetMusicDisplay.cursors.forEach((cursor) => {
      cursor.reset();
      cursor.hide();
    });
    for (const [key] of this.mapNotesAutoPressed) {
      this.keyReleaseNote(parseInt(key) + 12);
    }
    this.mapNotesAutoPressed.clear();
    this.computerPressedNotes.clear();
    this.notesService.clear();
    this.computerNotesService.clear();
    this.activePracticeNoteElements = [];
    this.activePracticeGraphicalNotes = [];
    this.cancelScheduledPlayCursorAlignment();
    const cursorElement = this.getPlayCursorElement();
    if (cursorElement) {
      cursorElement.style.transform = '';
    }
    this.clearRealtimeCurrentStepMatches();
    this.clearRealtimeToleranceWindow();
    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    this.activeRangeHandle = null;
    this.activeRangeSelectionStart = null;
    window.removeEventListener('pointermove', this.onRangeHandlePointerMove);
    window.removeEventListener('pointerup', this.onRangeHandlePointerUp);
    window.removeEventListener('pointermove', this.onRangeSelectionPointerMove);
    window.removeEventListener('pointerup', this.onRangeSelectionPointerUp);
    this.refreshCursorDebugMarkersDeferred();
  }

  // Resets the cursor to the first note
  osmdCursorStart(): void {
    // this.content.scrollToTop();
    this.resetPlayCursorTransition();
    this.tracePlayCursor('start reset');
    this.clearRealtimeToleranceWindow();
    this.lastPlayCursorTransitionDurationMs = 0;
    this.pendingDeferredTieStepAdvance = false;
    this.suppressPlayCursorAnimation = true;
    this.openSheetMusicDisplay.cursors.forEach((cursor, index) => {
      cursor.show();
      cursor.reset();
      cursor.update();
      if (this.listenMode && index == 1) {
        // Comment out this to enable debug mode
        cursor.hide();
      }
    });

    // Additional tasks in case of new start, not required in repetition
    if (this.loopPass === 0) {
      this.notesService.clear();
      this.computerNotesService.clear();
      this.releaseComputerPressedNotes();
      // free auto pressed notes
      for (const [key] of this.mapNotesAutoPressed) {
        this.keyReleaseNote(parseInt(key) + 12);
      }
    }

    this.osmdHideFeedback();

    if (
      this.inputMeasure.lower >
      this.openSheetMusicDisplay.cursors[0].iterator.CurrentMeasureIndex + 1
    ) {
      if (!this.osmdCursorMoveNext(0)) return;
      this.osmdCursorMoveNext(1);
    }

    this.openSheetMusicDisplay.cursors.forEach((cursor) => cursor.update());
    this.snapPlayCursorForJump();
    if (this.pendingLoopRestartCursorTeleport) {
      this.positionPlayCursorAtLoopStartBoundary();
    }
    this.suppressPlayCursorAlignmentForStep = this.loopPass > 0;
    this.tracePlayCursor(
      'start positioned',
      this.loopPass > 0 ? 'loop restart' : 'fresh'
    );

    this.suppressPlayCursorAnimation = false;

    // Calculate first notes
    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getPracticeStaffSelection(),
      true
    );
    this.activePracticeGraphicalNotes = this.getCurrentPracticeGraphicalNotes();
    this.activePracticeNoteElements = this.getCurrentPracticeNoteElements();
    this.cacheLoopStartCursorTargets();
    if (this.pendingLoopRestartCursorTeleport) {
      this.tracePlayCursor('start aligned', 'loop boundary');
    } else {
      this.updatePlayCursorVisualAlignment();
      this.tracePlayCursor('start aligned');
    }

    this.tempoInBPM = this.notesService.tempoInBPM;

    if (this.realtimeMode) {
      this.syncRealtimeStepState(true);
    }

    // Update keyboard
    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    this.refreshCursorWrapDebugSnapshot();
    this.osmdCursorStart2();
  }

  osmdCursorStart2(): void {
    if (this.startFlashCount > 0) {
      this.playCountInClick();
      if (this.openSheetMusicDisplay.cursors[0].hidden)
        this.openSheetMusicDisplay.cursors[0].show();
      else this.openSheetMusicDisplay.cursors[0].hide();
      this.startFlashCount--;
      const countInDelay = this.getCountInDelayMs();
      this.timeouts.push(
        setTimeout(() => {
          this.osmdCursorStart2();
        }, countInDelay)
      );
      return;
    }

    this.startFlashCount = 0;
    this.openSheetMusicDisplay.cursors[0].show();

    // Skip initial rests
    if (!this.realtimeMode && this.notesService.isRequiredNotesPressed()) {
      this.skipPlayNotes++;
      this.osmdCursorPlayMoveNext();
    }

    this.timePlayStart = Date.now();
    this.playbackStartScoreTimestamp =
      this.openSheetMusicDisplay.cursors[0].iterator.CurrentSourceTimestamp
        .RealValue;
    const audioTime = this.getScheduledAudioTime();

    this.startMetronome();

    // Play initial notes
    if (this.listenMode) {
      this.playNote(audioTime);
    } else if (this.realtimeMode) {
      this.playComputerNotes(audioTime);
    }

    const it2 = this.openSheetMusicDisplay.cursors[0].iterator.clone();
    it2.moveToNext();
    const nextTimestamp = it2.CurrentSourceTimestamp.RealValue;

    this.scheduleMetronomeWindow(
      this.playbackStartScoreTimestamp,
      nextTimestamp,
      audioTime
    );

    const timeout = this.getPlaybackDelayMs(
      nextTimestamp -
        this.openSheetMusicDisplay.cursors[0].iterator.CurrentSourceTimestamp
          .RealValue
    );
    this.timeouts.push(
      setTimeout(() => {
        this.osmdCursorTempoMoveNext();
      }, timeout)
    );
  }

  playNote(audioTime?: number): void {
    if (this.skipPlayNotes > 0) {
      this.skipPlayNotes--;
    } else {
      this.notesService.playRequiredNotes(
        (note, velocity) => this.keyPressNote(note, velocity, audioTime),
        (note) => this.keyReleaseNote(note, audioTime)
      );
    }
  }

  // Remove all feedback elements
  osmdResetFeedback(): void {
    this.resetCorrectNoteheads();
    this.resetIncorrectNoteheads();
    let elems = document.getElementsByClassName('feedback');
    // Remove all elements
    while (elems.length > 0) {
      for (let i = 0; i < elems.length; i++) {
        const parent = elems[i].parentNode;
        if (parent) parent.removeChild(elems[i]);
      }
      elems = document.getElementsByClassName('feedback');
    }
  }

  private markCurrentNotesCorrect(): void {
    if (!this.checkboxFeedback) {
      return;
    }

    const graphicalNotes =
      this.activePracticeGraphicalNotes.length > 0
        ? this.activePracticeGraphicalNotes
        : this.getCurrentPracticeGraphicalNotes();
    this.renderCorrectPracticeNotes(
      graphicalNotes,
      this.getCurrentPracticeTimestamp()
    );
  }

  private markCurrentNoteCorrect(name: string): void {
    if (!this.checkboxFeedback) {
      return;
    }

    const halfTone = parseInt(name, 10);
    if (!Number.isFinite(halfTone)) {
      return;
    }

    const matchingNotes = this.activePracticeGraphicalNotes.filter(
      (note) => note.halfTone === halfTone
    );

    if (matchingNotes.length === 0) {
      return;
    }

    this.renderCorrectPracticeNotes(
      matchingNotes,
      this.getCurrentPracticeTimestamp()
    );
  }

  private markPreviousStepNoteCorrect(name: string): void {
    if (!this.checkboxFeedback) {
      return;
    }

    const halfTone = parseInt(name, 10);
    if (!Number.isFinite(halfTone)) {
      return;
    }

    const matchingNotes = this.realtimePreviousStepGraphicalNotes.filter(
      (note) => note.halfTone === halfTone
    );

    if (matchingNotes.length === 0) {
      return;
    }

    this.renderCorrectPracticeNotes(
      matchingNotes,
      this.realtimePreviousStepTimestamp
    );
  }

  private renderCorrectPracticeNotes(
    graphicalNotes: PracticeGraphicalNote[],
    timestamp: number
  ): void {
    graphicalNotes.forEach((note, index) => {
      const placement = this.getRenderedNoteheadPlacement(note);
      if (!placement) {
        return;
      }

      const id = `correct-${this.loopPass}-${timestamp}-${note.halfTone}-${index}`;
      this.renderFeedbackNotehead(
        this.correctNoteheadElements,
        'feedback-notehead feedback-notehead--correct',
        id,
        placement
      );
    });
  }

  private renderFeedbackNotehead(
    registry: Map<string, HTMLElement>,
    className: string,
    id: string,
    placement: { left: number; top: number; width: number; height: number }
  ): void {
    let element = registry.get(id);
    if (!element) {
      element = document.createElement('div');
      element.className = className;
      element.dataset.feedbackId = id;
      const parent = document.getElementById('scoreOverlayHost');
      if (!parent) {
        return;
      }
      parent.appendChild(element);
      registry.set(id, element);
    }

    const isCorrect = className.includes('feedback-notehead--correct');
    element.style.position = 'absolute';
    element.style.pointerEvents = 'none';
    element.style.borderRadius = '50% 48% 52% 50%';
    element.style.transform = 'rotate(-24deg)';
    element.style.zIndex = '3';
    element.style.background = isCorrect ? '#16a34a' : '#dc2626';
    element.style.border = isCorrect
      ? '1px solid #166534'
      : '1px solid #991b1b';
    element.style.boxShadow = isCorrect
      ? '0 0 0 1px rgb(255 255 255 / 0.18)'
      : '0 0 0 1px rgb(255 255 255 / 0.25)';

    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;
    element.style.width = `${placement.width}px`;
    element.style.height = `${placement.height}px`;
  }

  private getRenderedNoteheadPlacement(note: PracticeGraphicalNote): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const container = document.getElementById('scoreOverlayHost');
    if (!container) {
      return null;
    }

    const noteRect = this.getGraphicalNoteDomRect(note.graphicalNote, container);
    const anchorRect = this.getAnchorDomRect(
      note.anchorElement,
      note.groupElement,
      container
    );
    if (noteRect || anchorRect) {
      const horizontalRect = anchorRect ?? noteRect;
      const verticalRect = noteRect ?? anchorRect;
      if (!horizontalRect || !verticalRect) {
        return this.getCursorFallbackNoteheadPlacement();
      }

      const width = Math.max(horizontalRect.width * 0.95, 10);
      const height = Math.max(verticalRect.height * 0.82, 8);
      const left =
        horizontalRect.left + (horizontalRect.width - width) / 2;
      const top = verticalRect.top + (verticalRect.height - height) / 2;

      return { left, top, width, height };
    }

    return this.getCursorFallbackNoteheadPlacement();
  }

  private getAnchorDomRect(
    anchorElement: SVGElement | null | undefined,
    groupElement: SVGElement | null | undefined,
    container: HTMLElement
  ): { left: number; top: number; width: number; height: number } | null {
    const renderableRect = this.getRenderableRect(anchorElement, groupElement);
    if (!renderableRect) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    return {
      left: renderableRect.left - containerRect.left,
      top: renderableRect.top - containerRect.top,
      width: Math.max(renderableRect.width, 1),
      height: Math.max(renderableRect.height, 1),
    };
  }

  private getGraphicalNoteDomRect(
    graphicalNote: any,
    container: HTMLElement
  ): { left: number; top: number; width: number; height: number } | null {
    const box = graphicalNote?.PositionAndShape;
    if (!box) {
      return null;
    }

    const absoluteRect =
      box.AbsolutePosition &&
      Number.isFinite(box.BorderLeft) &&
      Number.isFinite(box.BorderRight) &&
      Number.isFinite(box.BorderTop) &&
      Number.isFinite(box.BorderBottom)
        ? {
            x:
              (box.AbsolutePosition.x + box.BorderLeft) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
            y:
              (box.AbsolutePosition.y + box.BorderTop) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
            width:
              (box.BorderRight - box.BorderLeft) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
            height:
              (box.BorderBottom - box.BorderTop) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
          }
        : null;

    const rect =
      absoluteRect ??
      box.BoundingRectangle ??
      (box.AbsolutePosition && box.Size
        ? {
            x: box.AbsolutePosition.x,
            y: box.AbsolutePosition.y,
            width: box.Size.width,
            height: box.Size.height,
          }
        : null);

    if (!rect) {
      return null;
    }

    const domRect = this.convertSvgRectToDomRect(rect);
    if (!domRect) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    return {
      left: domRect.left - containerRect.left,
      top: domRect.top - containerRect.top,
      width: Math.max(domRect.right - domRect.left, 1),
      height: Math.max(domRect.bottom - domRect.top, 1),
    };
  }

  private getCursorFallbackNoteheadPlacement(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const cursorPosition = this.getPlayCursorPosition();
    if (!cursorPosition) {
      return null;
    }

    return {
      left: cursorPosition.left + 8,
      top: Math.max(cursorPosition.top + 8, 0),
      width: 14,
      height: 11,
    };
  }

  private getRenderableRect(
    primary: SVGElement | null | undefined,
    fallback?: SVGElement | null
  ): DOMRect | null {
    const primaryRect = primary?.getBoundingClientRect?.() ?? null;
    if (primaryRect && (primaryRect.width > 0 || primaryRect.height > 0)) {
      return primaryRect;
    }

    const fallbackRect = fallback?.getBoundingClientRect?.() ?? null;
    if (fallbackRect && (fallbackRect.width > 0 || fallbackRect.height > 0)) {
      return fallbackRect;
    }

    return primaryRect ?? fallbackRect ?? null;
  }

  private getCurrentPracticeTimestamp(): number {
    return (
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentSourceTimestamp
        ?.RealValue ?? 0
    );
  }

  private updatePlayCursorVisualAlignment(): void {
    const cursorElement = this.getPlayCursorElement();
    const container = document.getElementById('scoreOverlayHost');

    if (!cursorElement || !container) {
      return;
    }

    this.enforcePlayCursorThickness(cursorElement);

    if (this.playCursorAlignmentFrame !== null) {
      this.tracePlayCursor('align deferred');
      return;
    }

    if (this.suppressPlayCursorAlignmentForStep) {
      cursorElement.style.transform = '';
      this.suppressPlayCursorAlignmentForStep = false;
      this.tracePlayCursor('align skipped');
      return;
    }

    const currentPosition = this.getPlayCursorPosition();
    if (!currentPosition) {
      cursorElement.style.transform = '';
      return;
    }

    const targetCenters = this.getActivePracticeTargetCenters(container);

    if (targetCenters.length === 0) {
      cursorElement.style.transform = '';
      return;
    }

    const targetCenterX = targetCenters[0];
    const minTargetCenter = targetCenters[0];
    const maxTargetCenter = targetCenters[targetCenters.length - 1];
    const offsetX = targetCenterX - currentPosition.left;

    cursorElement.style.transform = `translateX(${offsetX}px)`;
    this.tracePlayCursor(
      'align applied',
      `target ${Math.round(targetCenterX)} span ${Math.round(minTargetCenter)}-${Math.round(maxTargetCenter)} n${targetCenters.length}`
    );
  }

  private cacheLoopStartCursorTargets(): void {
    const currentMeasureNumber =
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex + 1;

    if (currentMeasureNumber !== this.inputMeasure.lower) {
      return;
    }

    const container = document.getElementById('scoreOverlayHost');
    const targetCenters = container
      ? this.getActivePracticeTargetCenters(container)
      : [];

    if (targetCenters.length > 0) {
      this.loopStartCursorTargetX = targetCenters[0];
    }

    const measureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === currentMeasureNumber
    );
    if (measureOverlay) {
      this.loopStartMeasureLeftX = measureOverlay.left;
    }
  }

  private cancelScheduledPlayCursorAlignment(): void {
    if (this.playCursorAlignmentFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.playCursorAlignmentFrame);
    this.playCursorAlignmentFrame = null;
    this.playCursorLoopWrapAnimation = null;
  }

  private getActivePracticeTargetCenters(
    container: HTMLElement,
    actionableOnly = false
  ): number[] {
    const graphicalNotes = actionableOnly
      ? this.activePracticeGraphicalNotes.filter((note) =>
          this.isActionableGraphicalPracticeNote(note.graphicalNote)
        )
      : this.activePracticeGraphicalNotes;

    return graphicalNotes
      .map((note) =>
        this.getAnchorDomRect(note.anchorElement, note.groupElement, container)
      )
      .filter(
        (
          rect
        ): rect is { left: number; top: number; width: number; height: number } =>
          !!rect
      )
      .map((rect) => rect.left + rect.width / 2)
      .sort((a, b) => a - b);
  }

  private getPreferredActivePracticeTargetCenters(container: HTMLElement): number[] {
    const actionableTargetCenters = this.getActivePracticeTargetCenters(
      container,
      true
    );
    if (actionableTargetCenters.length > 0) {
      return actionableTargetCenters;
    }

    return this.getActivePracticeTargetCenters(container);
  }

  private getCurrentPlayCursorTargetX(): number | null {
    const container = document.getElementById('scoreOverlayHost');
    if (!container) {
      return null;
    }

    const targetCenters = this.getActivePracticeTargetCenters(container);
    return targetCenters[0] ?? null;
  }

  private startPlayCursorLoopWrapAnimation(
    boundaryDurationMs: number,
    onBoundaryReached: () => void
  ): boolean {
    if (
      !this.shouldAnimatePlayCursor() ||
      boundaryDurationMs < 0 ||
      this.suppressPlayCursorAnimation
    ) {
      return false;
    }

    const cursorPosition = this.getPlayCursorPosition();
    const currentMeasureNumber =
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex + 1;
    const currentMeasureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === currentMeasureNumber
    );
    const loopStartOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === this.inputMeasure.lower
    );
    const container = document.getElementById('scoreOverlayHost');
    const finalNoteTargets = container
      ? this.getActivePracticeTargetCenters(container, true)
      : [];
    const finalNoteX = finalNoteTargets[0] ?? cursorPosition?.left ?? null;
    const startBarlineX =
      this.loopStartMeasureLeftX ?? loopStartOverlay?.left ?? null;
    const firstNoteX =
      this.loopStartCursorTargetX ?? startBarlineX ?? null;

    if (
      !cursorPosition ||
      !currentMeasureOverlay ||
      !Number.isFinite(finalNoteX) ||
      !Number.isFinite(startBarlineX) ||
      !Number.isFinite(firstNoteX)
    ) {
      return false;
    }

    this.cancelScheduledPlayCursorAlignment();
    this.resetPlayCursorTransition();

    const resolvedFinalNoteX = Number(finalNoteX);
    const resolvedStartBarlineX = Number(startBarlineX);
    const resolvedFirstNoteX = Number(firstNoteX);
    const boundaryTimeMs = performance.now() + boundaryDurationMs;
    this.playCursorLoopWrapAnimation = {
      boundaryTimeMs,
      boundaryDurationMs,
      finalNoteBaseLeft: cursorPosition.left,
      finalNoteX: resolvedFinalNoteX,
      endBarlineX: currentMeasureOverlay.right,
      restarted: false,
      restartBaseLeft: null,
      restartDurationMs: 0,
      startBarlineX: resolvedStartBarlineX,
      firstNoteX: resolvedFirstNoteX,
    };

    const tick = () => {
      const animation = this.playCursorLoopWrapAnimation;
      if (!this.running || !animation) {
        this.cancelScheduledPlayCursorAlignment();
        return;
      }

      const nowMs = performance.now();

      if (!animation.restarted) {
        const phaseStartMs = animation.boundaryTimeMs - animation.boundaryDurationMs;
        const progress =
          animation.boundaryDurationMs > 0
            ? Math.min(
                Math.max((nowMs - phaseStartMs) / animation.boundaryDurationMs, 0),
                1
              )
            : 1;
        const interpolatedX =
          animation.finalNoteX +
          (animation.endBarlineX - animation.finalNoteX) * progress;
        this.positionPlayCursorAtX(interpolatedX, animation.finalNoteBaseLeft);

        if (nowMs >= animation.boundaryTimeMs) {
          this.pendingLoopRestartCursorTeleport = true;
          onBoundaryReached();
          this.pendingLoopRestartCursorTeleport = false;

          const restartCursorPosition = this.getPlayCursorPosition();
          animation.restartBaseLeft = restartCursorPosition?.left ?? null;
          animation.restartDurationMs = this.getLoopRestartTravelDurationMs();
          animation.startBarlineX =
            this.loopStartMeasureLeftX ?? animation.startBarlineX;
          animation.firstNoteX =
            this.loopStartCursorTargetX ?? animation.firstNoteX;
          animation.restarted = true;
        }
      }

      if (animation.restarted) {
        const restartBaseLeft = animation.restartBaseLeft;
        if (!Number.isFinite(restartBaseLeft)) {
          this.cancelScheduledPlayCursorAlignment();
          return;
        }
        const resolvedRestartBaseLeft = Number(restartBaseLeft);

        const progress =
          animation.restartDurationMs > 0
            ? Math.min(
                Math.max(
                  (nowMs - animation.boundaryTimeMs) / animation.restartDurationMs,
                  0
                ),
                1
              )
            : 1;
        const interpolatedX =
          animation.startBarlineX +
          (animation.firstNoteX - animation.startBarlineX) * progress;
        this.positionPlayCursorAtX(interpolatedX, resolvedRestartBaseLeft);

        if (progress >= 1) {
          this.cancelScheduledPlayCursorAlignment();
          this.updatePlayCursorVisualAlignment();
          return;
        }
      }

      this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
    };

    this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
    this.tracePlayCursor(
      'loop boundary',
      `target ${Math.round(currentMeasureOverlay.right)} dur ${Math.round(boundaryDurationMs)}`
    );
    return true;
  }

  private getLoopRestartTravelDurationMs(): number {
    const iter = this.openSheetMusicDisplay?.cursors?.[0]?.iterator;
    if (!iter) {
      return 0;
    }

    return this.getPlaybackDelayMs(
      iter.CurrentSourceTimestamp.RealValue -
        iter.CurrentMeasure.AbsoluteTimestamp.RealValue
    );
  }

  private positionPlayCursorAtLoopStartBoundary(): void {
    const cursorPosition = this.getPlayCursorPosition();
    const targetX =
      this.loopStartMeasureLeftX ??
      this.measureOverlays.find(
        (measure) => measure.measureNumber === this.inputMeasure.lower
      )?.left;

    if (!cursorPosition || !Number.isFinite(targetX)) {
      return;
    }

    const resolvedTargetX = Number(targetX);
    this.positionPlayCursorAtX(resolvedTargetX, cursorPosition.left);
  }

  private positionPlayCursorAtX(targetX: number, baseLeft: number): void {
    const cursorElement = this.getPlayCursorElement();

    if (!cursorElement || !Number.isFinite(targetX) || !Number.isFinite(baseLeft)) {
      return;
    }

    this.enforcePlayCursorThickness(cursorElement);
    cursorElement.style.transition = 'none';
    cursorElement.style.transform = `translateX(${targetX - baseLeft}px)`;
  }

  private positionPlayCursorAtPoint(
    targetX: number,
    baseLeft: number,
    top: number
  ): void {
    const cursorElement = this.getPlayCursorElement();

    if (
      !cursorElement ||
      !Number.isFinite(targetX) ||
      !Number.isFinite(baseLeft) ||
      !Number.isFinite(top)
    ) {
      return;
    }

    this.enforcePlayCursorThickness(cursorElement);
    cursorElement.style.transition = 'none';
    cursorElement.style.top = `${top}px`;
    cursorElement.style.transform = `translateX(${targetX - baseLeft}px)`;
  }

  private startPlayCursorSystemWrapAnimation(params: {
    previousPosition: { left: number; top: number } | null;
    nextPosition: { left: number; top: number } | null;
    previousTargetX: number | null;
    previousMeasureNumber: number;
    previousTimestamp: number;
    previousMeasureEndTimestamp: number;
    nextMeasureNumber: number;
    nextTimestamp: number;
  }): boolean {
    const {
      previousPosition,
      nextPosition,
      previousTargetX,
      previousMeasureNumber,
      previousTimestamp,
      previousMeasureEndTimestamp,
      nextMeasureNumber,
      nextTimestamp,
    } = params;

    if (!previousPosition || !nextPosition) {
      return false;
    }

    const previousMeasureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === previousMeasureNumber
    );
    const nextMeasureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === nextMeasureNumber
    );
    const nextMeasureStartTimestamp =
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasure
        ?.AbsoluteTimestamp?.RealValue ?? null;
    const container = document.getElementById('scoreOverlayHost');
    const currentPracticeNotes = this.getCurrentPracticeGraphicalNotes();
    const nextActionableTargets = container
      ? this.getGraphicalPracticeTargetCenters(
          currentPracticeNotes,
          container,
          true
        )
      : [];
    const nextTargets = container
      ? this.getGraphicalPracticeTargetCenters(
          currentPracticeNotes,
          container,
          false
        )
      : [];
    const nextTargetX = nextActionableTargets[0] ?? nextTargets[0] ?? null;

    if (
      !previousMeasureOverlay ||
      !nextMeasureOverlay ||
      !Number.isFinite(previousTargetX) ||
      !Number.isFinite(nextMeasureStartTimestamp) ||
      !Number.isFinite(nextTargetX)
    ) {
      this.appendCursorWrapDebugEvent(
        `wrap reject prev m${previousMeasureNumber} next m${nextMeasureNumber} prevX ${
          Number.isFinite(previousTargetX) ? Math.round(Number(previousTargetX)) : 'na'
        } nextX ${Number.isFinite(nextTargetX) ? Math.round(Number(nextTargetX)) : 'na'}`
      );
      return false;
    }

    this.appendCursorWrapDebugEvent(
      `wrap accept prev m${previousMeasureNumber} next m${nextMeasureNumber} prevX ${Math.round(
        Number(previousTargetX)
      )} nextX ${Math.round(Number(nextTargetX))} rawNext ${nextTimestamp.toFixed(3)}`
    );

    const firstPhaseDurationMs = this.getPlaybackDelayMs(
      previousMeasureEndTimestamp - previousTimestamp
    );
    const secondPhaseDurationMs = this.getPlaybackDelayMs(
      nextTimestamp - nextMeasureStartTimestamp
    );
    const boundaryTimeMs = performance.now() + firstPhaseDurationMs;
    const restartBaseLeft = nextPosition.left;
    const previousTop = previousPosition.top;
    const nextTop = nextPosition.top;
    const resolvedPreviousTargetX = Number(previousTargetX);
    const resolvedNextTargetX = Number(nextTargetX);

    this.cancelScheduledPlayCursorAlignment();
    this.resetPlayCursorTransition();

    const tick = () => {
      if (!this.running) {
        this.cancelScheduledPlayCursorAlignment();
        return;
      }

      const nowMs = performance.now();

      if (nowMs < boundaryTimeMs) {
        const progress =
          firstPhaseDurationMs > 0
            ? Math.min(
                Math.max(
                  (nowMs - (boundaryTimeMs - firstPhaseDurationMs)) /
                    firstPhaseDurationMs,
                  0
                ),
                1
              )
            : 1;
        const interpolatedX =
          resolvedPreviousTargetX +
          (previousMeasureOverlay.right - resolvedPreviousTargetX) * progress;
        this.positionPlayCursorAtPoint(
          interpolatedX,
          restartBaseLeft,
          previousTop
        );
        this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
        return;
      }

      const progress =
        secondPhaseDurationMs > 0
          ? Math.min(
              Math.max((nowMs - boundaryTimeMs) / secondPhaseDurationMs, 0),
              1
            )
          : 1;
      const interpolatedX =
        nextMeasureOverlay.left +
        (resolvedNextTargetX - nextMeasureOverlay.left) * progress;
      this.positionPlayCursorAtPoint(interpolatedX, restartBaseLeft, nextTop);

      if (progress >= 1) {
        this.cancelScheduledPlayCursorAlignment();
        this.updatePlayCursorVisualAlignment();
        this.refreshCursorWrapDebugSnapshot();
        return;
      }

      this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
    };

    this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
    return true;
  }

  private isPlayCursorSystemWrap(
    previousMeasureNumber: number,
    nextMeasureNumber: number
  ): boolean {
    if (previousMeasureNumber === nextMeasureNumber) {
      return false;
    }

    const previousSystemId = this.getRenderedSystemIdForMeasure(previousMeasureNumber);
    const nextSystemId = this.getRenderedSystemIdForMeasure(nextMeasureNumber);

    if (previousSystemId === null || nextSystemId === null) {
      return false;
    }

    return previousSystemId !== nextSystemId;
  }

  private getRenderedSystemIdForMeasure(measureNumber: number): number | null {
    if (this.measureOverlays.length === 0) {
      return null;
    }

    const tolerance = 12;
    let currentSystemId = -1;
    let previousBandTop = Number.NEGATIVE_INFINITY;
    let previousBandBottom = Number.NEGATIVE_INFINITY;

    for (const overlay of this.measureOverlays) {
      const startsNewSystem =
        currentSystemId < 0 ||
        Math.abs(overlay.top - previousBandTop) > tolerance ||
        Math.abs(overlay.bottom - previousBandBottom) > tolerance;

      if (startsNewSystem) {
        currentSystemId++;
        previousBandTop = overlay.top;
        previousBandBottom = overlay.bottom;
      }

      if (overlay.measureNumber === measureNumber) {
        return currentSystemId;
      }
    }

    return null;
  }

  private markIncorrectInputNote(halfTone: number): void {
    if (!this.checkboxFeedback && !this.realtimeMode) {
      return;
    }

    const placement = this.getIncorrectNotePlacement(halfTone);
    if (!placement) {
      return;
    }

    const { id, left, top, width, height } = placement;
    this.renderFeedbackNotehead(
      this.incorrectNoteheadElements,
      'feedback-notehead feedback-notehead--incorrect',
      id,
      { left, top, width, height }
    );
  }

  private getCurrentPracticeNoteElements(): SVGElement[] {
    return Array.from(
      new Set(
        this.getCurrentPracticeGraphicalNotes().map((note) => note.groupElement)
      )
    );
  }

  private getCurrentPracticeGraphicalNotes(): PracticeGraphicalNote[] {
    const cursor: any = this.openSheetMusicDisplay?.cursors?.[0];
    if (!cursor?.GNotesUnderCursor) {
      return [];
    }

    cursor.update?.();

    const practiceSelection = this.getPracticeStaffSelection();
    const graphicalNotes = (cursor.GNotesUnderCursor() ?? []).filter((note: any) => {
      const staffId = note?.sourceNote?.ParentStaff?.idInMusicSheet;
      return staffId === undefined || practiceSelection[staffId];
    });

    const visited = new Set<any>();
    const elements: PracticeGraphicalNote[] = [];
    graphicalNotes.forEach((graphicalNote: any) => {
      const groupElement = graphicalNote?.getSVGGElement?.() as SVGElement | null;
      const anchorElement = this.getGraphicalNoteAnchorElement(graphicalNote);
      const halfTone = graphicalNote?.sourceNote?.halfTone;
      if (
        !groupElement ||
        !anchorElement ||
        visited.has(graphicalNote) ||
        !Number.isFinite(halfTone)
      ) {
        return;
      }

      visited.add(graphicalNote);
      elements.push({
        graphicalNote,
        anchorElement,
        groupElement,
        halfTone,
      });
    });

    return elements;
  }

  private getGraphicalNoteAnchorElement(graphicalNote: any): SVGElement | null {
    const group = graphicalNote?.getSVGGElement?.() as SVGElement | null;
    if (!group) {
      return null;
    }

    const explicitNotehead =
      group.querySelector<SVGElement>(
        '.vf-notehead ellipse, .vf-notehead circle, .vf-notehead path, [class*="notehead"] ellipse, [class*="notehead"] circle, [class*="notehead"] path'
      ) ??
      group.querySelector<SVGElement>(
        '.vf-notehead, [class*="notehead"]'
      );

    if (explicitNotehead) {
      return explicitNotehead;
    }

    const ellipseOrCircle = group.querySelector<SVGElement>('ellipse, circle');
    if (ellipseOrCircle) {
      return ellipseOrCircle;
    }

    return group;
  }

  private resetCorrectNoteheads(): void {
    this.correctNoteheadElements.forEach((element) => element.remove());
    this.correctNoteheadElements.clear();
  }

  private resetIncorrectNoteheads(): void {
    this.incorrectNoteheadElements.forEach((element) => element.remove());
    this.incorrectNoteheadElements.clear();
  }

  private getIncorrectNotePlacement(halfTone: number): {
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null {
    const container = document.getElementById('scoreOverlayHost');
    if (!container) {
      return null;
    }

    const candidates = this.activePracticeGraphicalNotes.length
      ? this.activePracticeGraphicalNotes.map((note) => ({
          graphicalNote: note.graphicalNote,
          element: note.anchorElement,
          groupElement: note.groupElement,
          halfTone: note.halfTone,
        }))
      : this.getCurrentPracticeGraphicalNotes().map((note) => ({
          graphicalNote: note.graphicalNote,
          element: note.anchorElement,
          groupElement: note.groupElement,
          halfTone: note.halfTone,
        }));

    if (!candidates.length) {
      return null;
    }

    const anchor = candidates.reduce((best: any, current: any) => {
      if (!best) {
        return current;
      }

      const bestDistance = Math.abs(best.halfTone - halfTone);
      const currentDistance = Math.abs(current.halfTone - halfTone);
      return currentDistance < bestDistance ? current : best;
    }, null);

    const anchorNoteRect = this.getGraphicalNoteDomRect(
      anchor?.graphicalNote,
      container
    );
    const anchorRect =
      anchorNoteRect ??
      (() => {
        const renderableRect = this.getRenderableRect(
          anchor?.element,
          anchor?.groupElement
        );
        if (!renderableRect) {
          return null;
        }

        const containerRect = container.getBoundingClientRect();
        return {
          left: renderableRect.left - containerRect.left,
          top: renderableRect.top - containerRect.top,
          width: renderableRect.width,
          height: renderableRect.height,
        };
      })();

    if (!anchorRect) {
      return null;
    }

    const stepDelta =
      this.getDiatonicStepIndex(halfTone) -
      this.getDiatonicStepIndex(anchor.halfTone);
    const stepHeight = this.getRedNoteStepHeight(anchor) ?? Math.max(anchorRect.height * 0.55, 4);
    const width = Math.max(anchorRect.width * 0.9, 10);
    const height = Math.max(anchorRect.height * 0.75, 8);
    const cursorCenterX = this.getPlayCursorOverlayCenterX(container);
    const left =
      cursorCenterX !== null
        ? cursorCenterX - width / 2
        : anchorRect.left + (anchorRect.width - width) / 2;
    const centerY =
      anchorRect.top + anchorRect.height / 2 -
      stepDelta * stepHeight;
    const top = centerY - height / 2;
    const timestamp =
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentSourceTimestamp
        ?.RealValue ?? 0;
    const id = `wrong-${this.loopPass}-${timestamp}-${halfTone}`;

    return { id, left, top, width, height };
  }

  private getPlayCursorOverlayCenterX(container: HTMLElement): number | null {
    const cursorElement = this.getPlayCursorElement();
    if (!cursorElement) {
      return null;
    }

    const cursorRect = cursorElement.getBoundingClientRect();
    if (!Number.isFinite(cursorRect.left) || !Number.isFinite(cursorRect.width)) {
      return null;
    }

    const containerRect = container.getBoundingClientRect();
    return cursorRect.left - containerRect.left + cursorRect.width / 2;
  }

  private getRedNoteStepHeight(anchor: any): number | null {
    const stave = anchor?.graphicalNote?.vfnote?.[0]?.getStave?.();
    const spacingBetweenLines = stave?.getSpacingBetweenLines?.();
    const scale = this.getSvgScaleFactors();

    if (
      !Number.isFinite(spacingBetweenLines) ||
      !scale ||
      !Number.isFinite(scale.scaleY)
    ) {
      return null;
    }

    // One diatonic step is half the distance between adjacent staff lines.
    return Math.max((spacingBetweenLines * scale.scaleY) / 2, 4);
  }

  private getDiatonicStepIndex(halfTone: number): number {
    const pitchClass = ((halfTone % 12) + 12) % 12;
    const octave = Math.floor(halfTone / 12);
    const stepByPitchClass = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    return octave * 7 + stepByPitchClass[pitchClass];
  }

  private clearRealtimeToleranceWindow(): void {
    this.realtimePreviousStepKeys.clear();
    this.realtimePreviousStepMatchedKeys.clear();
    this.realtimePreviousStepElements = [];
    this.realtimePreviousStepGraphicalNotes = [];
    this.realtimePreviousStepTimestamp = 0;
    this.realtimeLateToleranceUntil = 0;
    this.updateRealtimeDebugWindow();
  }

  private clearRealtimeDebugPrediction(): void {
    this.realtimeNextStepKeys.clear();
  }

  private clearRealtimeCurrentStepMatches(): void {
    this.realtimeCurrentStepMatchedKeys.clear();
  }

  private getCurrentRequiredPressKeys(notesService = this.notesService): Set<string> {
    return new Set(
      Array.from(notesService.getMapRequired().entries())
        .filter(([, noteObj]) => noteObj.value === 0)
        .map(([key]) => key)
    );
  }

  private hasCurrentRequiredPressKeys(notesService = this.notesService): boolean {
    for (const [, noteObj] of notesService.getMapRequired()) {
      if (noteObj.value === 0) {
        return true;
      }
    }

    return false;
  }

  private noteKeyToLabel(name: string): string {
    const halfTone = parseInt(name, 10);
    if (!Number.isFinite(halfTone)) {
      return name;
    }

    const pitchClasses = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pitchClass = ((halfTone % 12) + 12) % 12;
    const octave = Math.floor(halfTone / 12) - 1;
    return `${pitchClasses[pitchClass]}${octave}`;
  }

  private appendRealtimeDebugEvent(message: string): void {
    this.realtimeDebugEvents.unshift(message);
    this.realtimeDebugEvents = this.realtimeDebugEvents.slice(0, 12);
  }

  private appendCursorTraceEvent(message: string): void {
    if (!PlayPageComponent.ENABLE_CURSOR_TRACE) {
      return;
    }
    this.cursorTraceEvents.push(message);
  }

  private clearCursorTraceEvents(): void {
    if (!PlayPageComponent.ENABLE_CURSOR_TRACE) {
      this.cursorTraceEvents = [];
      return;
    }
    this.cursorTraceEvents = [];
  }

  private markCursorTraceLoopBoundary(label: string): void {
    if (!PlayPageComponent.ENABLE_CURSOR_TRACE) {
      return;
    }
    const loopLabel = `----- ${label} loop ${this.loopPass} -----`;
    this.appendCursorTraceEvent(loopLabel);
  }

  private getPlayCursorTransformX(): number {
    const transform = this.getPlayCursorElement()?.style.transform ?? '';
    const match = transform.match(/translateX\(([-\d.]+)px\)/);
    if (!match) {
      return 0;
    }

    const value = parseFloat(match[1]);
    return Number.isFinite(value) ? value : 0;
  }

  private tracePlayCursor(label: string, extra = ''): void {
    if (!PlayPageComponent.ENABLE_CURSOR_TRACE) {
      return;
    }
    const base = this.getPlayCursorPosition();
    const rendered = this.getTraceRenderedPlayCursorPosition();
    const transformX = this.getPlayCursorTransformX();
    const measure =
      (this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex ?? -1) +
      1;
    const timestamp = this.getCurrentPracticeTimestamp().toFixed(3);

    const parts = [
      label,
      `m${measure}`,
      `t${timestamp}`,
      `base ${base ? `${Math.round(base.left)},${Math.round(base.top)}` : 'na'}`,
      `render ${rendered ? `${Math.round(rendered.left)},${Math.round(rendered.top)}` : 'na'}`,
      `dx ${Math.round(transformX)}`,
    ];

    if (extra) {
      parts.push(extra);
    }

    this.appendCursorTraceEvent(parts.join(' | '));
  }

  private getTraceRenderedPlayCursorPosition(): {
    left: number;
    top: number;
  } | null {
    const cursorElement = this.getPlayCursorElement();
    const container = document.getElementById('scoreOverlayHost');

    if (!cursorElement || !container) {
      return null;
    }

    const cursorRect = cursorElement.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const left = cursorRect.left - containerRect.left;
    const top = cursorRect.top - containerRect.top;

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return { left, top };
  }

  private getRealtimeAcceptanceToleranceMs(): number {
    const toleranceMs = this.getPlaybackDelayMs(
      PlayPageComponent.REALTIME_ACCEPT_TOLERANCE_WHOLE_NOTES
    );
    this.debugRealtimeStats.toleranceMs = Math.round(toleranceMs);
    return toleranceMs;
  }

  private snapshotRealtimePreviousStep(): void {
    this.realtimePreviousStepKeys = this.getCurrentRequiredPressKeys();
    this.realtimePreviousStepMatchedKeys = new Set(
      Array.from(this.notesService.getMapPressed().keys()).filter((key) =>
        this.realtimePreviousStepKeys.has(key)
      )
    );
    this.realtimePreviousStepElements = [...this.activePracticeNoteElements];
    this.realtimePreviousStepGraphicalNotes = [
      ...this.activePracticeGraphicalNotes,
    ];
    this.realtimePreviousStepTimestamp = this.getCurrentPracticeTimestamp();
    this.realtimeLateToleranceUntil =
      performance.now() + this.getRealtimeAcceptanceToleranceMs();
    this.updateRealtimeDebugWindow();
  }

  private isAcceptedLateRealtimeNote(name: string): boolean {
    return (
      this.realtimeMode &&
      this.realtimePreviousStepKeys.has(name) &&
      performance.now() <= this.realtimeLateToleranceUntil
    );
  }

  private acceptLateRealtimeNote(name: string): void {
    this.realtimePreviousStepMatchedKeys.add(name);
    this.markPreviousStepNoteCorrect(name);
    this.debugRealtimeStats.acceptedLate++;
    this.debugRealtimeStats.lastPitch = this.noteKeyToLabel(name);
    this.debugRealtimeStats.lastResult = 'accepted late';
    this.appendRealtimeDebugEvent(`${this.noteKeyToLabel(name)} late`);
    this.updateRealtimeDebugWindow();

    if (
      this.realtimePreviousStepKeys.size > 0 &&
      this.realtimePreviousStepMatchedKeys.size >=
        this.realtimePreviousStepKeys.size
    ) {
      this.renderCorrectPracticeNotes(
        this.realtimePreviousStepGraphicalNotes,
        this.realtimePreviousStepTimestamp
      );
      this.clearRealtimeToleranceWindow();
    }
  }

  private updateRealtimeDebugWindow(): void {
    const remaining =
      this.realtimeLateToleranceUntil > 0
        ? Math.max(this.realtimeLateToleranceUntil - performance.now(), 0)
        : 0;
    this.debugRealtimeStats.lateWindowRemainingMs = Math.round(remaining);
  }

  private resetRealtimeDebugStats(): void {
    this.debugRealtimeStats = {
      playedTotal: 0,
      acceptedOnTime: 0,
      acceptedLate: 0,
      early: 0,
      rejected: 0,
      missedExpected: 0,
      lastPitch: '',
      lastResult: 'none',
      toleranceMs: Math.round(this.getPlaybackDelayMs(PlayPageComponent.REALTIME_ACCEPT_TOLERANCE_WHOLE_NOTES)),
      lateWindowRemainingMs: 0,
    };
    this.realtimeDebugEvents = [];
    this.clearCursorTraceEvents();
    this.clearRealtimeDebugPrediction();
    this.clearRealtimeCurrentStepMatches();
    this.clearRealtimeToleranceWindow();
  }

  showRealtimeDebugPanel(): boolean {
    return this.showDebugConsoleOverlay;
  }

  showCursorWrapDebugPanel(): boolean {
    return this.showCursorWrapDebugOverlay;
  }

  getCursorWrapDebugSummaryLines(): string[] {
    const snapshot = this.cursorWrapDebugSnapshot;
    if (!snapshot) {
      return ['cursor snapshot unavailable'];
    }

    return [
      `m${snapshot.measureNumber} t${snapshot.timestamp.toFixed(3)}`,
      `actionable ${snapshot.actionable ? 'yes' : 'no'}`,
      `target ${snapshot.targetX !== null ? Math.round(snapshot.targetX) : 'na'}`,
      `a[${this.formatCursorDebugTargets(snapshot.actionableTargets)}] all[${this.formatCursorDebugTargets(snapshot.allTargets)}]`,
      `notes ${snapshot.noteTargets.join(' ') || 'none'}`,
      `base ${snapshot.baseLeft !== null ? Math.round(snapshot.baseLeft) : 'na'}`,
      `render ${
        snapshot.renderedLeft !== null && snapshot.renderedTop !== null
          ? `${Math.round(snapshot.renderedLeft)},${Math.round(snapshot.renderedTop)}`
          : 'na'
      }`,
    ];
  }

  private appendCursorWrapDebugEvent(message: string): void {
    this.cursorWrapDebugEvents.unshift(message);
    this.cursorWrapDebugEvents = this.cursorWrapDebugEvents.slice(0, 16);
  }

  private refreshCursorWrapDebugSnapshot(): void {
    const measureNumber =
      (this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex ?? -1) + 1;
    const timestamp =
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentSourceTimestamp
        ?.RealValue ?? NaN;
    const container = document.getElementById('scoreOverlayHost');
    const visualDebug = container
      ? this.getCurrentPlayCursorVisualDebug(container)
      : null;
    const targetX = visualDebug?.preferredTargets[0] ?? null;
    const base = this.getPlayCursorPosition();
    const rendered = this.getTraceRenderedPlayCursorPosition();
    const actionable = this.activePracticeGraphicalNotes.some((note) =>
      this.isActionableGraphicalPracticeNote(note.graphicalNote)
    );

    if (!Number.isFinite(measureNumber) || !Number.isFinite(timestamp)) {
      this.cursorWrapDebugSnapshot = null;
      return;
    }

    this.cursorWrapDebugSnapshot = {
      measureNumber,
      timestamp,
      actionable,
      targetX,
      actionableTargets: visualDebug?.actionableTargets ?? [],
      allTargets: visualDebug?.allTargets ?? [],
      noteTargets: visualDebug?.noteTargets ?? [],
      baseLeft: base?.left ?? null,
      renderedLeft: rendered?.left ?? null,
      renderedTop: rendered?.top ?? null,
    };
  }

  private formatCursorDebugTargets(targets: number[]): string {
    return targets.map((target) => Math.round(target)).join(',');
  }

  private getCurrentPlayCursorVisualDebug(container: HTMLElement): {
    actionableTargets: number[];
    allTargets: number[];
    preferredTargets: number[];
    noteTargets: string[];
  } {
    const actionableTargets = this.getActivePracticeTargetCenters(container, true);
    const allTargets = this.getActivePracticeTargetCenters(container);
    const preferredTargets =
      actionableTargets.length > 0 ? actionableTargets : allTargets;

    const noteTargets = this.activePracticeGraphicalNotes
      .map((note) => {
        const rect = this.getAnchorDomRect(
          note.anchorElement,
          note.groupElement,
          container
        );
        if (!rect) {
          return null;
        }

        const centerX = rect.left + rect.width / 2;
        const prefix = this.isActionableGraphicalPracticeNote(note.graphicalNote)
          ? 'A'
          : 'T';
        return `${prefix}${note.halfTone}@${Math.round(centerX)}`;
      })
      .filter((value): value is string => !!value)
      .sort();

    return {
      actionableTargets,
      allTargets,
      preferredTargets,
      noteTargets,
    };
  }

  private hasActionableActivePracticeGraphicalNotes(): boolean {
    return this.activePracticeGraphicalNotes.some((note) =>
      this.isActionableGraphicalPracticeNote(note.graphicalNote)
    );
  }

  private shouldDeferAutoAdvanceForTieOnlyStep(): boolean {
    return (
      this.shouldAnimatePlayCursor() &&
      !this.pendingDeferredTieStepAdvance &&
      !this.hasActionableActivePracticeGraphicalNotes() &&
      this.lastPlayCursorTransitionDurationMs > 0
    );
  }

  private scheduleDeferredTieStepAdvance(): void {
    const delayMs = this.lastPlayCursorTransitionDurationMs;
    if (delayMs <= 0) {
      this.osmdCursorPlayMoveNext();
      return;
    }

    this.pendingDeferredTieStepAdvance = true;
    this.appendCursorWrapDebugEvent(`tie defer ${Math.round(delayMs)}`);
    this.timeouts.push(
      setTimeout(() => {
        this.pendingDeferredTieStepAdvance = false;
        if (!this.running) {
          return;
        }

        this.appendCursorWrapDebugEvent('tie resume');
        this.osmdCursorPlayMoveNext();
      }, delayMs)
    );
  }

  private getCurrentPlayCursorBridgeTargetX(): number | null {
    const marker = this.getCurrentCursorDebugMarker();
    if (!marker || marker.actionable) {
      return null;
    }

    const markerIndex = this.cursorDebugMarkers.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }

    let previousActionableMarker: CursorDebugMarker | null = null;
    for (let index = markerIndex - 1; index >= 0; index--) {
      const candidate = this.cursorDebugMarkers[index];
      if (candidate.actionable) {
        previousActionableMarker = candidate;
        break;
      }
    }

    if (!previousActionableMarker) {
      return null;
    }

    return previousActionableMarker.left;
  }

  private getCurrentCursorDebugMarker(): CursorDebugMarker | null {
    const measureNumber =
      (this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex ?? -1) + 1;
    const timestamp =
      this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentSourceTimestamp
        ?.RealValue ?? NaN;

    if (!Number.isFinite(measureNumber) || !Number.isFinite(timestamp)) {
      return null;
    }

    return (
      this.cursorDebugMarkers.find(
        (marker) =>
          marker.measureNumber === measureNumber &&
          Math.abs(marker.timestamp - timestamp) < 0.0001
      ) ?? null
    );
  }

  // Hide all feedback elements
  osmdHideFeedback(): void {
    document.querySelectorAll<HTMLElement>('.feedback').forEach(function (el) {
      el.style.visibility = 'hidden';
    });
  }

  // Hide all feedback elements
  osmdShowFeedback(): void {
    document.querySelectorAll<HTMLElement>('.feedback').forEach(function (el) {
      el.style.visibility = 'visible';
    });
  }

  // Present feedback text at cursor location
  osmdTextFeedback(text: string, x: number, y: number): void {
    const id =
      (document.getElementById('cursorImg-0')?.style.top ?? '') +
      x +
      '_' +
      (document.getElementById('cursorImg-0')?.style.left ?? '') +
      y +
      '_' +
      this.loopPass;

    const feedbackElementId = `feedback-${id}`;
    const oldElem = document.getElementById(feedbackElementId);
    let color = 'black';
    if (oldElem) {
      oldElem.remove();
      color = 'red';
    }
    const elem: HTMLElement = document.createElement('p');
    elem.id = feedbackElementId;
    elem.className = 'feedback r' + this.loopPass;
    elem.style.position = 'absolute';
    elem.style.zIndex = '-1';
    elem.innerHTML = text;
    const parent = document.getElementById('osmdCanvasPage1');
    if (parent) parent.appendChild(elem);
    elem.style.top =
      parseInt(document.getElementById('cursorImg-0')?.style.top ?? '') -
      40 -
      y +
      'px';
    elem.style.left =
      parseInt(document.getElementById('cursorImg-0')?.style.left ?? '') +
      x +
      'px';
    elem.style.color = color;
  }

  getEffectiveTempoBPM(): number {
    return Math.round((this.getScoreTempoBPM() * this.speedValue) / 100);
  }

  getTempoPresetLabel(): string {
    switch (this.tempoPreset) {
      case 'normal':
        return 'Normal';
      case 'slow':
        return 'Slow';
      case 'verySlow':
        return 'Very Slow';
      default:
        return 'Custom';
    }
  }

  private getPlaybackDelayMs(durationInWholeNotes: number): number {
    const tempoInBPM = this.getEffectiveTempoBPM();

    if (!Number.isFinite(durationInWholeNotes)) {
      return 0;
    }

    return Math.max(
      (durationInWholeNotes * 4 * 60000) / tempoInBPM,
      0
    );
  }

  private getScoreTempoBPM(): number {
    return Number.isFinite(this.tempoInBPM) && this.tempoInBPM > 0
      ? this.tempoInBPM
      : PlayPageComponent.DEFAULT_TEMPO_BPM;
  }

  private initializeTempoFromScore(): void {
    const sheet = this.openSheetMusicDisplay.Sheet;
    const firstMeasure = sheet?.getFirstSourceMeasure();
    const expressionTempo = sheet?.getExpressionsStartTempoInBPM?.();
    const defaultTempo = sheet?.DefaultStartTempoInBpm;
    const measureTempo = firstMeasure?.TempoInBPM;

    const candidates = [expressionTempo, defaultTempo, measureTempo];
    const initialTempo = candidates.find(
      (tempo) => Number.isFinite(tempo) && (tempo as number) > 0
    );

    this.tempoInBPM = initialTempo ?? PlayPageComponent.DEFAULT_TEMPO_BPM;
    this.notesService.tempoInBPM = this.tempoInBPM;
  }

  private syncRepeatToMeasureRange(): void {
    const isFullRange =
      this.inputMeasure.lower === this.inputMeasureRange.lower &&
      this.inputMeasure.upper === this.inputMeasureRange.upper;

    this.checkboxRepeat = !isFullRange;
    if (this.checkboxRepeat) {
      this.savedLoopRange = {
        lower: this.inputMeasure.lower,
        upper: this.inputMeasure.upper,
      };
      this.showRangePicker = true;
    }
    this.loopPass = 0;
  }

  private clearLoopRange(): void {
    if (this.checkboxRepeat) {
      this.savedLoopRange = {
        lower: this.inputMeasure.lower,
        upper: this.inputMeasure.upper,
      };
    }

    this.checkboxRepeat = false;
    this.showRangePicker = false;
    this.loopPass = 0;
    this.inputMeasure.lower = this.inputMeasureRange.lower;
    this.inputMeasure.upper = this.inputMeasureRange.upper;
  }

  private restoreLoopRange(): void {
    if (this.savedLoopRange) {
      this.inputMeasure.lower = this.savedLoopRange.lower;
      this.inputMeasure.upper = this.savedLoopRange.upper;
      this.checkboxRepeat = true;
      this.showRangePicker = true;
      this.loopPass = 0;
      return;
    }

    this.showRangePicker = true;
  }

  private readonly onRangeHandlePointerMove = (event: PointerEvent): void => {
    if (!this.activeRangeHandle) {
      return;
    }

    event.preventDefault();
    this.updateRangeHandleFromPointer(this.activeRangeHandle, event);
  };

  private readonly onRangeHandlePointerUp = (): void => {
    this.activeRangeHandle = null;
    window.removeEventListener('pointermove', this.onRangeHandlePointerMove);
    window.removeEventListener('pointerup', this.onRangeHandlePointerUp);
  };

  private readonly onRangeSelectionPointerMove = (event: PointerEvent): void => {
    if (this.activeRangeSelectionStart === null) {
      return;
    }

    event.preventDefault();
    const measure = this.findClosestMeasureOverlayAtPointer(event);
    if (!measure) {
      return;
    }

    this.applyDraggedRange(this.activeRangeSelectionStart, measure.measureNumber);
  };

  private readonly onRangeSelectionPointerUp = (): void => {
    this.activeRangeSelectionStart = null;
    window.removeEventListener('pointermove', this.onRangeSelectionPointerMove);
    window.removeEventListener('pointerup', this.onRangeSelectionPointerUp);
  };

  private updateRangeHandleFromPointer(
    handle: RangeHandle,
    event: PointerEvent
  ): void {
    const measure = this.findClosestMeasureOverlay(handle, event);
    if (!measure) {
      return;
    }

    if (handle === 'start') {
      const nextLower = this.resolveDraggedLowerMeasure(measure.measureNumber, event);
      this.updateLowerMeasure(nextLower.toString());
    } else {
      const nextUpper = this.resolveDraggedUpperMeasure(measure.measureNumber, event);
      this.updateUpperMeasure(nextUpper.toString());
    }
  }

  private resolveDraggedLowerMeasure(
    candidateMeasure: number,
    event: PointerEvent
  ): number {
    if (candidateMeasure <= this.inputMeasure.upper) {
      return candidateMeasure;
    }

    const currentUpper = this.measureOverlays.find(
      (measure) => measure.measureNumber === this.inputMeasure.upper
    );
    const pointerX = this.getPointerXInScore(event);

    if (!currentUpper || pointerX === null) {
      return this.inputMeasure.upper;
    }

    const centerX = (currentUpper.left + currentUpper.right) / 2;
    return pointerX >= centerX ? candidateMeasure : this.inputMeasure.upper;
  }

  private resolveDraggedUpperMeasure(
    candidateMeasure: number,
    event: PointerEvent
  ): number {
    if (candidateMeasure >= this.inputMeasure.lower) {
      return candidateMeasure;
    }

    const currentLower = this.measureOverlays.find(
      (measure) => measure.measureNumber === this.inputMeasure.lower
    );
    const pointerX = this.getPointerXInScore(event);

    if (!currentLower || pointerX === null) {
      return this.inputMeasure.lower;
    }

    const centerX = (currentLower.left + currentLower.right) / 2;
    return pointerX <= centerX ? candidateMeasure : this.inputMeasure.lower;
  }

  private getPointerXInScore(event: PointerEvent): number | null {
    const container = document.getElementById('scoreOverlayHost');
    if (!container) {
      return null;
    }

    return event.clientX - container.getBoundingClientRect().left;
  }

  private getMeasureOverlayForHandle(handle: RangeHandle): MeasureOverlay | undefined {
    return this.measureOverlays.find((measure) =>
      handle === 'start'
        ? measure.measureNumber === this.inputMeasure.lower
        : measure.measureNumber === this.inputMeasure.upper
    );
  }

  private findClosestMeasureOverlay(
    handle: RangeHandle,
    event: PointerEvent
  ): MeasureOverlay | undefined {
    const container = document.getElementById('scoreOverlayHost');
    if (!container || this.measureOverlays.length === 0) {
      return undefined;
    }

    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const candidates = this.getMeasuresForNearestStaffLine(y);

    let bestMeasure: MeasureOverlay | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    candidates.forEach((measure) => {
      const boundaryX = handle === 'start' ? measure.left : measure.right;
      const dx = Math.abs(x - boundaryX);
      const dy = Math.abs(y - (measure.top + measure.bottom) / 2);
      const distance = dx + dy * 0.05;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMeasure = measure;
      }
    });

    return bestMeasure;
  }

  private findClosestMeasureOverlayAtPointer(
    event: PointerEvent
  ): MeasureOverlay | undefined {
    const container = document.getElementById('scoreOverlayHost');
    if (!container || this.measureOverlays.length === 0) {
      return undefined;
    }

    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const containingMeasure = this.measureOverlays.find(
      (measure) =>
        x >= measure.left &&
        x <= measure.right &&
        y >= measure.top &&
        y <= measure.bottom
    );

    if (containingMeasure) {
      return containingMeasure;
    }

    let bestMeasure: MeasureOverlay | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    this.measureOverlays.forEach((measure) => {
      const centerX = (measure.left + measure.right) / 2;
      const centerY = (measure.top + measure.bottom) / 2;
      const distance = Math.hypot(x - centerX, y - centerY);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMeasure = measure;
      }
    });

    return bestMeasure;
  }

  private getMeasuresForNearestStaffLine(y: number): MeasureOverlay[] {
    if (this.measureOverlays.length === 0) {
      return [];
    }

    const tolerance = 12;
    const matchingLine = this.measureOverlays.filter(
      (measure) => y >= measure.top - tolerance && y <= measure.bottom + tolerance
    );

    if (matchingLine.length > 0) {
      return matchingLine;
    }

    let bestCenterY = Number.POSITIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    this.measureOverlays.forEach((measure) => {
      const centerY = (measure.top + measure.bottom) / 2;
      const distance = Math.abs(y - centerY);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestCenterY = centerY;
      }
    });

    return this.measureOverlays.filter(
      (measure) =>
        Math.abs((measure.top + measure.bottom) / 2 - bestCenterY) < tolerance
    );
  }

  private applyDraggedRange(startMeasure: number, endMeasure: number): void {
    const lower = Math.min(startMeasure, endMeasure);
    const upper = Math.max(startMeasure, endMeasure);

    this.updateLowerMeasure(lower.toString());
    this.updateUpperMeasure(upper.toString());
  }

  private refreshMeasureOverlaysDeferred(): void {
    window.setTimeout(() => this.refreshMeasureOverlays(), 0);
  }

  refreshCursorDebugMarkersDeferred(): void {
    if (this.cursorDebugRefreshTimeout !== null) {
      window.clearTimeout(this.cursorDebugRefreshTimeout);
    }

    this.cursorDebugRefreshTimeout = window.setTimeout(() => {
      this.cursorDebugRefreshTimeout = null;
      this.refreshCursorDebugMarkers();
    }, 0);
  }

  private refreshMeasureOverlays(): void {
    if (!this.fileLoaded) {
      this.measureOverlays = [];
      return;
    }

    const sheet: any = this.openSheetMusicDisplay?.Sheet;
    const graphicSheet: any = this.openSheetMusicDisplay?.GraphicSheet;
    const container = document.getElementById('scoreOverlayHost');

    if (!sheet || !graphicSheet || !container) {
      this.measureOverlays = [];
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const overlays: MeasureOverlay[] = [];

    sheet.SourceMeasures.forEach((sourceMeasure: any, index: number) => {
      const graphicalMeasures = this.getGraphicalMeasuresForSourceMeasure(
        sourceMeasure,
        index,
        graphicSheet
      );

      if (!graphicalMeasures.length) {
        return;
      }

      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;

      graphicalMeasures.forEach((measure: any) => {
        const rect = this.getGraphicalMeasureDomRect(measure, graphicSheet);

        if (!rect) {
          return;
        }

        left = Math.min(left, rect.left - containerRect.left);
        right = Math.max(right, rect.right - containerRect.left);
        top = Math.min(top, rect.top - containerRect.top);
        bottom = Math.max(bottom, rect.bottom - containerRect.top);
      });

      if (
        !Number.isFinite(left) ||
        !Number.isFinite(right) ||
        !Number.isFinite(top) ||
        !Number.isFinite(bottom)
      ) {
        return;
      }

      overlays.push({
        measureNumber: index + 1,
        left,
        right,
        top,
        bottom,
      });
    });

    this.measureOverlays = overlays;
    this.refreshCursorDebugMarkersDeferred();
  }

  private refreshCursorDebugMarkers(): void {
    if (!this.fileLoaded || !this.showCursorDebugOverlay) {
      this.cursorDebugMarkers = [];
      return;
    }

    // Freeze the debug snapshot while transport is running so we never disturb
    // the live OSMD cursor or trigger follow-cursor scrolling during playback.
    if (this.running) {
      return;
    }

    const cursor: any = this.openSheetMusicDisplay?.cursors?.[0];
    const container = document.getElementById('scoreOverlayHost');
    if (!cursor || !container) {
      this.cursorDebugMarkers = [];
      return;
    }

    const markers: CursorDebugMarker[] = [];
    const previousFollowCursor = this.openSheetMusicDisplay.FollowCursor;
    const previousCursorFollow = cursor.cursorOptions?.follow;
    const wasHidden = !!cursor.hidden;

    this.openSheetMusicDisplay.FollowCursor = false;
    if (cursor.cursorOptions) {
      cursor.cursorOptions.follow = false;
    }

    try {
      cursor.show?.();
      cursor.reset?.();
      cursor.update?.();

      while (true) {
        const measureNumber = cursor.iterator?.CurrentMeasureIndex + 1;
        if (!Number.isFinite(measureNumber) || measureNumber > this.inputMeasure.upper) {
          break;
        }

        if (measureNumber >= this.inputMeasure.lower) {
          const marker = this.buildCursorDebugMarker(cursor, container, markers.length);
          if (marker) {
            markers.push(marker);
          }
        }

        const it2 = cursor.iterator?.clone?.();
        if (!it2) {
          break;
        }
        it2.moveToNext();
        if (it2.EndReached || this.inputMeasure.upper < it2.CurrentMeasureIndex + 1) {
          break;
        }

        cursor.next?.();
        cursor.update?.();
      }

      cursor.reset?.();
      cursor.update?.();
    } finally {
      this.openSheetMusicDisplay.FollowCursor = previousFollowCursor;
      if (cursor.cursorOptions) {
        cursor.cursorOptions.follow = previousCursorFollow;
      }
      if (wasHidden) {
        cursor.hide?.();
      }
    }
    this.cursorDebugMarkers = markers;
  }

  private buildCursorDebugMarker(
    cursor: any,
    container: HTMLElement,
    index: number
  ): CursorDebugMarker | null {
    const timestamp = cursor.iterator?.CurrentSourceTimestamp?.RealValue;
    const measureNumber = cursor.iterator?.CurrentMeasureIndex + 1;
    const currentMeasure = cursor.iterator?.CurrentMeasure;

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(measureNumber) ||
      !currentMeasure
    ) {
      return null;
    }

    const targetCenters = this.getCursorTargetCenters(cursor, container);
    const measureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === measureNumber
    );

    if (!measureOverlay) {
      return null;
    }

    const left =
      targetCenters[0] ?? this.getMeasureTimestampX(currentMeasure, timestamp, measureOverlay);
    if (!Number.isFinite(left)) {
      return null;
    }

    const actionable = this.cursorStepHasActionablePracticeNote(
      cursor,
      this.getPracticeStaffSelection()
    );
    const nextTimestamp = this.getNextRawCursorTimestamp(cursor);
    const durationToNext =
      nextTimestamp !== null ? Math.max(nextTimestamp - timestamp, 0) : 0;

    return {
      id: `cursor-debug-${measureNumber}-${timestamp}-${index}`,
      left,
      top: measureOverlay.top,
      height: Math.max(measureOverlay.bottom - measureOverlay.top, 12),
      timestamp,
      durationToNext,
      measureNumber,
      actionable,
    };
  }

  private getCursorTargetCenters(cursor: any, container: HTMLElement): number[] {
    return this.getCursorTargetCentersByActionability(cursor, container, false);
  }

  private getCursorActionableTargetCenters(
    cursor: any,
    container: HTMLElement
  ): number[] {
    return this.getCursorTargetCentersByActionability(cursor, container, true);
  }

  private getCursorTargetCentersByActionability(
    cursor: any,
    container: HTMLElement,
    actionableOnly: boolean
  ): number[] {
    const practiceSelection = this.getPracticeStaffSelection();
    const graphicalNotes = (cursor?.GNotesUnderCursor?.() ?? []).filter((note: any) => {
      const staffId = note?.sourceNote?.ParentStaff?.idInMusicSheet;
      const staffSelected = staffId === undefined || practiceSelection[staffId];
      return (
        staffSelected &&
        (!actionableOnly || this.isActionableGraphicalPracticeNote(note))
      );
    });

    return graphicalNotes
      .map((graphicalNote: any) => {
        const groupElement = graphicalNote?.getSVGGElement?.() as SVGElement | null;
        const anchorElement = this.getGraphicalNoteAnchorElement(graphicalNote);
        if (!groupElement || !anchorElement) {
          return null;
        }

        const rect = this.getAnchorDomRect(anchorElement, groupElement, container);
        return rect ? rect.left + rect.width / 2 : null;
      })
      .filter((center: number | null): center is number => Number.isFinite(center))
      .sort((a: number, b: number) => a - b);
  }

  private getGraphicalPracticeTargetCenters(
    notes: PracticeGraphicalNote[],
    container: HTMLElement,
    actionableOnly: boolean
  ): number[] {
    const filteredNotes = actionableOnly
      ? notes.filter((note) => this.isActionableGraphicalPracticeNote(note.graphicalNote))
      : notes;

    return filteredNotes
      .map((note) =>
        this.getAnchorDomRect(note.anchorElement, note.groupElement, container)
      )
      .filter(
        (
          rect
        ): rect is { left: number; top: number; width: number; height: number } =>
          !!rect
      )
      .map((rect) => rect.left + rect.width / 2)
      .sort((a, b) => a - b);
  }

  private isActionableGraphicalPracticeNote(graphicalNote: any): boolean {
    const sourceNote = graphicalNote?.sourceNote;
    if (!sourceNote || sourceNote.isRest?.() === true) {
      return false;
    }

    return (
      typeof sourceNote.NoteTie === 'undefined' ||
      sourceNote === sourceNote.NoteTie?.StartNote
    );
  }

  private getMeasureTimestampX(
    measure: any,
    timestamp: number,
    overlay: MeasureOverlay
  ): number | null {
    const measureStart = measure?.AbsoluteTimestamp?.RealValue;
    const measureDuration = measure?.Duration?.RealValue;

    if (
      !Number.isFinite(measureStart) ||
      !Number.isFinite(measureDuration) ||
      measureDuration <= 0
    ) {
      return null;
    }

    const progress = Math.min(
      Math.max((timestamp - measureStart) / measureDuration, 0),
      1
    );
    return overlay.left + (overlay.right - overlay.left) * progress;
  }

  private getNextRawCursorTimestamp(cursor: any): number | null {
    const it2 = cursor?.iterator?.clone?.();
    if (!it2) {
      return null;
    }

    it2.moveToNext();
    if (it2.EndReached || this.inputMeasure.upper < it2.CurrentMeasureIndex + 1) {
      const measureStart =
        cursor.iterator?.CurrentMeasure?.AbsoluteTimestamp?.RealValue;
      const measureDuration =
        cursor.iterator?.CurrentMeasure?.Duration?.RealValue;
      if (!Number.isFinite(measureStart) || !Number.isFinite(measureDuration)) {
        return null;
      }

      return measureStart + measureDuration;
    }

    return it2.CurrentSourceTimestamp?.RealValue ?? null;
  }

  private cursorStepHasActionablePracticeNote(
    cursorLike: any,
    staffIdEnabled: Record<number, boolean>
  ): boolean {
    const voices = cursorLike?.VoicesUnderCursor?.() ?? [];

    for (const voice of voices) {
      for (const note of voice?.Notes ?? []) {
        const staffId = note?.ParentStaff?.idInMusicSheet;
        if (
          staffId !== undefined &&
          !staffIdEnabled[staffId]
        ) {
          continue;
        }

        if (note?.isRest?.() === true) {
          continue;
        }

        if (
          typeof note.NoteTie === 'undefined' ||
          note === note.NoteTie?.StartNote
        ) {
          return true;
        }
      }
    }

    return false;
  }

  getCursorDebugMarkerStyle(marker: CursorDebugMarker): Record<string, string> {
    return {
      left: `${marker.left}px`,
      top: `${marker.top}px`,
      height: `${marker.height}px`,
    };
  }

  private getGraphicalMeasuresForSourceMeasure(
    sourceMeasure: any,
    index: number,
    graphicSheet: any
  ): any[] {
    const fromSource = (sourceMeasure?.VerticalMeasureList ?? []).filter(
      (measure: any) => measure?.PositionAndShape
    );

    if (fromSource.length > 0) {
      return fromSource;
    }

    const fromGraphicSheet = (graphicSheet?.MeasureList?.[index] ?? []).filter(
      (measure: any) => measure?.PositionAndShape
    );

    return fromGraphicSheet;
  }

  private getGraphicalMeasureDomRect(
    measure: any,
    graphicSheet: any
  ): { left: number; right: number; top: number; bottom: number } | null {
    const box = measure?.PositionAndShape;
    if (!box) {
      return null;
    }

    const absoluteRect =
      box.AbsolutePosition &&
      Number.isFinite(box.BorderLeft) &&
      Number.isFinite(box.BorderRight) &&
      Number.isFinite(box.BorderTop) &&
      Number.isFinite(box.BorderBottom)
        ? {
            x:
              (box.AbsolutePosition.x + box.BorderLeft) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
            y:
              (box.AbsolutePosition.y + box.BorderTop) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
            width:
              (box.BorderRight - box.BorderLeft) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
            height:
              (box.BorderBottom - box.BorderTop) *
              PlayPageComponent.OSMD_UNIT_IN_PIXELS,
          }
        : null;

    const rect =
      absoluteRect ??
      box.BoundingRectangle ??
      (box.AbsolutePosition && box.Size
        ? {
            x: box.AbsolutePosition.x,
            y: box.AbsolutePosition.y,
            width: box.Size.width,
            height: box.Size.height,
          }
        : null);

    if (!rect) {
      return null;
    }

    const svgRect = this.convertSvgRectToDomRect(rect);
    if (svgRect) {
      return svgRect;
    }

    const topLeft = graphicSheet.svgToDom?.({ x: rect.x, y: rect.y });
    const bottomRight = graphicSheet.svgToDom?.({
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    });

    if (
      !topLeft ||
      !bottomRight ||
      !Number.isFinite(topLeft.x) ||
      !Number.isFinite(topLeft.y) ||
      !Number.isFinite(bottomRight.x) ||
      !Number.isFinite(bottomRight.y)
    ) {
      return null;
    }

    return {
      left: Math.min(topLeft.x, bottomRight.x),
      right: Math.max(topLeft.x, bottomRight.x),
      top: Math.min(topLeft.y, bottomRight.y),
      bottom: Math.max(topLeft.y, bottomRight.y),
    };
  }

  private convertSvgRectToDomRect(rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): { left: number; right: number; top: number; bottom: number } | null {
    const svg = document.querySelector('#osmdContainer svg') as SVGSVGElement | null;
    if (!svg) {
      return null;
    }

    const svgBounds = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const viewWidth = viewBox?.width || svg.width.baseVal.value;
    const viewHeight = viewBox?.height || svg.height.baseVal.value;
    const viewX = viewBox?.x ?? 0;
    const viewY = viewBox?.y ?? 0;

    if (
      !Number.isFinite(viewWidth) ||
      !Number.isFinite(viewHeight) ||
      viewWidth <= 0 ||
      viewHeight <= 0
    ) {
      return null;
    }

    const scaleX = svgBounds.width / viewWidth;
    const scaleY = svgBounds.height / viewHeight;

    return {
      left: svgBounds.left + (rect.x - viewX) * scaleX,
      right: svgBounds.left + (rect.x + rect.width - viewX) * scaleX,
      top: svgBounds.top + (rect.y - viewY) * scaleY,
      bottom: svgBounds.top + (rect.y + rect.height - viewY) * scaleY,
    };
  }

  private getSvgScaleFactors(): { scaleX: number; scaleY: number } | null {
    const svg = document.querySelector('#osmdContainer svg') as SVGSVGElement | null;
    if (!svg) {
      return null;
    }

    const svgBounds = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const viewWidth = viewBox?.width || svg.width.baseVal.value;
    const viewHeight = viewBox?.height || svg.height.baseVal.value;

    if (
      !Number.isFinite(viewWidth) ||
      !Number.isFinite(viewHeight) ||
      viewWidth <= 0 ||
      viewHeight <= 0
    ) {
      return null;
    }

    return {
      scaleX: svgBounds.width / viewWidth,
      scaleY: svgBounds.height / viewHeight,
    };
  }

  private startMetronome(): void {
    if (!this.checkboxMetronome) {
      return;
    }

    void startTone().catch(() => undefined);
  }

  private playCountInClick(): void {
    void startTone().catch(() => undefined);

    const isDownbeat = this.startFlashCount === 4;
    this.metronome?.triggerAttackRelease(
      isDownbeat ? 'A5' : 'E5',
      '16n',
      this.getScheduledAudioTime()
    );
  }

  private getCountInDelayMs(): number {
    const measure = this.openSheetMusicDisplay.cursors[0]?.iterator?.CurrentMeasure;
    const beatLength = measure ? this.getBeatLengthInWholeNotes(measure) : 0.25;
    return this.getPlaybackDelayMs(beatLength);
  }

  private getCursorStepDelayMs(cursorId: number): number {
    const cursor = this.openSheetMusicDisplay.cursors[cursorId];
    const iter = cursor?.iterator;

    if (!iter) {
      return 0;
    }

    if (this.osmdEndReached(cursorId)) {
      return this.getPlaybackDelayMs(
        iter.CurrentMeasure.AbsoluteTimestamp.RealValue +
          iter.CurrentMeasure.Duration.RealValue -
          iter.CurrentSourceTimestamp.RealValue
      );
    }

    const it2 = iter.clone();
    it2.moveToNext();
    let nextTimestamp = it2.CurrentSourceTimestamp.RealValue;
    let timeout = this.getPlaybackDelayMs(
      nextTimestamp - iter.CurrentSourceTimestamp.RealValue
    );

    if (timeout < 0) {
      nextTimestamp =
        iter.CurrentMeasure.AbsoluteTimestamp.RealValue +
        iter.CurrentMeasure.Duration.RealValue;
      timeout = this.getPlaybackDelayMs(
        nextTimestamp - iter.CurrentSourceTimestamp.RealValue
      );
    }

    return timeout;
  }

  private shouldAnimatePlayCursor(): boolean {
    return this.listenMode || this.realtimeMode;
  }

  private getPlayCursorElement(): HTMLElement | null {
    return document.getElementById('cursorImg-0');
  }

  private enforcePlayCursorThickness(cursorElement?: HTMLElement | null): void {
    const element = cursorElement ?? this.getPlayCursorElement();

    if (!element) {
      return;
    }

    element.style.width = '2px';
    element.style.minWidth = '2px';
    element.style.borderLeftWidth = '2px';
  }

  private getPlayCursorPosition(): { left: number; top: number } | null {
    const cursorElement = this.getPlayCursorElement();

    if (!cursorElement) {
      return null;
    }

    const left = parseFloat(cursorElement.style.left ?? '');
    const top = parseFloat(cursorElement.style.top ?? '');

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    return { left, top };
  }

  private applyPlayCursorTransition(durationMs: number): void {
    const cursorElement = this.getPlayCursorElement();

    if (!cursorElement || durationMs <= 0) {
      return;
    }

    this.enforcePlayCursorThickness(cursorElement);
    cursorElement.style.transition = `left ${durationMs}ms linear, top ${durationMs}ms linear, transform ${durationMs}ms linear`;
  }

  private resetPlayCursorTransition(): void {
    const cursorElement = this.getPlayCursorElement();

    if (cursorElement) {
      this.enforcePlayCursorThickness(cursorElement);
      cursorElement.style.transition = 'none';
      cursorElement.style.transform = '';
    }
  }

  private snapPlayCursorForJump(): void {
    const cursorElement = this.getPlayCursorElement();

    if (!cursorElement) {
      return;
    }

    this.enforcePlayCursorThickness(cursorElement);
    cursorElement.style.transition = 'none';
    cursorElement.style.transform = '';
  }

  private scheduleMetronomeWindow(
    startTimestamp: number,
    endTimestamp: number,
    audioStartTime: number
  ): void {
    if (
      !this.running ||
      !this.checkboxMetronome ||
      !Number.isFinite(startTimestamp) ||
      !Number.isFinite(endTimestamp) ||
      endTimestamp < startTimestamp
    ) {
      return;
    }

    const boundaryEpsilon = 1e-7;
    let beat = this.getMetronomeBeatAtOrAfter(startTimestamp);
    while (
      beat &&
      (Math.abs(beat.timestamp - startTimestamp) <= boundaryEpsilon ||
        beat.timestamp < endTimestamp - boundaryEpsilon)
    ) {
      const beatOffsetMs = this.getPlaybackDelayMs(beat.timestamp - startTimestamp);
      this.metronome?.triggerAttackRelease(
        beat.isDownbeat ? 'C6' : 'G5',
        '32n',
        audioStartTime + beatOffsetMs / 1000
      );
      beat = this.getNextMetronomeBeatAfter(beat.timestamp);
    }
  }

  private getMetronomeBeatAtOrAfter(timestamp: number): {
    timestamp: number;
    isDownbeat: boolean;
  } | null {
    const measure = this.getMeasureAtTimestamp(timestamp);
    if (!measure) {
      return null;
    }

    const beatLength = this.getBeatLengthInWholeNotes(measure);
    const measureStart = measure.AbsoluteTimestamp.RealValue;
    const measureEnd = measureStart + measure.Duration.RealValue;
    const beatIndex = Math.ceil(
      (timestamp - measureStart - Number.EPSILON) / beatLength
    );
    let beatTimestamp = measureStart + Math.max(beatIndex, 0) * beatLength;

    if (beatTimestamp > measureEnd + Number.EPSILON) {
      const nextMeasure = this.getMeasureAtTimestamp(measureEnd + Number.EPSILON);
      if (!nextMeasure) {
        return null;
      }
      return {
        timestamp: nextMeasure.AbsoluteTimestamp.RealValue,
        isDownbeat: true,
      };
    }

    return {
      timestamp: beatTimestamp,
      isDownbeat:
        Math.abs(beatTimestamp - measureStart) <= beatLength * Number.EPSILON * 8,
    };
  }

  private getNextMetronomeBeatAfter(timestamp: number): {
    timestamp: number;
    isDownbeat: boolean;
  } | null {
    const measure = this.getMeasureAtTimestamp(timestamp);
    if (!measure) {
      return null;
    }

    const beatLength = this.getBeatLengthInWholeNotes(measure);
    const measureStart = measure.AbsoluteTimestamp.RealValue;
    const measureEnd = measureStart + measure.Duration.RealValue;
    const nextTimestamp = timestamp + beatLength;

    if (nextTimestamp < measureEnd - Number.EPSILON) {
      return {
        timestamp: nextTimestamp,
        isDownbeat: false,
      };
    }

    const nextMeasure = this.getMeasureAtTimestamp(measureEnd + Number.EPSILON);
    if (!nextMeasure) {
      return null;
    }

    return {
      timestamp: nextMeasure.AbsoluteTimestamp.RealValue,
      isDownbeat: true,
    };
  }

  private getMeasureAtTimestamp(timestamp: number): any {
    const boundaryEpsilon = 1e-7;

    return this.openSheetMusicDisplay.Sheet.SourceMeasures.find(
      (measure: any) =>
        measure.AbsoluteTimestamp.RealValue <= timestamp + boundaryEpsilon &&
        timestamp <
          measure.AbsoluteTimestamp.RealValue +
            measure.Duration.RealValue -
            boundaryEpsilon
    );
  }

  private getBeatLengthInWholeNotes(measure: any): number {
    const denominator = measure.ActiveTimeSignature?.Denominator ?? 4;
    return 1 / denominator;
  }

  private getScheduledAudioTime(): number {
    return toneNow() + PlayPageComponent.AUDIO_SCHEDULE_AHEAD_SEC;
  }

  async notifyMidiConnect() {
    const toast = await this.toastCtrl.create({
      message: `MIDI device connected: ${this.midiDevice}. Practice mode enabled.`,
      position: 'bottom',
      duration: 3000,
      icon: 'flash-outline',
    });
    await toast.present();
  }

  async notifyMidiDisconnect() {
    const toast = await this.toastCtrl.create({
      message: `No MIDI devices found. Practice mode disabled.`,
      position: 'bottom',
      duration: 3000,
      icon: 'flash-off-outline',
    });
    await toast.present();
  }

  midiDeviceHandler(devices: any) {
    if (devices.length) {
      this.midiAvailable = true;
      this.midiDevice = devices.join(', ');
      this.notifyMidiConnect();
    } else {
      this.midiAvailable = false;
      this.midiDevice = 'None';
      this.notifyMidiDisconnect();

      // Stop if needed
      if (this.isPracticing()) {
        this.osmdStop();
      }
    }
  }

  async midiRelease() {
    await Promise.all(this.midiHandlers.map((h) => h.remove()));
    this.midiHandlers = [];
  }

  async refreshMidiDevices(event: RefresherCustomEvent) {
    await this.midiRelease();
    await this.midiSetup();
    event.target.complete();
  }

  // Initialize MIDI
  async midiSetup(): Promise<void> {
    const dvc = await CapacitorMuseTrainerMidi.addListener(
      'deviceChange',
      ({ devices }: any) => this.midiDeviceHandler(devices)
    );

    const cmd = await CapacitorMuseTrainerMidi.addListener(
      'commandReceive',
      (note: any) => {
        if (note.type === 'noteOn') {
          this.keyNoteOn(Date.now(), note.dataByte1);
        } else if (note.type === 'noteOff') {
          this.keyNoteOff(Date.now(), note.dataByte1);
        }
      }
    );

    this.midiHandlers.push(dvc, cmd);

    const { devices } = await CapacitorMuseTrainerMidi.listDevices();
    this.midiDeviceHandler(devices);
  }

  // Press note on Ouput MIDI Device
  keyPressNote(pitch: number, velocity: number, audioTime?: number): void {
    this.keyPressNoteInternal(pitch, velocity, audioTime, true);
  }

  keyPressNoteInternal(
    pitch: number,
    velocity: number,
    audioTime?: number,
    reflectInput: boolean = true
  ): void {
    this.mapNotesAutoPressed.set((pitch - 12).toFixed(), 1);
    if (reflectInput) {
      this.timeouts.push(
        setTimeout(() => {
          this.keyNoteOn(Date.now() - this.timePlayStart, pitch);
        }, 0)
      );
    }

    if (this.midiAvailable && this.checkboxMidiOut) {
      CapacitorMuseTrainerMidi.sendCommand({
        command: [0x90, pitch, velocity],
        timestamp: performance.now(),
      }).catch((e) => console.error(e));
    } else {
      this.piano?.keyDown({ midi: pitch, time: audioTime });
    }
  }

  // Release note on Ouput MIDI Device
  keyReleaseNote(pitch: number, audioTime?: number): void {
    this.keyReleaseNoteInternal(pitch, audioTime, true);
  }

  keyReleaseNoteInternal(
    pitch: number,
    audioTime?: number,
    reflectInput: boolean = true
  ): void {
    this.mapNotesAutoPressed.delete((pitch - 12).toFixed());
    if (reflectInput) {
      this.timeouts.push(
        setTimeout(() => {
          this.keyNoteOff(Date.now() - this.timePlayStart, pitch);
        }, 0)
      );
    }

    if (this.midiAvailable && this.checkboxMidiOut) {
      CapacitorMuseTrainerMidi.sendCommand({
        command: [0x80, pitch, 0x00],
        timestamp: performance.now(),
      }).catch((e) => console.error(e));
    } else {
      this.piano?.keyUp({ midi: pitch, time: audioTime });
    }
  }

  // Input note pressed
  keyNoteOn(time: number, pitch: number): void {
    const halbTone = pitch - 12;
    const name = halbTone.toFixed();
    const pitchLabel = this.noteKeyToLabel(name);
    const requiredPressKeys = this.getCurrentRequiredPressKeys();
    const acceptedLateRealtimeNote = this.isAcceptedLateRealtimeNote(name);
    const matchesCurrentStep = requiredPressKeys.has(name);
    this.updateRealtimeDebugWindow();
    this.debugRealtimeStats.playedTotal++;

    if (!acceptedLateRealtimeNote) {
      this.notesService.press(name);
    }

    // Key wrong pressed
    if (
      !matchesCurrentStep &&
      this.isPracticing() &&
      (this.checkboxFeedback || this.realtimeMode)
    ) {
      if (acceptedLateRealtimeNote) {
        this.acceptLateRealtimeNote(name);
      } else {
        if (this.realtimeMode && this.realtimeNextStepKeys.has(name)) {
          this.debugRealtimeStats.early++;
          this.debugRealtimeStats.lastPitch = pitchLabel;
          this.debugRealtimeStats.lastResult = 'early';
          this.appendRealtimeDebugEvent(`${pitchLabel} early`);
          this.updateRealtimeDebugWindow();
        } else {
          this.debugRealtimeStats.rejected++;
          this.debugRealtimeStats.lastPitch = pitchLabel;
          this.debugRealtimeStats.lastResult = 'rejected';
          this.appendRealtimeDebugEvent(`${pitchLabel} rejected`);
          this.updateRealtimeDebugWindow();
          this.markIncorrectInputNote(halbTone);
        }
      }
    }

    if (
      !acceptedLateRealtimeNote &&
      matchesCurrentStep &&
      !this.realtimeCurrentStepMatchedKeys.has(name)
    ) {
      this.realtimeCurrentStepMatchedKeys.add(name);
      this.markCurrentNoteCorrect(name);
      this.debugRealtimeStats.acceptedOnTime++;
      this.debugRealtimeStats.lastPitch = pitchLabel;
      this.debugRealtimeStats.lastResult = 'hit current';
      this.appendRealtimeDebugEvent(`${pitchLabel} hit`);
      this.updateRealtimeDebugWindow();
    }

    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    if (!acceptedLateRealtimeNote && this.notesService.isRequiredNotesPressed()) {
      this.debugRealtimeStats.lastPitch = pitchLabel;
      this.debugRealtimeStats.lastResult = 'step satisfied';
      this.appendRealtimeDebugEvent(`${pitchLabel} step satisfied`);
      this.updateRealtimeDebugWindow();
      this.markCurrentNotesCorrect();
      if (this.realtimeMode) {
        this.currentStepSatisfied = true;
      } else {
        this.osmdCursorPlayMoveNext();
      }
    }
  }

  // Input note released
  keyNoteOff(time: number, pitch: number): void {
    const halbTone = pitch - 12;
    const name = halbTone.toFixed();
    this.updateRealtimeDebugWindow();
    if (this.isAcceptedLateRealtimeNote(name)) {
      return;
    }
    this.notesService.release(name);

    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    if (!this.realtimeMode && this.notesService.isRequiredNotesPressed()) {
      this.markCurrentNotesCorrect();
      this.osmdCursorPlayMoveNext();
    }
  }

  private isRealtimePlaybackOnly(): boolean {
    return this.staffIdList.length > 0
      ? this.staffIdList.every((id) => this.staffIdEnabled[id])
      : true;
  }

  private getPracticeStaffSelection(): Record<number, boolean> {
    if (!this.realtimeMode) {
      return this.staffIdEnabled;
    }

    return this.staffIdList.reduce(
      (selection, id) => ({
        ...selection,
        [id]: !this.staffIdEnabled[id],
      }),
      {} as Record<number, boolean>
    );
  }

  private getComputerStaffSelection(): Record<number, boolean> {
    return this.staffIdList.reduce(
      (selection, id) => ({
        ...selection,
        [id]: this.realtimeMode ? this.staffIdEnabled[id] : false,
      }),
      {} as Record<number, boolean>
    );
  }

  private syncRealtimeStepState(back = false): void {
    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getPracticeStaffSelection(),
      back
    );
    this.clearRealtimeCurrentStepMatches();
    this.activePracticeGraphicalNotes = this.getCurrentPracticeGraphicalNotes();
    this.activePracticeNoteElements = this.getCurrentPracticeNoteElements();
    this.updatePlayCursorVisualAlignment();
    this.computerNotesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getComputerStaffSelection(),
      back
    );
    this.tempoInBPM = this.resolveRealtimeTempo();
    const hasCurrentRequiredPressKeys = this.hasCurrentRequiredPressKeys();
    this.currentStepSatisfied =
      !hasCurrentRequiredPressKeys ||
      this.notesService.isRequiredNotesPressed();
    this.refreshRealtimeNextStepKeys();
  }

  private refreshRealtimeNextStepKeys(): void {
    if (!this.realtimeMode) {
      this.clearRealtimeDebugPrediction();
      return;
    }

    const cursor = this.openSheetMusicDisplay?.cursors?.[0];
    const iter = cursor?.iterator?.clone?.();
    if (!iter) {
      this.clearRealtimeDebugPrediction();
      return;
    }

    iter.moveToNext();
    if (iter.EndReached) {
      this.clearRealtimeDebugPrediction();
      return;
    }

    const debugCursor: any = {
      iterator: iter,
      VoicesUnderCursor: () => iter.CurrentVisibleVoiceEntries(),
    };
    const debugNotesService = new NotesService();
    debugNotesService.calculateRequired(
      debugCursor,
      this.getPracticeStaffSelection()
    );
    this.realtimeNextStepKeys = this.getCurrentRequiredPressKeys(debugNotesService);
  }

  private advanceRealtimePractice(audioTime: number): void {
    if (!this.realtimeMode) {
      return;
    }

    if (this.osmdEndReached(0)) {
      if (this.checkboxRepeat) {
        const startedLoopWrapAnimation = this.startPlayCursorLoopWrapAnimation(
          this.getCursorStepDelayMs(0),
          () => {
            this.loopPass++;
            this.markCursorTraceLoopBoundary('loop wrap');
            this.osmdCursorStart();
          }
        );
        if (!startedLoopWrapAnimation) {
          this.loopPass++;
          this.markCursorTraceLoopBoundary('loop wrap');
          this.osmdCursorStart();
        }
      } else {
        this.openSheetMusicDisplay.cursors[0].hide();
        this.osmdCursorStop();
      }
      return;
    }

    const currentRequiredPressKeys = this.getCurrentRequiredPressKeys();

    if (this.currentStepSatisfied && currentRequiredPressKeys.size > 0) {
      this.markCurrentNotesCorrect();
    } else if (currentRequiredPressKeys.size > 0) {
      const missedKeys = Array.from(currentRequiredPressKeys).filter(
        (key) => !this.realtimeCurrentStepMatchedKeys.has(key)
      );
      if (missedKeys.length > 0) {
        this.debugRealtimeStats.missedExpected += missedKeys.length;
        this.appendRealtimeDebugEvent(
          `missed ${missedKeys
            .map((key) => this.noteKeyToLabel(key))
            .join(', ')}`
        );
      }
    }

    this.snapshotRealtimePreviousStep();

    if (!this.osmdCursorMoveNext(0)) {
      return;
    }

    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getPracticeStaffSelection()
    );
    this.clearRealtimeCurrentStepMatches();
    this.activePracticeGraphicalNotes = this.getCurrentPracticeGraphicalNotes();
    this.activePracticeNoteElements = this.getCurrentPracticeNoteElements();
    this.updatePlayCursorVisualAlignment();
    this.computerNotesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getComputerStaffSelection()
    );
    this.tempoInBPM = this.resolveRealtimeTempo();
    const hasCurrentRequiredPressKeys = this.hasCurrentRequiredPressKeys();
    this.currentStepSatisfied =
      !hasCurrentRequiredPressKeys ||
      this.notesService.isRequiredNotesPressed();
    if (this.pianoKeyboard) {
      this.pianoKeyboard.updateNotesStatus();
    }
    this.playComputerNotes(audioTime);
  }

  private playComputerNotes(audioTime?: number): void {
    if (!this.realtimeMode) {
      return;
    }

    this.computerNotesService.playRequiredNotes(
      (note, velocity) => {
        const key = (note - 12).toFixed();
        this.computerPressedNotes.set(key, 1);
        this.computerNotesService.press(key);
        this.keyPressNoteInternal(note, velocity, audioTime, false);
      },
      (note) => {
        const key = (note - 12).toFixed();
        this.computerPressedNotes.delete(key);
        this.computerNotesService.release(key);
        this.keyReleaseNoteInternal(note, audioTime, false);
      }
    );
  }

  private releaseComputerPressedNotes(): void {
    for (const [key] of this.computerPressedNotes) {
      this.computerNotesService.release(key);
      this.keyReleaseNoteInternal(parseInt(key) + 12, undefined, false);
    }
    this.computerPressedNotes.clear();
  }

  private resolveRealtimeTempo(): number {
    const candidates = [
      this.notesService.tempoInBPM,
      this.computerNotesService.tempoInBPM,
    ];

    const realtimeTempo = candidates.find(
      (tempo) => Number.isFinite(tempo) && (tempo as number) > 0
    );

    return realtimeTempo ?? this.tempoInBPM;
  }

  // Keep screen on
  keepAwake(): void {
    KeepAwake.isSupported().then((is) => {
      if (is.isSupported) {
        KeepAwake.keepAwake();
      }
    });
  }

  // Allow screen off
  allowSleep(): void {
    KeepAwake.isSupported().then((is) => {
      if (is.isSupported) {
        KeepAwake.allowSleep();
      }
    });
  }
}
