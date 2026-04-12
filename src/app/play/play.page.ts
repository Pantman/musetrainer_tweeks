import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  isDevMode,
} from '@angular/core';
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
import {
  AMSynth,
  FMSynth,
  Frequency,
  now as toneNow,
  PolySynth,
  start as startTone,
  Synth,
} from 'tone';

import { NoteObject, NotesService } from '../notes.service';
import { PianoKeyboardComponent } from '../piano-keyboard/piano-keyboard.component';
import { Capacitor, PluginListenerHandle } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import packageJson from '../../../package.json';

declare const Ionic: any;

declare global {
  interface Window {
    __museDebug?: {
      getWrapLog: () => string[];
      getRealtimeLog: () => string[];
      getCursorTrace: () => string[];
      getTimedLiveCursorDebug: () => Record<string, unknown>;
      clearWrapLog: () => void;
      clearRealtimeLog: () => void;
      clearCursorTrace: () => void;
      getState: () => Record<string, unknown>;
      playListen: () => void;
      playWait: () => void;
      playRealtime: () => void;
      stop: () => void;
      setTimedCursorDebug: (enabled?: boolean) => void;
      setTimedCursorSim: (
        enabled?: boolean,
        offsetMs?: number,
        pitchOffsetSemitones?: number
      ) => void;
      enableConsoleRelay: (
        channel?: 'wrap' | 'realtime' | 'trace' | 'all',
        enabled?: boolean
      ) => void;
      enableLocalRelay: (
        channel?: 'wrap' | 'realtime' | 'trace' | 'all',
        enabled?: boolean
      ) => void;
      setLocalRelayUrl: (url: string) => void;
      clearLocalRelay: () => Promise<void>;
      getRelayStatus: () => Record<string, unknown>;
      dumpWrapLog: () => string[];
    };
  }
}

type TempoPreset = 'normal' | 'slow' | 'verySlow' | 'custom';
type RangeHandle = 'start' | 'end';
type TransportMode = 'listen' | 'wait' | 'realtime';
type PlaybackStartReason = 'fresh' | 'loop-restart';
type FeedbackAccidentalKind = 'sharp' | 'flat' | 'natural';
type SoftwareInstrumentProfile =
  | 'piano'
  | 'organ'
  | 'guitar'
  | 'bass'
  | 'strings'
  | 'choir'
  | 'lead'
  | 'pad'
  | 'brass';

interface FeedbackAccidentalMarker {
  kind: FeedbackAccidentalKind;
  symbol: string;
  fontSize: number;
}

interface FeedbackNoteheadPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
  accidental?: FeedbackAccidentalMarker | null;
}

interface SourcePitchInfo {
  halfTone: number;
  fundamentalNote: number;
  octave: number;
  accidentalHalfTones: number;
}

interface IncorrectPitchSpelling {
  fundamentalNote: number;
  octave: number;
  accidentalHalfTones: number;
  diatonicStepIndex: number;
  displayAccidental: FeedbackAccidentalKind | null;
}

interface ActiveSoftwareOutputRoute {
  profile: SoftwareInstrumentProfile;
  pitch: number;
}

interface MeasureOverlay {
  measureNumber: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface IncorrectFeedbackStaffGeometry {
  measureNumber: number;
  staffId: number;
  topLineY: number;
  bottomLineY: number;
  lineSpacing: number;
  middleCY: number;
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
  staffId: number | null;
  pitchInfo: SourcePitchInfo | null;
}

interface PlayCursorLoopWrapAnimation {
  boundaryTimeMs: number;
  boundaryDurationMs: number;
  finalNoteBaseLeft: number;
  finalNoteX: number;
  endBarlineX: number;
  boundaryTriggered: boolean;
  restarted: boolean;
  restartBaseLeft: number | null;
  restartDurationMs: number;
  startBarlineX: number;
  firstNoteX: number;
}

interface PlaybackClockState {
  scheduledAudioTimeSec: number | null;
  pendingLoopRestartAudioTimeSec: number | null;
}

interface PlaybackLoopCheckpoint {
  range: MeasureRange;
  enrolledTimestamp: any;
  cursorTargetX: number | null;
  measureLeftX: number | null;
}

interface PlaybackStartContext {
  reason: PlaybackStartReason;
  audioSeedTimeSec: number | null;
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

interface TimedLiveCursorNote {
  halfTone: number;
  staffId: number | null;
  actionable: boolean;
  soundingDurationWholeNotes: number;
  pitchInfo: SourcePitchInfo | null;
  left: number | null;
  top: number | null;
  width: number;
  height: number;
}

interface TimedLiveCursorEvent {
  id: string;
  measureNumber: number;
  timestamp: number;
  durationToNext: number;
  left: number;
  top: number;
  height: number;
  barStartX: number;
  barEndX: number;
  systemId: number | null;
  actionable: boolean;
  actionableTargets: number[];
  allTargets: number[];
  notes: TimedLiveCursorNote[];
}

interface TimedLiveCursorSegment {
  id: string;
  startTimestamp: number;
  endTimestamp: number;
  duration: number;
  startLeft: number;
  startTop: number;
  startHeight: number;
  endLeft: number;
  endTop: number;
  endHeight: number;
  wrapsSystem: boolean;
  wrapExitX: number | null;
  wrapEntryX: number | null;
}

interface TimedLiveCursorTimeline {
  range: MeasureRange;
  startTimestamp: number;
  startLeft: number;
  startTop: number;
  startHeight: number;
  endTimestamp: number;
  endLeft: number;
  endTop: number;
  endHeight: number;
  events: TimedLiveCursorEvent[];
  segments: TimedLiveCursorSegment[];
  builtAt: number;
}

interface TimedLiveCursorRenderState {
  left: number;
  top: number;
  height: number;
  visible: boolean;
  scoreTimestamp: number | null;
  transitionMode: 'smooth' | 'teleport';
}

interface TimedLiveCursorWindowRect {
  id: string;
  staffId: number | null;
  systemId: number | null;
  label: string;
  noteCount: number;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

interface TimedLiveCursorThresholdMarker {
  id: string;
  label: string;
  left: number;
  top: number;
  height: number;
  color: string;
}

interface TimedLiveCursorDebugSnapshot {
  scoreTimestamp: number | null;
  currentEventId: string | null;
  currentEventLabel: string;
  currentSegmentId: string | null;
  currentSegmentLabel: string;
  progressPercent: number | null;
  wrapsSystem: boolean;
  windowStartTimestamp: number | null;
  windowEndTimestamp: number | null;
  windowMs: number;
  windowNoteCountByStaff: Record<string, number>;
  earlyThresholdMs: number;
  lateThresholdMs: number;
  earlyThresholdVisible: boolean;
  lateThresholdVisible: boolean;
}

interface TimedLiveCursorDebugSessionTotals {
  frames: number;
  segmentTransitions: number;
  wrapTransitions: number;
}

interface TimedLiveCursorDebugPanelPosition {
  left: number;
  top: number;
}

interface TimedLiveSimulatedFeedbackStats {
  scheduled: number;
  triggered: number;
  onTime: number;
  early: number;
  late: number;
  missed: number;
}

type TimedLiveSimulatedFeedbackTimingClass =
  | 'correct'
  | 'early'
  | 'late'
  | 'miss';

interface TimedLiveSimulatedPendingNote {
  event: TimedLiveCursorEvent;
  note: TimedLiveCursorNote;
  timingClass: TimedLiveSimulatedFeedbackTimingClass;
  hitTimestamp: number;
  playedHalfTone: number;
  loopPass: number;
  index: number;
}

interface TimedLiveMatchedRealtimeNote {
  event: TimedLiveCursorEvent;
  note: TimedLiveCursorNote;
  index: number;
  timingClass: TimedLiveSimulatedFeedbackTimingClass;
  offsetMs: number;
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
export class PlayPageComponent implements OnInit, OnDestroy {
  private static readonly DEFAULT_TEMPO_BPM = 120;
  private static readonly OSMD_UNIT_IN_PIXELS = 10;
  private static readonly MIN_SPEED_PERCENT = 30;
  private static readonly MAX_SPEED_PERCENT = 180;
  private static readonly TEMPO_STEP_BPM = 5;
  private static readonly AUDIO_SCHEDULE_AHEAD_SEC = 0.05;
  private static readonly REALTIME_ACCEPT_TOLERANCE_WHOLE_NOTES = 1 / 4;
  private static readonly TIMED_LIVE_DEBUG_WINDOW_WHOLE_NOTES = 1 / 4;
  private static readonly TIMED_LIVE_DEBUG_THRESHOLD_WHOLE_NOTES = 1 / 8;
  private static readonly DEFAULT_TIMED_LIVE_SIMULATION_THRESHOLD_MS =
    Math.round(
      (PlayPageComponent.TIMED_LIVE_DEBUG_THRESHOLD_WHOLE_NOTES * 4 * 60000) /
        PlayPageComponent.DEFAULT_TEMPO_BPM
    );
  private static readonly MAX_TIMED_LIVE_SIMULATION_THRESHOLD_MS = 2000;
  private static readonly MAX_TIMED_LIVE_SIMULATION_TIMING_OFFSET_MS = 4000;
  private static readonly MAX_TIMED_LIVE_SIMULATION_PITCH_OFFSET_SEMITONES = 24;
  private static readonly MIDDLE_C_HALF_TONE = 48;
  private static readonly FEEDBACK_CORRECT_FILL = '#2f9e7a';
  private static readonly FEEDBACK_CORRECT_BORDER = '#1f6e55';
  private static readonly FEEDBACK_CORRECT_HALO =
    '0 0 0 1px rgb(255 255 255 / 0.18)';
  private static readonly FEEDBACK_EARLY_FILL = '#3f7cac';
  private static readonly FEEDBACK_EARLY_BORDER = '#2b5680';
  private static readonly FEEDBACK_EARLY_HALO =
    '0 0 0 1px rgb(255 255 255 / 0.22)';
  private static readonly FEEDBACK_LATE_FILL = '#c38d2c';
  private static readonly FEEDBACK_LATE_BORDER = '#8a6215';
  private static readonly FEEDBACK_LATE_HALO =
    '0 0 0 1px rgb(255 255 255 / 0.22)';
  private static readonly FEEDBACK_MISS_FILL = '#d1495b';
  private static readonly FEEDBACK_MISS_BORDER = '#9b2d42';
  private static readonly FEEDBACK_MISS_HALO =
    '0 0 0 1px rgb(255 255 255 / 0.25)';
  // Bump this marker whenever we want a visibly new play-screen build badge.
  private static readonly PLAY_SCREEN_BUILD_MARKER = '2026.04.12.6';
  private static readonly ENABLE_CURSOR_TRACE = false;
  @ViewChild(IonContent, { static: false }) content!: IonContent;
  @ViewChild(PianoKeyboardComponent)
  private pianoKeyboard?: PianoKeyboardComponent;
  openSheetMusicDisplay!: OpenSheetMusicDisplay;

  playVersion = '';
  playBuildLabel = '';

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
  checkboxMidiInputAudio: boolean = true;
  checkboxMetronome: boolean = true;
  checkboxWaitMode: boolean = false;
  checkboxFeedback: boolean = true;
  showRangePicker: boolean = false;
  inputMeasure = { lower: 0, upper: 0 };
  inputMeasureRange = { lower: 0, upper: 0 };
  measureOverlays: MeasureOverlay[] = [];
  private incorrectFeedbackStaffGeometry = new Map<
    string,
    IncorrectFeedbackStaffGeometry
  >();
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
  private autoPressedMidiInstrumentIds = new Map<string, number | null>();

  // Play
  timePlayStart: number = 0;
  playbackStartScoreTimestamp: number = 0;
  private playbackStartAudioTimeSec: number | null = null;
  private transportMode: TransportMode | null = null;
  private playbackClock: PlaybackClockState = {
    scheduledAudioTimeSec: null,
    pendingLoopRestartAudioTimeSec: null,
  };
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
  private loopStartCheckpoint: PlaybackLoopCheckpoint | null = null;
  playCursorLoopWrapAnimation: PlayCursorLoopWrapAnimation | null = null;
  private playCursorLoopBoundaryTimeout: NodeJS.Timeout | null = null;
  pendingLoopRestartCursorTeleport: boolean = false;
  suppressPlayCursorAlignmentForStep: boolean = false;
  private lastPlayCursorTransitionDurationMs: number = 0;
  private pendingDeferredTieStepAdvance: boolean = false;
  private pendingTimedStartBootstrapAdvance: boolean = false;
  private heldTieContinuationRenderTimeout: number | null = null;
  private activeRangeHandle: RangeHandle | null = null;
  private activeRangeSelectionStart: number | null = null;

  // tonejs/piano
  piano: Piano | null = null;
  metronome: Synth | null = null;
  private softwareInstrumentBank = new Map<
    Exclude<SoftwareInstrumentProfile, 'piano'>,
    PolySynth<any>
  >();
  private activeSoftwareOutputCounts = new Map<string, number>();
  private activeSoftwareOutputRoutes = new Map<string, ActiveSoftwareOutputRoute>();
  private monitoredMidiInputCounts = new Map<number, number>();
  private monitoredMidiInputInstruments = new Map<number, number | null>();
  private monitoredMidiInputRouteKeys = new Map<number, string | null>();
  private autoPressedSoftwareRouteKeys = new Map<string, string | null>();
  computerPressedNotes = new Map<string, number>();
  computerNotesService: NotesService;
  private correctNoteheadElements = new Map<string, HTMLElement>();
  private incorrectNoteheadElements = new Map<string, HTMLElement>();
  private timingFeedbackNoteheadElements = new Map<string, HTMLElement>();
  private feedbackInstanceSequence = 0;
  private activePracticeNoteElements: SVGElement[] = [];
  private activePracticeGraphicalNotes: PracticeGraphicalNote[] = [];
  private correctlyHeldPracticeKeys = new Set<string>();
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
  showCursorDebugOverlay: boolean = false;
  showDebugConsoleOverlay: boolean = false;
  showCursorWrapDebugOverlay: boolean = false;
  showTimedLiveCursorDebugOverlay: boolean = false;
  timedLiveEarlyLateFeedbackUsesCursorAnchor: boolean = true;
  cursorWrapDebugEvents: string[] = [];
  cursorWrapDebugSnapshot: CursorWrapDebugSnapshot | null = null;
  private cursorDebugRefreshTimeout: number | null = null;
  timedLiveCursorTimeline: TimedLiveCursorTimeline | null = null;
  timedLiveCursorRenderState: TimedLiveCursorRenderState | null = null;
  timedLiveCursorWindowRects: TimedLiveCursorWindowRect[] = [];
  timedLiveCursorThresholdMarkers: TimedLiveCursorThresholdMarker[] = [];
  timedLiveCursorDebugSnapshot: TimedLiveCursorDebugSnapshot | null = null;
  timedLiveCursorDebugSessionTotals: TimedLiveCursorDebugSessionTotals = {
    frames: 0,
    segmentTransitions: 0,
    wrapTransitions: 0,
  };
  private timedLiveCursorRefreshTimeout: number | null = null;
  private timedLiveCursorAnimationFrame: number | null = null;
  private timedLiveCursorLastSegmentId: string | null = null;
  timedLiveCursorDebugPanelPosition: TimedLiveCursorDebugPanelPosition | null =
    null;
  private timedLiveCursorDebugPanelDragOffset: { x: number; y: number } | null =
    null;
  private timedLiveCursorDebugPanelSize: { width: number; height: number } | null =
    null;
  timedLiveSimulatedInputEnabled: boolean = false;
  timedLiveSimulatedTimingOffsetMs: number = 0;
  timedLiveSimulatedPitchOffsetSemitones: number = 0;
  timedLiveSimulationEarlyThresholdMs: number =
    PlayPageComponent.DEFAULT_TIMED_LIVE_SIMULATION_THRESHOLD_MS;
  timedLiveSimulationLateThresholdMs: number =
    PlayPageComponent.DEFAULT_TIMED_LIVE_SIMULATION_THRESHOLD_MS;
  timedLiveSimulatedFeedbackStats: TimedLiveSimulatedFeedbackStats = {
    scheduled: 0,
    triggered: 0,
    onTime: 0,
    early: 0,
    late: 0,
    missed: 0,
  };
  private timedLiveSimulatedScheduleTimeouts: NodeJS.Timeout[] = [];
  private timedLiveSimulatedFeedbackTimeouts: NodeJS.Timeout[] = [];
  private timedLiveSimulatedPendingNotes = new Map<
    string,
    TimedLiveSimulatedPendingNote[]
  >();
  private timedLiveSimulatedProcessedEventNotes = new Map<string, Set<number>>();
  private timedLiveRealtimeMatchedEventNotes = new Map<string, Set<number>>();
  private timedLiveSimulatedHeldNotes = new Map<string, number>();
  private timedLiveSimulatedOutputTokens = new Map<number, number>();
  private timedLiveSimulatedOutputInstrumentIds = new Map<number, number | null>();
  private timedLiveSimulatedOutputRouteKeys = new Map<number, string | null>();
  private timedLiveSimulatedOutputTokenSeed = 0;
  private museDebugConsoleRelay = {
    wrap: false,
    realtime: false,
    trace: false,
  };
  private museDebugLocalRelay = {
    wrap: false,
    realtime: false,
    trace: false,
  };
  private museDebugLocalRelayUrl = 'http://127.0.0.1:4310/log';
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
    this.playBuildLabel = `${this.playVersion}+${PlayPageComponent.PLAY_SCREEN_BUILD_MARKER}`;
    this.installMuseDebugApi();
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

  ngOnDestroy(): void {
    window.removeEventListener(
      'pointermove',
      this.onTimedLiveCursorDebugPanelPointerMove
    );
    window.removeEventListener(
      'pointerup',
      this.onTimedLiveCursorDebugPanelPointerUp
    );
    this.uninstallMuseDebugApi();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.clampTimedLiveCursorDebugPanelPosition();
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
    this.uninstallMuseDebugApi();
    // osmd
    this.osmdReset();
    this.openSheetMusicDisplay.clear();
    // piano
    this.disposeSoftwareInstrumentBank();
    this.piano = null;
    this.metronome = null;
    // wake
    this.allowSleep();
    // midi
    this.midiRelease();
  }

  pianoSetup() {
    this.disposeSoftwareInstrumentBank();
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
    this.initializeSoftwareInstrumentBank();
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

  private initializeSoftwareInstrumentBank(): void {
    this.softwareInstrumentBank.set(
      'organ',
      this.createPolySynth(AMSynth, {
        volume: -12,
        harmonicity: 1.75,
        oscillator: {
          type: 'square',
        },
        envelope: {
          attack: 0.01,
          decay: 0.08,
          sustain: 0.95,
          release: 0.12,
        },
        modulation: {
          type: 'square',
        },
        modulationEnvelope: {
          attack: 0.02,
          decay: 0.05,
          sustain: 1,
          release: 0.1,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'guitar',
      this.createPolySynth(FMSynth, {
        volume: -10,
        harmonicity: 1.5,
        modulationIndex: 6,
        oscillator: {
          type: 'triangle',
        },
        envelope: {
          attack: 0.005,
          decay: 0.18,
          sustain: 0.08,
          release: 0.2,
        },
        modulation: {
          type: 'sine',
        },
        modulationEnvelope: {
          attack: 0.001,
          decay: 0.16,
          sustain: 0.05,
          release: 0.08,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'bass',
      this.createPolySynth(Synth, {
        volume: -8,
        oscillator: {
          type: 'triangle',
        },
        envelope: {
          attack: 0.01,
          decay: 0.16,
          sustain: 0.45,
          release: 0.22,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'strings',
      this.createPolySynth(Synth, {
        volume: -14,
        oscillator: {
          type: 'sawtooth',
        },
        envelope: {
          attack: 0.06,
          decay: 0.18,
          sustain: 0.6,
          release: 1.1,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'choir',
      this.createPolySynth(AMSynth, {
        volume: -16,
        harmonicity: 1.25,
        oscillator: {
          type: 'sine',
        },
        envelope: {
          attack: 0.08,
          decay: 0.25,
          sustain: 0.9,
          release: 1.8,
        },
        modulation: {
          type: 'triangle',
        },
        modulationEnvelope: {
          attack: 0.18,
          decay: 0.22,
          sustain: 0.8,
          release: 1.2,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'lead',
      this.createPolySynth(FMSynth, {
        volume: -12,
        harmonicity: 1.9,
        modulationIndex: 8,
        oscillator: {
          type: 'sawtooth',
        },
        envelope: {
          attack: 0.01,
          decay: 0.14,
          sustain: 0.42,
          release: 0.22,
        },
        modulation: {
          type: 'square',
        },
        modulationEnvelope: {
          attack: 0.02,
          decay: 0.12,
          sustain: 0.3,
          release: 0.1,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'pad',
      this.createPolySynth(AMSynth, {
        volume: -18,
        harmonicity: 1.01,
        oscillator: {
          type: 'sine',
        },
        envelope: {
          attack: 0.18,
          decay: 0.3,
          sustain: 0.85,
          release: 1.8,
        },
        modulation: {
          type: 'triangle',
        },
        modulationEnvelope: {
          attack: 0.25,
          decay: 0.2,
          sustain: 0.75,
          release: 1.4,
        },
      })
    );
    this.softwareInstrumentBank.set(
      'brass',
      this.createPolySynth(FMSynth, {
        volume: -12,
        harmonicity: 1.4,
        modulationIndex: 7,
        oscillator: {
          type: 'square',
        },
        envelope: {
          attack: 0.015,
          decay: 0.1,
          sustain: 0.55,
          release: 0.28,
        },
        modulation: {
          type: 'sawtooth',
        },
        modulationEnvelope: {
          attack: 0.02,
          decay: 0.16,
          sustain: 0.35,
          release: 0.12,
        },
      })
    );
  }

  private createPolySynth(voice: any, options: any): PolySynth<any> {
    return new PolySynth(voice, options).toDestination();
  }

  private disposeSoftwareInstrumentBank(): void {
    this.releaseMonitoredMidiInputNotes();
    this.activeSoftwareOutputCounts.clear();
    this.activeSoftwareOutputRoutes.clear();
    this.autoPressedSoftwareRouteKeys.clear();
    this.timedLiveSimulatedOutputRouteKeys.clear();
    this.softwareInstrumentBank.forEach((synth) => {
      synth.releaseAll();
      synth.dispose();
    });
    this.softwareInstrumentBank.clear();
  }

  private getSoftwareInstrumentProfile(
    midiInstrumentId: number | null
  ): SoftwareInstrumentProfile {
    if (!Number.isFinite(midiInstrumentId)) {
      return 'piano';
    }

    const program = Number(midiInstrumentId);
    if (program <= 7) {
      return 'piano';
    }
    if (program <= 15) {
      return 'lead';
    }
    if (program <= 23) {
      return 'organ';
    }
    if (program <= 31) {
      return 'guitar';
    }
    if (program <= 39) {
      return 'bass';
    }
    if (program <= 51) {
      return 'strings';
    }
    if (program <= 55) {
      return 'choir';
    }
    if (program <= 63) {
      return 'brass';
    }
    if (program <= 79) {
      return 'lead';
    }
    if (program <= 95) {
      return 'pad';
    }

    return 'lead';
  }

  private getProfileOutputRouteKey(
    pitch: number,
    profile: SoftwareInstrumentProfile
  ): string {
    return `profile:${profile}:${pitch}`;
  }

  private getMidiPitchNoteName(pitch: number): string {
    return Frequency(pitch, 'midi').toNote();
  }

  private getNormalizedVelocity(velocity: number): number {
    if (!Number.isFinite(velocity)) {
      return 0.7;
    }

    return Math.min(Math.max(velocity / 127, 0.2), 1);
  }

  private sendSoftwareNoteOn(
    pitch: number,
    velocity: number,
    audioTime?: number,
    midiInstrumentId: number | null = null
  ): string | null {
    const profile = this.getSoftwareInstrumentProfile(midiInstrumentId);
    const routeKey = this.getProfileOutputRouteKey(pitch, profile);
    const nextCount = (this.activeSoftwareOutputCounts.get(routeKey) ?? 0) + 1;
    this.activeSoftwareOutputCounts.set(routeKey, nextCount);
    if (nextCount > 1) {
      return routeKey;
    }

    this.activeSoftwareOutputRoutes.set(routeKey, {
      profile,
      pitch,
    });
    if (profile === 'piano') {
      this.piano?.keyDown({
        midi: pitch,
        time: audioTime,
        velocity: this.getNormalizedVelocity(velocity),
      });
      return routeKey;
    }

    this.softwareInstrumentBank
      .get(profile)
      ?.triggerAttack(
        this.getMidiPitchNoteName(pitch),
        audioTime,
        this.getNormalizedVelocity(velocity)
      );
    return routeKey;
  }

  private sendSoftwareNoteOff(
    pitch: number,
    audioTime?: number,
    midiInstrumentId: number | null = null,
    routeKey?: string | null
  ): void {
    if (routeKey) {
      this.releaseSoftwareNoteRoute(routeKey, audioTime);
      return;
    }

    if (Number.isFinite(midiInstrumentId)) {
      this.releaseSoftwareNoteRoute(
        this.getProfileOutputRouteKey(
          pitch,
          this.getSoftwareInstrumentProfile(midiInstrumentId)
        ),
        audioTime
      );
      return;
    }

    const pitchKeySuffix = `:${pitch}`;
    Array.from(this.activeSoftwareOutputRoutes.keys())
      .filter((key) => key.endsWith(pitchKeySuffix))
      .forEach((activeRouteKey) =>
        this.releaseSoftwareNoteRoute(activeRouteKey, audioTime)
      );
  }

  private releaseSoftwareNoteRoute(routeKey: string, audioTime?: number): void {
    const currentCount = this.activeSoftwareOutputCounts.get(routeKey) ?? 0;
    if (currentCount <= 1) {
      this.activeSoftwareOutputCounts.delete(routeKey);
      const route = this.activeSoftwareOutputRoutes.get(routeKey);
      this.activeSoftwareOutputRoutes.delete(routeKey);
      if (!route) {
        return;
      }

      if (route.profile === 'piano') {
        this.piano?.keyUp({ midi: route.pitch, time: audioTime });
        return;
      }

      this.softwareInstrumentBank
        .get(route.profile)
        ?.triggerRelease(this.getMidiPitchNoteName(route.pitch), audioTime);
      return;
    }

    this.activeSoftwareOutputCounts.set(routeKey, currentCount - 1);
  }

  private getMidiInstrumentIdForNoteObject(
    noteObj: NoteObject | null | undefined
  ): number | null {
    const midiInstrumentId = noteObj?.midiInstrumentId;
    return Number.isFinite(midiInstrumentId) ? Number(midiInstrumentId) : null;
  }

  private getMidiInstrumentIdForStaffId(staffId: number | null): number | null {
    if (!Number.isFinite(staffId)) {
      return null;
    }

    const staff = this.openSheetMusicDisplay?.Sheet?.Staves?.find(
      (candidate: any) => candidate?.idInMusicSheet === staffId
    );
    const parentInstrument = staff?.ParentInstrument;
    const candidates = [
      parentInstrument?.MidiInstrumentId,
      parentInstrument?.SubInstruments?.[0]?.midiInstrumentID,
    ];
    const midiInstrumentId = candidates.find((value) => Number.isFinite(value));

    return Number.isFinite(midiInstrumentId) ? Number(midiInstrumentId) : null;
  }

  private getPreferredPracticeMidiInstrumentId(pitch?: number): number | null {
    if (Number.isFinite(pitch)) {
      const noteObj = this.notesService
        .getMapRequired()
        .get((Number(pitch) - 12).toFixed());
      const noteInstrumentId = this.getMidiInstrumentIdForNoteObject(noteObj);
      if (Number.isFinite(noteInstrumentId)) {
        return noteInstrumentId;
      }
    }

    for (const noteObj of this.notesService.getMapRequired().values()) {
      const midiInstrumentId = this.getMidiInstrumentIdForNoteObject(noteObj);
      if (Number.isFinite(midiInstrumentId)) {
        return midiInstrumentId;
      }
    }

    const practiceSelection = this.getPracticeStaffSelection();
    for (const staffId of this.staffIdList) {
      if (!practiceSelection[staffId]) {
        continue;
      }

      const midiInstrumentId = this.getMidiInstrumentIdForStaffId(staffId);
      if (Number.isFinite(midiInstrumentId)) {
        return midiInstrumentId;
      }
    }

    return this.getMidiInstrumentIdForStaffId(this.staffIdList[0] ?? null);
  }

  private monitorMidiInputNoteOn(pitch: number, velocity: number): void {
    const currentCount = this.monitoredMidiInputCounts.get(pitch) ?? 0;
    this.monitoredMidiInputCounts.set(pitch, currentCount + 1);
    if (currentCount > 0) {
      return;
    }

    const midiInstrumentId = this.getPreferredPracticeMidiInstrumentId(pitch);
    this.monitoredMidiInputInstruments.set(pitch, midiInstrumentId);
    const routeKey = this.sendSoftwareNoteOn(
      pitch,
      velocity,
      undefined,
      midiInstrumentId
    );
    this.monitoredMidiInputRouteKeys.set(pitch, routeKey);
  }

  private monitorMidiInputNoteOff(pitch: number): void {
    const currentCount = this.monitoredMidiInputCounts.get(pitch) ?? 0;
    if (currentCount <= 0) {
      return;
    }

    if (currentCount <= 1) {
      this.monitoredMidiInputCounts.delete(pitch);
      const midiInstrumentId =
        this.monitoredMidiInputInstruments.get(pitch) ?? null;
      const routeKey = this.monitoredMidiInputRouteKeys.get(pitch) ?? null;
      this.monitoredMidiInputInstruments.delete(pitch);
      this.monitoredMidiInputRouteKeys.delete(pitch);
      this.sendSoftwareNoteOff(pitch, undefined, midiInstrumentId, routeKey);
      return;
    }

    this.monitoredMidiInputCounts.set(pitch, currentCount - 1);
  }

  private releaseMonitoredMidiInputNotes(): void {
    Array.from(this.monitoredMidiInputInstruments.entries()).forEach(
      ([pitch, midiInstrumentId]) => {
        this.sendSoftwareNoteOff(
          pitch,
          undefined,
          midiInstrumentId,
          this.monitoredMidiInputRouteKeys.get(pitch) ?? null
        );
      }
    );
    this.monitoredMidiInputCounts.clear();
    this.monitoredMidiInputInstruments.clear();
    this.monitoredMidiInputRouteKeys.clear();
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
    this.refreshTimedLiveCursorTimeline();
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

  toggleStaffEnabled(id: number): void {
    this.staffIdEnabled[id] = !this.staffIdEnabled[id];
    this.refreshTimedLiveCursorTimelineDeferred();
    this.refreshCursorDebugMarkersDeferred();
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

  navigateBackToBrowser(): void {
    void this.navCtrl.navigateBack('/index/home');
  }

  handleMidiInputAudioChange(): void {
    if (this.checkboxMidiInputAudio) {
      void startTone().catch(() => undefined);
      return;
    }

    if (!this.checkboxMidiInputAudio) {
      this.releaseMonitoredMidiInputNotes();
    }
  }

  toggleCursorDebugOverlay(): void {
    this.showCursorDebugOverlay = !this.showCursorDebugOverlay;
    this.refreshCursorDebugMarkersDeferred();
  }

  toggleTimedLiveCursorDebugOverlay(): void {
    this.showTimedLiveCursorDebugOverlay = !this.showTimedLiveCursorDebugOverlay;
    this.handleTimedLiveCursorDebugOverlayChange();
  }

  handleTimedLiveCursorDebugOverlayChange(): void {
    if (this.showTimedLiveCursorDebugOverlay && !this.timedLiveCursorTimeline) {
      this.refreshTimedLiveCursorTimeline();
    }
    if (!this.showTimedLiveCursorDebugOverlay) {
      this.onTimedLiveCursorDebugPanelPointerUp();
      this.stopTimedLiveSimulatedFeedbackPlayback(
        this.running &&
          this.listenMode &&
          this.timedLiveSimulatedInputEnabled &&
          this.hasActiveTimedLiveSimulatedOutput()
      );
      this.resetTimedLiveSimulatedFeedbackStats();
      this.resetTimingFeedbackNoteheads();
    }
    this.updateLegacyPlayCursorDebugVisibility();
    this.syncTimedLiveCursorDebugLoop();
  }

  handleTimedLiveSimulatedInputChange(): void {
    this.syncTimedLiveSimulationControls();
    const shouldContinueSimulation = this.shouldUseTimedLiveSimulatedFeedback();
    const shouldHandoffToListenPlayback =
      !shouldContinueSimulation &&
      this.running &&
      this.listenMode &&
      this.hasActiveTimedLiveSimulatedOutput();

    if (shouldContinueSimulation) {
      if (this.hasTimedLiveSimulatedFeedbackActivity()) {
        this.stopTimedLiveSimulatedFeedbackPlayback();
      } else {
        this.clearTimedLiveSimulatedFeedbackTimeouts();
      }
    } else if (shouldHandoffToListenPlayback) {
      this.stopTimedLiveSimulatedFeedbackPlayback(true);
    } else if (this.hasTimedLiveSimulatedFeedbackActivity()) {
      this.stopTimedLiveSimulatedFeedbackPlayback();
    } else {
      this.clearTimedLiveSimulatedFeedbackTimeouts();
    }

    this.updateLegacyPlayCursorDebugVisibility();
    if (shouldContinueSimulation) {
      this.scheduleTimedLiveSimulatedFeedback(true);
    }
  }

  handleTimedLiveSimulationThresholdChange(): void {
    this.syncTimedLiveSimulationControls();
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

  private setTransportMode(mode: TransportMode | null): void {
    this.transportMode = mode;
    this.listenMode = mode === 'listen';
    this.realtimeMode = mode === 'realtime';
  }

  private isTimedTransportMode(): boolean {
    return (
      this.transportMode === 'listen' || this.transportMode === 'realtime'
    );
  }

  private clearLoopStartCheckpoint(): void {
    this.loopStartCheckpoint = null;
  }

  private getLoopStartCursorTargetX(): number | null {
    return this.loopStartCheckpoint?.cursorTargetX ?? null;
  }

  private getLoopStartMeasureLeftX(): number | null {
    return this.loopStartCheckpoint?.measureLeftX ?? null;
  }

  private seedPendingLoopRestartAudioTime(): void {
    const scheduledAudioTimeSec = this.playbackClock.scheduledAudioTimeSec;
    this.playbackClock.pendingLoopRestartAudioTimeSec =
      typeof scheduledAudioTimeSec === 'number' &&
      Number.isFinite(scheduledAudioTimeSec)
        ? scheduledAudioTimeSec
        : null;
  }

  private takePendingLoopRestartAudioTime(): number | null {
    const audioTime = this.playbackClock.pendingLoopRestartAudioTimeSec;
    this.playbackClock.pendingLoopRestartAudioTimeSec = null;
    return typeof audioTime === 'number' && Number.isFinite(audioTime)
      ? audioTime
      : null;
  }

  private clearPlaybackClock(): void {
    this.playbackClock.scheduledAudioTimeSec = null;
    this.playbackClock.pendingLoopRestartAudioTimeSec = null;
  }

  private buildPlaybackStartContext(): PlaybackStartContext {
    const audioSeedTimeSec = this.takePendingLoopRestartAudioTime();
    return {
      reason: this.loopPass > 0 ? 'loop-restart' : 'fresh',
      audioSeedTimeSec,
    };
  }

  private isLoopRestartStart(context: PlaybackStartContext): boolean {
    return context.reason === 'loop-restart';
  }

  osmdStop(): void {
    this.running = false;
    this.setTransportMode(null);
    this.timePlayStart = 0;
    this.playbackStartScoreTimestamp = 0;
    this.playbackStartAudioTimeSec = null;
    this.loopPass = 0;
    this.currentStepSatisfied = false;
    this.resetPlayCursorTransition();
    this.osmdCursorStop();
    this.timeouts.map((to) => clearTimeout(to));
    this.timeouts = [];
    this.releaseComputerPressedNotes();
    this.clearLoopStartCheckpoint();
    this.clearPlaybackClock();
    this.playCursorLoopWrapAnimation = null;
    this.pendingLoopRestartCursorTeleport = false;
    this.lastPlayCursorTransitionDurationMs = 0;
    this.pendingDeferredTieStepAdvance = false;
    this.pendingTimedStartBootstrapAdvance = false;
    this.correctlyHeldPracticeKeys.clear();
    this.timedLiveRealtimeMatchedEventNotes.clear();
    this.stopTimedLiveCursorDebugLoop(true);
    this.stopTimedLiveSimulatedFeedbackPlayback();
    this.resetTimedLiveSimulatedFeedbackStats();
    this.updateLegacyPlayCursorDebugVisibility();
    this.refreshCursorDebugMarkersDeferred();
  }

  // Play
  osmdListen(): void {
    this.running = true;
    this.skipPlayNotes = 0;
    this.osmdResetFeedback();
    this.clearCursorTraceEvents();
    this.markCursorTraceLoopBoundary('listen start');
    this.setTransportMode('listen');
    this.resetTimedLiveCursorDebugSession();
    this.resetTimedLiveSimulatedFeedbackStats();
    this.syncTimedLiveCursorDebugLoop();
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
    this.setTransportMode('wait');
    this.stopTimedLiveCursorDebugLoop(true);
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
    this.setTransportMode('realtime');
    this.stopTimedLiveCursorDebugLoop(true);
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
    const transitionDuration = shouldAnimate
      ? this.getCursorStepDelayMs(index)
      : 0;

    if (index === 0 && shouldAnimate && previousTimestamp !== null) {
      this.lastPlayCursorTransitionDurationMs = transitionDuration;
      const container = document.getElementById('scoreOverlayHost');
      const visualDebug = container
        ? this.getCurrentPlayCursorVisualDebug(container)
        : null;
      this.tracePlayCursor('move start', `dur ${Math.round(transitionDuration)}`);
      this.appendCursorWrapDebugEvent(
        `step m${previousMeasureNumber ?? '?'} ${
          this.formatScoreTimestamp(previousTimestamp)
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
      const sameMeasureStep =
        previousMeasureNumber !== null &&
        nextMeasureNumber !== null &&
        previousMeasureNumber === nextMeasureNumber;
      if (
        !previousPosition ||
        !nextPosition ||
        (!sameMeasureStep &&
          Math.abs(nextPosition.top - previousPosition.top) > 4)
      ) {
        const shouldTreatAsSystemWrap =
          previousMeasureNumber !== null &&
          nextMeasureNumber !== null &&
          this.isPlayCursorSystemWrap(previousMeasureNumber, nextMeasureNumber);
        const container = document.getElementById('scoreOverlayHost');
        const nextActionableTargets =
          shouldTreatAsSystemWrap && container
            ? this.getCursorActionableTargetCenters(
                this.openSheetMusicDisplay.cursors[index],
                container
              )
            : [];
        const nextTargets =
          shouldTreatAsSystemWrap && container
            ? this.getCursorTargetCenters(
                this.openSheetMusicDisplay.cursors[index],
                container
              )
            : [];
        const startedSystemWrapAnimation =
          shouldTreatAsSystemWrap &&
          index === 0 &&
          !!previousPosition &&
          !!nextPosition &&
          Number.isFinite(previousTargetX) &&
          previousTimestamp !== null &&
          nextTimestamp !== null &&
          nextMeasureNumber !== null &&
          Number.isFinite(nextActionableTargets[0] ?? nextTargets[0]) &&
          this.startPlayCursorSystemWrapAnimation({
            previousPosition,
            nextPosition,
            previousTargetX: Number(previousTargetX),
            previousMeasureNumber,
            previousTimestamp,
            nextMeasureNumber,
            nextTimestamp,
            nextTargetX: Number(nextActionableTargets[0] ?? nextTargets[0]),
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
            } ${this.formatScoreTimestamp(previousTimestamp)}->${
              this.formatScoreTimestamp(nextTimestamp)
            }`
          );
        } else {
          this.tracePlayCursor('move wrap', 'system teleport');
          this.appendCursorWrapDebugEvent(
            `wrap system start m${previousMeasureNumber}->${nextMeasureNumber} ${
              this.formatScoreTimestamp(previousTimestamp)
            }->${
              this.formatScoreTimestamp(nextTimestamp)
            }`
          );
          this.appendPlayCursorWrapGeometryDebugEvent(
            'wrap start geom',
            `prevBase ${Math.round(previousPosition.left)},${Math.round(
              previousPosition.top
            )} nextBase ${Math.round(nextPosition.left)},${Math.round(
              nextPosition.top
            )}`
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
    const audioTime = this.getCurrentScheduledPlaybackAudioTime();

    if (this.realtimeMode) {
      this.advanceRealtimePractice(audioTime);
    }

    let nextTimestamp = currentTimestamp;
    let timeout = 0;

    // if ended reached check repeat and start or stop
    if (this.osmdEndReached(1)) {
      // Caculate time to end of compass
      const iter = this.openSheetMusicDisplay.cursors[1].iterator;
      nextTimestamp =
        iter.CurrentMeasure.AbsoluteTimestamp.RealValue +
        iter.CurrentMeasure.Duration.RealValue;
      timeout = this.getPlaybackDelayMs(
        nextTimestamp - iter.CurrentSourceTimestamp.RealValue
      );
      this.timeouts.push(
        setTimeout(() => {
          this.openSheetMusicDisplay.cursors[1].hide();
        }, timeout)
      );
      if (this.realtimeMode) {
        if (this.checkboxRepeat) {
          const startedLoopWrapAnimation = this.startPlayCursorLoopWrapAnimation(
            timeout,
            () => this.restartLoopPlayback()
          );
          if (!startedLoopWrapAnimation) {
            this.timeouts.push(
              setTimeout(() => {
                this.restartLoopPlayback();
              }, timeout)
            );
          }
        } else {
          this.timeouts.push(
            setTimeout(() => {
              this.osmdCursorStop();
            }, timeout)
          );
        }
      }
    } else {
      // Move to Next
      const iter = this.openSheetMusicDisplay.cursors[1].iterator;
      const it2 = this.openSheetMusicDisplay.cursors[1].iterator.clone();
      it2.moveToNext();
      nextTimestamp = it2.CurrentSourceTimestamp.RealValue;
      timeout = this.getPlaybackDelayMs(
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
    this.advanceScheduledPlaybackAudioTime(timeout);

    // Play note in listen mode, so the play cursor can advance forward
    if (this.listenMode) {
      this.advanceTimedStartBootstrapCursorIfNeeded();
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

  private restartLoopPlayback(): void {
    this.seedPendingLoopRestartAudioTime();
    this.stopTimedLiveSimulatedFeedbackPlayback();
    this.osmdResetFeedback();
    this.loopPass++;
    this.markCursorTraceLoopBoundary('loop wrap');
    this.osmdCursorStart();
  }

  private handlePlayCursorLoopEnd(): void {
    const iter = this.openSheetMusicDisplay.cursors[0].iterator;
    const timeout = this.getPlaybackDelayMs(
      iter.CurrentMeasure.AbsoluteTimestamp.RealValue +
        iter.CurrentMeasure.Duration.RealValue -
        iter.CurrentSourceTimestamp.RealValue
    );

    if (this.checkboxRepeat) {
      const startedLoopWrapAnimation = this.startPlayCursorLoopWrapAnimation(
        timeout,
        () => this.restartLoopPlayback()
      );
      if (!startedLoopWrapAnimation) {
        this.timeouts.push(
          setTimeout(() => {
            this.restartLoopPlayback();
          }, timeout)
        );
      }
      return;
    }

    this.openSheetMusicDisplay.cursors[0].hide();
    this.timeouts.push(
      setTimeout(() => {
        this.osmdCursorStop();
      }, timeout)
    );
  }

  private moveToNextPlayCursorStep(allowLoopRestart: boolean): boolean {
    if (this.osmdEndReached(0)) {
      if (allowLoopRestart) {
        this.handlePlayCursorLoopEnd();
      }
      return false;
    }

    return this.osmdCursorMoveNext(0);
  }

  // Single writer for cursor-derived note state. Any cursor0 repositioning
  // should rebuild required notes, practice targets, tempo, and realtime state here.
  private rebuildCurrentPlaybackStepState(back = false): void {
    this.notesService.calculateRequired(
      this.openSheetMusicDisplay.cursors[0],
      this.getPracticeStaffSelection(),
      back
    );

    if (this.realtimeMode) {
      this.clearRealtimeCurrentStepMatches();
    }

    this.activePracticeGraphicalNotes = this.getCurrentPracticeGraphicalNotes();
    this.activePracticeNoteElements = this.getCurrentPracticeNoteElements();
    this.scheduleHeldTieContinuationNotesRenderIfMatched();

    if (this.realtimeMode) {
      this.computerNotesService.calculateRequired(
        this.openSheetMusicDisplay.cursors[0],
        this.getComputerStaffSelection(),
        back
      );
      this.tempoInBPM = this.resolveRealtimeTempo();
      const hasCurrentRequiredPressKeys = this.hasCurrentRequiredPressKeys();
      this.currentStepSatisfied =
        !hasCurrentRequiredPressKeys || this.notesService.isRequiredNotesPressed();
      this.refreshRealtimeNextStepKeys();
    } else {
      this.tempoInBPM = this.notesService.tempoInBPM;
    }

    if (this.pianoKeyboard) {
      this.pianoKeyboard.updateNotesStatus();
    }
  }

  private resetPlaybackNoteStateForStart(): void {
    this.releaseComputerPressedNotes();
    this.computerNotesService.clear();
    this.notesService.clear();
    this.correctlyHeldPracticeKeys.clear();

    Array.from(this.mapNotesAutoPressed.keys()).forEach((key) => {
      this.keyReleaseNoteInternal(
        parseInt(key) + 12,
        undefined,
        false,
        this.autoPressedMidiInstrumentIds.get(key) ?? null
      );
    });
    this.mapNotesAutoPressed.clear();
    this.autoPressedMidiInstrumentIds.clear();
    this.autoPressedSoftwareRouteKeys.clear();
  }

  private syncTempoCursorToPlayCursor(): void {
    const cursor0 = this.openSheetMusicDisplay?.cursors?.[0];
    const cursor1 = this.openSheetMusicDisplay?.cursors?.[1];
    const cursor0Iterator = cursor0?.iterator?.clone?.();

    if (!cursor0 || !cursor1 || !cursor0Iterator) {
      return;
    }

    cursor1.iterator = cursor0Iterator;
    cursor1.update();
    if (this.isTimedTransportMode()) {
      cursor1.hide();
    }
  }

  private positionCursorsForPlaybackStart(
    startContext: PlaybackStartContext
  ): boolean {
    const shouldRestoreLoopStart = this.canRestoreLoopStartCursorState(startContext);
    this.openSheetMusicDisplay.cursors.forEach((cursor, index) => {
      cursor.show();
      if (!shouldRestoreLoopStart) {
        cursor.reset();
        cursor.update();
      }
      if (this.isTimedTransportMode() && index == 1) {
        cursor.hide();
      }
    });

    this.resetPlaybackNoteStateForStart();
    this.osmdHideFeedback();

    const restoredLoopStart = this.restoreLoopStartCursorState(startContext);
    if (this.isLoopRestartStart(startContext)) {
      this.appendCursorWrapDebugEvent(
        restoredLoopStart
          ? `loop restore hit m${this.inputMeasure.lower}-${this.inputMeasure.upper}`
          : `loop restore miss m${this.inputMeasure.lower}-${this.inputMeasure.upper}`
      );
    }

    if (
      !restoredLoopStart &&
      this.inputMeasure.lower >
        this.openSheetMusicDisplay.cursors[0].iterator.CurrentMeasureIndex + 1
    ) {
      if (!this.osmdCursorMoveNext(0)) {
        return false;
      }
      this.osmdCursorMoveNext(1);
    }

    this.openSheetMusicDisplay.cursors.forEach((cursor) => cursor.update());
    this.snapPlayCursorForJump();
    if (this.pendingLoopRestartCursorTeleport) {
      this.positionPlayCursorAtLoopStartBoundary();
    }
    this.suppressPlayCursorAlignmentForStep =
      this.isLoopRestartStart(startContext);
    this.tracePlayCursor(
      'start positioned',
      this.isLoopRestartStart(startContext) ? 'loop restart' : 'fresh'
    );

    return true;
  }

  private normalizePlaybackStartStep(
    startContext: PlaybackStartContext
  ): boolean {
    if (this.isTimedTransportMode()) {
      this.syncTempoCursorToPlayCursor();
      return true;
    }

    while (this.shouldAutoAdvanceWaitModeStartStep()) {
      this.appendCursorWrapDebugEvent(
        `${
          this.isLoopRestartStart(startContext) ? 'restart' : 'start'
        } wait bootstrap req[${
          this.formatRequiredNoteSummary()
        }]`
      );
      if (!this.moveToNextPlayCursorStep(false)) {
        return false;
      }
      this.rebuildCurrentPlaybackStepState();
    }

    this.syncTempoCursorToPlayCursor();
    return true;
  }

  private shouldAutoAdvanceWaitModeStartStep(): boolean {
    if (this.isTimedTransportMode()) {
      return false;
    }

    return !this.hasCurrentRequiredPressKeys();
  }

  private refreshTimedStartBootstrapState(): void {
    this.pendingTimedStartBootstrapAdvance =
      this.listenMode && !this.hasCurrentRequiredPressKeys();
  }

  private advanceTimedStartBootstrapCursorIfNeeded(): void {
    if (!this.pendingTimedStartBootstrapAdvance || !this.listenMode) {
      return;
    }

    if (this.hasCurrentRequiredPressKeys()) {
      this.pendingTimedStartBootstrapAdvance = false;
      return;
    }

    if (this.osmdEndReached(0)) {
      this.pendingTimedStartBootstrapAdvance = false;
      return;
    }

    this.appendCursorWrapDebugEvent(
      `timed bootstrap ${this.formatScoreTimestamp(
        this.getCurrentPracticeTimestamp()
      )}`
    );

    if (!this.osmdCursorMoveNext(0)) {
      this.pendingTimedStartBootstrapAdvance = false;
      return;
    }

    this.rebuildCurrentPlaybackStepState();
    this.alignOrAnimatePlayCursorAfterAdvance();
    this.pendingTimedStartBootstrapAdvance = !this.hasCurrentRequiredPressKeys();
  }

  // Move cursor to next note
  osmdCursorPlayMoveNext(skipFeedback = false): void {
    // Required to stop next calls if stop is pressed during play
    if (!this.running) return;

    if (!skipFeedback && this.notesService.getMapRequired().size > 0) {
      this.markCurrentNotesCorrect();
    }

    if (!this.moveToNextPlayCursorStep(true)) {
      return;
    }

    this.rebuildCurrentPlaybackStepState();
    this.alignOrAnimatePlayCursorAfterAdvance();
    this.pendingTimedStartBootstrapAdvance = false;

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
    this.setTransportMode(null);
    this.running = false;
    this.loopPass = 0;
    this.currentStepSatisfied = false;

    this.withCursorFollowSuppressed(() => {
      this.openSheetMusicDisplay.cursors.forEach((cursor) => {
        cursor.reset();
        cursor.hide();
      });
    });
    for (const [key] of this.mapNotesAutoPressed) {
      this.keyReleaseNote(
        parseInt(key) + 12,
        undefined,
        this.autoPressedMidiInstrumentIds.get(key) ?? null
      );
    }
    this.mapNotesAutoPressed.clear();
    this.autoPressedMidiInstrumentIds.clear();
    this.autoPressedSoftwareRouteKeys.clear();
    this.computerPressedNotes.clear();
    this.notesService.clear();
    this.computerNotesService.clear();
    this.activePracticeNoteElements = [];
    this.activePracticeGraphicalNotes = [];
    this.clearLoopStartCheckpoint();
    this.clearPlaybackClock();
    this.cancelScheduledPlayCursorAlignment();
    const cursorElement = this.getPlayCursorElement();
    if (cursorElement) {
      cursorElement.style.transform = '';
    }
    this.pendingLoopRestartCursorTeleport = false;
    this.lastPlayCursorTransitionDurationMs = 0;
    this.pendingDeferredTieStepAdvance = false;
    this.pendingTimedStartBootstrapAdvance = false;
    if (this.heldTieContinuationRenderTimeout !== null) {
      window.clearTimeout(this.heldTieContinuationRenderTimeout);
      this.heldTieContinuationRenderTimeout = null;
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
    const startContext = this.buildPlaybackStartContext();

    // this.content.scrollToTop();
    this.resetPlayCursorTransition();
    this.tracePlayCursor('start reset');
    this.clearRealtimeToleranceWindow();
    this.timedLiveRealtimeMatchedEventNotes.clear();
    this.lastPlayCursorTransitionDurationMs = 0;
    this.pendingDeferredTieStepAdvance = false;
    this.pendingTimedStartBootstrapAdvance = false;
    this.suppressPlayCursorAnimation = true;
    const prepared = this.withCursorFollowSuppressed(() => {
      if (!this.positionCursorsForPlaybackStart(startContext)) {
        return false;
      }

      this.rebuildCurrentPlaybackStepState(true);
      if (!this.normalizePlaybackStartStep(startContext)) {
        return false;
      }

      this.captureLoopStartCheckpoint();
      if (this.pendingLoopRestartCursorTeleport) {
        this.tracePlayCursor('start aligned', 'loop boundary');
      } else {
        this.updatePlayCursorVisualAlignment();
        this.tracePlayCursor('start aligned');
      }
      this.appendLoopRestartStateDebugEvent(
        this.isLoopRestartStart(startContext)
          ? 'restart prepared'
          : 'start prepared'
      );
      this.refreshTimedStartBootstrapState();
      return true;
    });

    this.suppressPlayCursorAnimation = false;
    if (!prepared) {
      this.osmdCursorStop();
      return;
    }

    if (this.startFlashCount > 0) {
      this.showTimedLiveCursorAtStartTimestamp();
      this.updateLegacyPlayCursorDebugVisibility();
    }

    this.refreshCursorWrapDebugSnapshot();
    this.osmdCursorStart2(startContext);
  }

  osmdCursorStart2(startContext: PlaybackStartContext): void {
    if (this.startFlashCount > 0) {
      // Count-in contract for transport starts:
      // - the cursor is already aligned to the first playable timestamp by
      //   `osmdCursorStart()`;
      // - during the countdown it must remain visible and stationary at that
      //   first timestamp so the user can see exactly where playback will
      //   begin;
      // - only after the count-in completes do we arm audio scheduling and let
      //   the cursor advance.
      //
      // Do not blink or hide the cursor here. Using the cursor itself as a
      // countdown indicator makes the start position ambiguous and has caused
      // regressions where the cursor appears to jump or disappear before the
      // first beat.
      this.playCountInClick();
      this.openSheetMusicDisplay.cursors[0].show();
      this.showTimedLiveCursorAtStartTimestamp();
      this.startFlashCount--;
      const countInDelay = this.getCountInDelayMs();
      this.timeouts.push(
        setTimeout(() => {
          this.osmdCursorStart2(startContext);
        }, countInDelay)
      );
      return;
    }

    this.startFlashCount = 0;
    this.openSheetMusicDisplay.cursors[0].show();
    this.appendLoopRestartStateDebugEvent(
      this.isLoopRestartStart(startContext) ? 'restart start2 enter' : 'start2 enter'
    );

    this.timePlayStart = Date.now();
    this.playbackStartScoreTimestamp =
      this.openSheetMusicDisplay.cursors[0].iterator.CurrentSourceTimestamp
        .RealValue;
    let audioTime: number;
    if (startContext.audioSeedTimeSec !== null) {
      const seededAudioTime = startContext.audioSeedTimeSec;
      this.playbackClock.scheduledAudioTimeSec = seededAudioTime;
      audioTime = this.getCurrentScheduledPlaybackAudioTime();
      this.appendCursorWrapDebugEvent(
        audioTime !== seededAudioTime
          ? `restart audio seed ${seededAudioTime.toFixed(3)}->${audioTime.toFixed(3)}`
          : `restart audio seed ${audioTime.toFixed(3)}`
      );
    } else {
      audioTime = this.getCurrentScheduledPlaybackAudioTime();
    }
    this.playbackStartAudioTimeSec = audioTime;
    this.syncTimedLiveCursorDebugLoop();

    this.startMetronome();

    // Play initial notes
    if (this.listenMode) {
      this.playNote(audioTime);
      this.scheduleTimedLiveSimulatedFeedback();
    } else if (this.realtimeMode) {
      this.playComputerNotes(audioTime);
    }

    const it2 = this.openSheetMusicDisplay.cursors[0].iterator.clone();
    it2.moveToNext();
    const nextTimestamp = it2.CurrentSourceTimestamp.RealValue;
    this.appendCursorWrapDebugEvent(
      `${
        this.isLoopRestartStart(startContext) ? 'restart' : 'start'
      } schedule cur ${this.formatScoreTimestamp(
        this.playbackStartScoreTimestamp
      )} next ${this.formatScoreTimestamp(nextTimestamp)} timeout ${Math.round(
        this.getPlaybackDelayMs(
          nextTimestamp -
            this.openSheetMusicDisplay.cursors[0].iterator.CurrentSourceTimestamp
              .RealValue
        )
      )} skip ${this.skipPlayNotes}`
    );

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
    this.advanceScheduledPlaybackAudioTime(timeout);
    this.timeouts.push(
      setTimeout(() => {
        this.osmdCursorTempoMoveNext();
      }, timeout)
    );
  }

  playNote(audioTime?: number): void {
    if (this.shouldUseTimedLiveSimulatedFeedback()) {
      if (this.skipPlayNotes > 0) {
        this.skipPlayNotes--;
      }
      return;
    }

    if (this.skipPlayNotes > 0) {
      this.appendCursorWrapDebugEvent(
        `play skip consume ${this.skipPlayNotes} at ${this.formatScoreTimestamp(
          this.getCurrentPracticeTimestamp()
        )}`
      );
      this.skipPlayNotes--;
    } else {
      this.appendCursorWrapDebugEvent(
        `play trigger ${this.formatScoreTimestamp(
          this.getCurrentPracticeTimestamp()
        )} req[${this.formatRequiredNoteSummary()}]`
      );
      this.notesService.playRequiredNotes(
        (note, velocity, noteObj) =>
          this.keyPressNote(
            note,
            velocity,
            audioTime,
            this.getMidiInstrumentIdForNoteObject(noteObj)
          ),
        (note, noteObj, retrigger) => {
          const midiInstrumentId = this.getMidiInstrumentIdForNoteObject(noteObj);
          if (retrigger) {
            this.keyReleaseNoteInternal(
              note,
              this.getRetriggerReleaseAudioTime(audioTime),
              false,
              midiInstrumentId
            );
            return;
          }

          this.keyReleaseNote(note, audioTime, midiInstrumentId);
        }
      );
    }
  }

  // Remove all feedback elements
  osmdResetFeedback(): void {
    this.resetCorrectNoteheads();
    this.resetIncorrectNoteheads();
    this.resetTimingFeedbackNoteheads();
    this.correctlyHeldPracticeKeys.clear();
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
    this.rememberCorrectlyHeldPracticeNotes(graphicalNotes);
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
    this.rememberCorrectlyHeldPracticeNotes(matchingNotes);
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
    this.rememberCorrectlyHeldPracticeNotes(matchingNotes);
  }

  private rememberCorrectlyHeldPracticeNotes(
    graphicalNotes: PracticeGraphicalNote[]
  ): void {
    graphicalNotes.forEach((note) => {
      if (!this.isActionableGraphicalPracticeNote(note.graphicalNote)) {
        return;
      }

      const key = note.halfTone.toString();
      if (this.notesService.getMapPressed().has(key)) {
        this.correctlyHeldPracticeKeys.add(key);
      }
    });
  }

  private renderHeldTieContinuationNotesIfMatched(): void {
    if (!this.checkboxFeedback || this.activePracticeGraphicalNotes.length === 0) {
      return;
    }

    const heldTieNotes = this.activePracticeGraphicalNotes.filter((note) => {
      if (!this.isTieContinuationGraphicalPracticeNote(note)) {
        return false;
      }

      const key = note.halfTone.toString();
      return (
        this.correctlyHeldPracticeKeys.has(key) &&
        this.notesService.getMapPressed().has(key)
      );
    });

    if (heldTieNotes.length === 0) {
      return;
    }

    this.renderCorrectPracticeNotes(
      heldTieNotes,
      this.getCurrentPracticeTimestamp()
    );
  }

  private scheduleHeldTieContinuationNotesRenderIfMatched(): void {
    if (this.heldTieContinuationRenderTimeout !== null) {
      window.clearTimeout(this.heldTieContinuationRenderTimeout);
      this.heldTieContinuationRenderTimeout = null;
    }

    const hasTieContinuationNotes = this.activePracticeGraphicalNotes.some((note) =>
      this.isTieContinuationGraphicalPracticeNote(note)
    );
    const delayMs =
      hasTieContinuationNotes &&
      this.running &&
      this.shouldAnimatePlayCursor() &&
      this.lastPlayCursorTransitionDurationMs > 0
        ? this.lastPlayCursorTransitionDurationMs
        : 0;

    if (delayMs <= 0) {
      this.renderHeldTieContinuationNotesIfMatched();
      return;
    }

    const expectedTimestamp = this.getCurrentPracticeTimestamp();
    this.heldTieContinuationRenderTimeout = window.setTimeout(() => {
      this.heldTieContinuationRenderTimeout = null;
      if (this.getCurrentPracticeTimestamp() !== expectedTimestamp) {
        return;
      }

      this.renderHeldTieContinuationNotesIfMatched();
    }, delayMs);
  }

  private isTieContinuationGraphicalPracticeNote(
    note: PracticeGraphicalNote
  ): boolean {
    const sourceNote = note.graphicalNote?.sourceNote;
    return (
      !!sourceNote &&
      typeof sourceNote.NoteTie !== 'undefined' &&
      sourceNote !== sourceNote.NoteTie?.StartNote
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
    placement: FeedbackNoteheadPlacement
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

    let bulb = element.querySelector<HTMLElement>('.feedback-notehead__bulb');
    if (!bulb) {
      bulb = document.createElement('div');
      bulb.className = 'feedback-notehead__bulb';
      element.appendChild(bulb);
    }

    let accidental = element.querySelector<HTMLElement>(
      '.feedback-notehead__accidental'
    );
    const colors = this.getFeedbackToneForClassName(className);
    element.style.position = 'absolute';
    element.style.pointerEvents = 'none';
    element.style.borderRadius = '0';
    element.style.transform = 'none';
    element.style.zIndex = '3';
    element.style.background = 'transparent';
    element.style.border = 'none';
    element.style.boxShadow = 'none';

    bulb.style.position = 'absolute';
    bulb.style.inset = '0';
    bulb.style.pointerEvents = 'none';
    bulb.style.borderRadius = '50% 48% 52% 50%';
    bulb.style.transform = 'rotate(-24deg)';
    bulb.style.transformOrigin = 'center';
    bulb.style.background = colors.fill;
    bulb.style.border = `1px solid ${colors.border}`;
    bulb.style.boxShadow = colors.halo;

    element.style.left = `${placement.left}px`;
    element.style.top = `${placement.top}px`;
    element.style.width = `${placement.width}px`;
    element.style.height = `${placement.height}px`;

    if (placement.accidental) {
      if (!accidental) {
        accidental = document.createElement('span');
        accidental.className = 'feedback-notehead__accidental';
        element.appendChild(accidental);
      }

      accidental.textContent = placement.accidental.symbol;
      accidental.style.position = 'absolute';
      accidental.style.left = `${-Math.max(placement.width * 0.4, 4)}px`;
      accidental.style.top = '50%';
      accidental.style.transform = 'translate(-100%, -52%)';
      accidental.style.color = '#111827';
      accidental.style.fontFamily = '"Times New Roman", Georgia, serif';
      accidental.style.fontSize = `${placement.accidental.fontSize}px`;
      accidental.style.fontWeight = '700';
      accidental.style.lineHeight = '1';
      accidental.style.pointerEvents = 'none';
      accidental.style.textShadow = '0 0 1px rgb(255 255 255 / 0.7)';
    } else if (accidental) {
      accidental.remove();
    }
  }

  private getFeedbackToneForClassName(className: string): {
    fill: string;
    border: string;
    halo: string;
  } {
    if (className.includes('feedback-notehead--correct')) {
      return {
        fill: PlayPageComponent.FEEDBACK_CORRECT_FILL,
        border: PlayPageComponent.FEEDBACK_CORRECT_BORDER,
        halo: PlayPageComponent.FEEDBACK_CORRECT_HALO,
      };
    }
    if (className.includes('feedback-notehead--early')) {
      return {
        fill: PlayPageComponent.FEEDBACK_EARLY_FILL,
        border: PlayPageComponent.FEEDBACK_EARLY_BORDER,
        halo: PlayPageComponent.FEEDBACK_EARLY_HALO,
      };
    }
    if (className.includes('feedback-notehead--late')) {
      return {
        fill: PlayPageComponent.FEEDBACK_LATE_FILL,
        border: PlayPageComponent.FEEDBACK_LATE_BORDER,
        halo: PlayPageComponent.FEEDBACK_LATE_HALO,
      };
    }

    return {
      fill: PlayPageComponent.FEEDBACK_MISS_FILL,
      border: PlayPageComponent.FEEDBACK_MISS_BORDER,
      halo: PlayPageComponent.FEEDBACK_MISS_HALO,
    };
  }

  private getRenderedNoteheadPlacement(
    note: PracticeGraphicalNote,
    allowCursorFallback: boolean = true
  ): {
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
        return allowCursorFallback
          ? this.getCursorFallbackNoteheadPlacement()
          : null;
      }

      const width = Math.max(horizontalRect.width * 0.95, 10);
      const height = Math.max(verticalRect.height * 0.82, 8);
      const left =
        horizontalRect.left + (horizontalRect.width - width) / 2;
      const top = verticalRect.top + (verticalRect.height - height) / 2;

      return { left, top, width, height };
    }

    return allowCursorFallback ? this.getCursorFallbackNoteheadPlacement() : null;
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

    // OSMD owns the cursor element's base `left`/`top`. Timed playback only
    // adds a transform so the rendered green cursor lines up with the current
    // playable notehead. That rendered position is the visual ground truth for
    // live playback and for feedback note placement.
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

  private captureLoopStartCheckpoint(): void {
    const cursor0 = this.openSheetMusicDisplay?.cursors?.[0];
    const currentMeasureNumber =
      cursor0?.iterator?.CurrentMeasureIndex + 1;

    if (
      !cursor0 ||
      !Number.isFinite(currentMeasureNumber) ||
      currentMeasureNumber < this.inputMeasure.lower ||
      currentMeasureNumber > this.inputMeasure.upper
    ) {
      return;
    }

    const container = document.getElementById('scoreOverlayHost');
    const targetCenters = container
      ? this.getActivePracticeTargetCenters(container)
      : [];

    const measureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === this.inputMeasure.lower
    );

    const enrolledTimestamp = cursor0.iterator?.CurrentEnrolledTimestamp?.clone?.();
    if (!enrolledTimestamp) {
      return;
    }

    this.loopStartCheckpoint = {
      range: {
        lower: this.inputMeasure.lower,
        upper: this.inputMeasure.upper,
      },
      enrolledTimestamp,
      cursorTargetX: targetCenters[0] ?? null,
      measureLeftX: measureOverlay?.left ?? null,
    };
  }

  private restoreLoopStartCursorState(
    startContext: PlaybackStartContext
  ): boolean {
    if (!this.canRestoreLoopStartCursorState(startContext)) {
      return false;
    }
    const checkpoint = this.loopStartCheckpoint;

    const cursor0 = this.openSheetMusicDisplay?.cursors?.[0];
    const cursor1 = this.openSheetMusicDisplay?.cursors?.[1];
    const manager = (cursor0 as any)?.manager;
    if (!checkpoint || !cursor0 || !cursor1 || !manager?.getIterator) {
      return false;
    }

    const enrolledTimestamp = checkpoint.enrolledTimestamp?.clone?.();
    if (!enrolledTimestamp) {
      return false;
    }

    cursor0.iterator = manager.getIterator(enrolledTimestamp);
    cursor1.iterator = manager.getIterator(enrolledTimestamp.clone());
    cursor0.update();
    cursor1.update();
    this.appendCursorWrapDebugEvent(
      `loop restore m${this.inputMeasure.lower}-${this.inputMeasure.upper}`
    );
    return true;
  }

  private canRestoreLoopStartCursorState(
    startContext: PlaybackStartContext
  ): boolean {
    return (
      this.isLoopRestartStart(startContext) &&
      !!this.loopStartCheckpoint &&
      this.loopStartCheckpoint.range.lower === this.inputMeasure.lower &&
      this.loopStartCheckpoint.range.upper === this.inputMeasure.upper
    );
  }

  private cancelScheduledPlayCursorAlignment(): void {
    if (this.playCursorAlignmentFrame === null) {
      if (this.playCursorLoopBoundaryTimeout !== null) {
        clearTimeout(this.playCursorLoopBoundaryTimeout);
        this.playCursorLoopBoundaryTimeout = null;
      }
      return;
    }

    window.cancelAnimationFrame(this.playCursorAlignmentFrame);
    this.playCursorAlignmentFrame = null;
    if (this.playCursorLoopBoundaryTimeout !== null) {
      clearTimeout(this.playCursorLoopBoundaryTimeout);
      this.playCursorLoopBoundaryTimeout = null;
    }
    this.playCursorLoopWrapAnimation = null;
  }

  private alignOrAnimatePlayCursorAfterAdvance(): void {
    this.updatePlayCursorVisualAlignment();
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
    // Loop wraps are intentionally split into two forward-only motions with an
    // instantaneous teleport in the middle:
    // 1. finish the current loop pass by travelling from the final playable
    //    note to the loop-closing barline;
    // 2. teleport to the loop-opening barline, then travel to the first
    //    playable note in the restarted loop.
    // This prevents the green cursor from animating backwards or through bars
    // that are outside the active loop selection.
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
      this.getLoopStartMeasureLeftX() ?? loopStartOverlay?.left ?? null;
    const firstNoteX =
      this.getLoopStartCursorTargetX() ?? startBarlineX ?? null;

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
      boundaryTriggered: false,
      restarted: false,
      restartBaseLeft: null,
      restartDurationMs: 0,
      startBarlineX: resolvedStartBarlineX,
      firstNoteX: resolvedFirstNoteX,
    };

    const triggerLoopBoundary = () => {
      const animation = this.playCursorLoopWrapAnimation;
      if (!this.running || !animation || animation.boundaryTriggered) {
        return;
      }

      animation.boundaryTriggered = true;
      this.playCursorLoopBoundaryTimeout = null;
      const nowMs = performance.now();
      this.appendCursorWrapDebugEvent(
        `loop boundary late ${Math.round(nowMs - animation.boundaryTimeMs)}ms`
      );
      this.pendingLoopRestartCursorTeleport = true;
      onBoundaryReached();
      this.pendingLoopRestartCursorTeleport = false;

      const restartCursorPosition = this.getPlayCursorPosition();
      animation.restartBaseLeft = restartCursorPosition?.left ?? null;
      animation.restartDurationMs = this.getLoopRestartTravelDurationMs();
      animation.startBarlineX =
        this.getLoopStartMeasureLeftX() ?? animation.startBarlineX;
      animation.firstNoteX =
        this.getLoopStartCursorTargetX() ?? animation.firstNoteX;
      animation.restarted = true;
    };

    this.playCursorLoopBoundaryTimeout = setTimeout(
      triggerLoopBoundary,
      boundaryDurationMs
    );

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
      this.getLoopStartMeasureLeftX() ??
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
    previousPosition: { left: number; top: number };
    nextPosition: { left: number; top: number };
    previousTargetX: number;
    previousMeasureNumber: number;
    previousTimestamp: number;
    nextMeasureNumber: number;
    nextTimestamp: number;
    nextTargetX: number;
  }): boolean {
    // System wraps follow the same visual contract as loop wraps:
    // 1. travel to the current system's closing barline;
    // 2. teleport to the next system's opening barline;
    // 3. continue forward to the next playable note target.
    // The teleport may jump left, but the cursor must never *animate* backward
    // or pass through intermediate systems/bars that are not being played.
    const {
      previousPosition,
      nextPosition,
      previousTargetX,
      previousMeasureNumber,
      previousTimestamp,
      nextMeasureNumber,
      nextTimestamp,
      nextTargetX,
    } = params;

    const previousMeasureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === previousMeasureNumber
    );
    const nextMeasureOverlay = this.measureOverlays.find(
      (measure) => measure.measureNumber === nextMeasureNumber
    );

    if (
      !previousMeasureOverlay ||
      !nextMeasureOverlay ||
      !Number.isFinite(nextTargetX)
    ) {
      this.appendCursorWrapDebugEvent(
        `wrap reject prev m${previousMeasureNumber} next m${nextMeasureNumber} prevX ${
          Math.round(previousTargetX)
        } nextX ${Number.isFinite(nextTargetX) ? Math.round(Number(nextTargetX)) : 'na'}`
      );
      return false;
    }

    this.appendCursorWrapDebugEvent(
      `wrap accept prev m${previousMeasureNumber} next m${nextMeasureNumber} prevX ${Math.round(
        previousTargetX
      )} nextX ${Math.round(nextTargetX)} next ${this.formatScoreTimestamp(
        nextTimestamp
      )}`
    );

    const totalDurationMs = this.getPlaybackDelayMs(
      nextTimestamp - previousTimestamp
    );
    const restartBaseLeft = nextPosition.left;
    const previousTop = previousPosition.top;
    const nextTop = nextPosition.top;
    const resolvedPreviousTargetX = previousTargetX;
    const resolvedNextTargetX = Number(nextTargetX);
    const distanceToSystemEnd = Math.max(
      previousMeasureOverlay.right - resolvedPreviousTargetX,
      0
    );
    const distanceFromSystemStart = Math.max(
      resolvedNextTargetX - nextMeasureOverlay.left,
      0
    );
    const totalTravelDistance = distanceToSystemEnd + distanceFromSystemStart;

    if (totalTravelDistance <= 0) {
      return false;
    }

    this.cancelScheduledPlayCursorAlignment();
    this.resetPlayCursorTransition();
    this.positionPlayCursorAtPoint(
      resolvedPreviousTargetX,
      restartBaseLeft,
      previousTop
    );
    this.appendPlayCursorWrapGeometryDebugEvent(
      'wrap start pin',
      `prevX ${Math.round(resolvedPreviousTargetX)}`
    );

    const animationStartMs = performance.now();
    const tick = () => {
      if (!this.running) {
        this.cancelScheduledPlayCursorAlignment();
        return;
      }

      const elapsedMs = Math.max(performance.now() - animationStartMs, 0);
      const progress =
        totalDurationMs > 0
          ? Math.min(elapsedMs / totalDurationMs, 1)
          : 1;
      const distanceTravelled = totalTravelDistance * progress;

      if (distanceTravelled <= distanceToSystemEnd) {
        const interpolatedX = resolvedPreviousTargetX + distanceTravelled;
        this.positionPlayCursorAtPoint(
          interpolatedX,
          restartBaseLeft,
          previousTop
        );
      } else {
        const interpolatedX =
          nextMeasureOverlay.left + (distanceTravelled - distanceToSystemEnd);
        this.positionPlayCursorAtPoint(interpolatedX, restartBaseLeft, nextTop);
      }

      if (progress >= 1) {
        this.cancelScheduledPlayCursorAlignment();
        this.appendPlayCursorWrapGeometryDebugEvent(
          'wrap handoff',
          `targetX ${Math.round(resolvedNextTargetX)}`
        );
        this.updatePlayCursorVisualAlignment();
        this.refreshCursorWrapDebugSnapshot();
        return;
      }

      this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
    };

    this.playCursorAlignmentFrame = window.requestAnimationFrame(tick);
    return true;
  }

  private appendPlayCursorWrapGeometryDebugEvent(
    label: string,
    extra: string = ''
  ): void {
    const base = this.getPlayCursorPosition();
    const rendered = this.getTraceRenderedPlayCursorPosition();
    const dx = Math.round(this.getPlayCursorTransformX());
    const suffix = extra ? ` ${extra}` : '';

    this.appendCursorWrapDebugEvent(
      `${label} base ${
        base ? `${Math.round(base.left)},${Math.round(base.top)}` : 'na'
      } render ${
        rendered ? `${Math.round(rendered.left)},${Math.round(rendered.top)}` : 'na'
      } dx ${dx}${suffix}`
    );
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

    const { id, left, top, width, height, accidental } = placement;
    this.renderFeedbackNotehead(
      this.incorrectNoteheadElements,
      'feedback-notehead feedback-notehead--incorrect',
      id,
      { left, top, width, height, accidental }
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
    return this.getPracticeGraphicalNotesForCursor(cursor);
  }

  private getPracticeGraphicalNotesForCursor(cursor: any): PracticeGraphicalNote[] {
    return this.getGraphicalNotesForCursor(cursor, this.getPracticeStaffSelection());
  }

  private getAllGraphicalNotesForCursor(cursor: any): PracticeGraphicalNote[] {
    return this.getGraphicalNotesForCursor(cursor);
  }

  private getGraphicalNotesForCursor(
    cursor: any,
    staffSelection?: Record<number, boolean>
  ): PracticeGraphicalNote[] {
    if (!cursor?.GNotesUnderCursor) {
      return [];
    }

    const graphicalNotes = (cursor.GNotesUnderCursor() ?? []).filter((note: any) => {
      const staffId = note?.sourceNote?.ParentStaff?.idInMusicSheet;
      return (
        !staffSelection ||
        staffId === undefined ||
        staffSelection[staffId]
      );
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
        staffId:
          graphicalNote?.sourceNote?.ParentStaff?.idInMusicSheet ?? null,
        pitchInfo: this.getSourcePitchInfo(graphicalNote?.sourceNote),
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

  private resetTimingFeedbackNoteheads(): void {
    this.timingFeedbackNoteheadElements.forEach((element) => element.remove());
    this.timingFeedbackNoteheadElements.clear();
  }

  private getIncorrectNotePlacement(
    halfTone: number
  ): (FeedbackNoteheadPlacement & { id: string }) | null {
    const container = document.getElementById('scoreOverlayHost');
    if (!container) {
      return null;
    }

    const measureNumber =
      (this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex ?? -1) +
      1;
    const measureOverlay = this.getMeasureOverlayByNumber(measureNumber);
    if (!measureOverlay) {
      return null;
    }

    const timestamp = this.getCurrentPracticeTimestamp();
    const staffId = this.getIncorrectFeedbackStaffId(halfTone);
    const geometry = this.getIncorrectFeedbackStaffGeometryEntry(
      measureNumber,
      staffId,
      measureOverlay
    );
    const width = this.getIncorrectFeedbackWidth(geometry);
    const height = this.getIncorrectFeedbackHeight(geometry);
    const centerX =
      this.getTimedLiveCurrentFeedbackCursorLeft(staffId) ??
      this.getPlayCursorOverlayCenterX(container);
    if (!Number.isFinite(centerX)) {
      return null;
    }

    const placement = this.buildFloatingIncorrectFeedbackPlacement({
      playedHalfTone: halfTone,
      middleCY: this.getIncorrectFeedbackMiddleCY(geometry, measureOverlay),
      width,
      height,
      centerX: Number(centerX),
      stepHeight: this.getIncorrectFeedbackStepHeight(geometry, measureOverlay),
      measureNumber,
      scoreTimestamp: timestamp,
      staffId,
    });
    if (!placement) {
      return null;
    }

    const id = `wrong-${this.loopPass}-${timestamp}-${halfTone}-${++this.feedbackInstanceSequence}`;
    return { id, ...placement };
  }

  private isTrebleClefFeedbackPitch(halfTone: number): boolean {
    return (
      Number.isFinite(halfTone) &&
      halfTone >= PlayPageComponent.MIDDLE_C_HALF_TONE
    );
  }

  private buildIncorrectFeedbackPlacement(params: {
    playedHalfTone: number;
    anchorHalfTone: number;
    anchorPitchInfo: SourcePitchInfo | null;
    anchorCenterY: number;
    width: number;
    height: number;
    centerX: number;
    stepHeight: number;
    measureNumber: number;
    scoreTimestamp: number;
    staffId: number | null;
  }): FeedbackNoteheadPlacement | null {
    const anchorStepIndex = params.anchorPitchInfo
      ? this.getPitchDiatonicStepIndex(
          params.anchorPitchInfo.fundamentalNote,
          params.anchorPitchInfo.octave
        )
      : this.getDiatonicStepIndex(params.anchorHalfTone);
    const spelling = this.resolveIncorrectPitchSpelling(
      params.playedHalfTone,
      params.measureNumber,
      params.scoreTimestamp,
      params.staffId,
      anchorStepIndex
    );
    const targetStepIndex =
      spelling?.diatonicStepIndex ?? this.getDiatonicStepIndex(params.playedHalfTone);
    const centerY =
      params.anchorCenterY -
      (targetStepIndex - anchorStepIndex) * params.stepHeight;

    return {
      left: params.centerX - params.width / 2,
      top: centerY - params.height / 2,
      width: params.width,
      height: params.height,
      accidental: this.getFeedbackAccidentalMarker(
        spelling?.displayAccidental ?? null,
        params.height
      ),
    };
  }

  private buildFloatingIncorrectFeedbackPlacement(params: {
    playedHalfTone: number;
    middleCY: number;
    width: number;
    height: number;
    centerX: number;
    stepHeight: number;
    measureNumber: number;
    scoreTimestamp: number;
    staffId: number | null;
  }): FeedbackNoteheadPlacement | null {
    const spelling = this.resolveIncorrectPitchSpelling(
      params.playedHalfTone,
      params.measureNumber,
      params.scoreTimestamp,
      params.staffId,
      this.getDiatonicStepIndex(PlayPageComponent.MIDDLE_C_HALF_TONE)
    );
    const targetStepIndex =
      spelling?.diatonicStepIndex ?? this.getDiatonicStepIndex(params.playedHalfTone);
    const middleCStepIndex = this.getDiatonicStepIndex(
      PlayPageComponent.MIDDLE_C_HALF_TONE
    );
    const centerY =
      params.middleCY - (targetStepIndex - middleCStepIndex) * params.stepHeight;

    return {
      left: params.centerX - params.width / 2,
      top: centerY - params.height / 2,
      width: params.width,
      height: params.height,
      accidental: this.getFeedbackAccidentalMarker(
        spelling?.displayAccidental ?? null,
        params.height
      ),
    };
  }

  private getIncorrectFeedbackMiddleCY(
    geometry: IncorrectFeedbackStaffGeometry | null,
    measureOverlay: MeasureOverlay
  ): number {
    if (geometry) {
      return geometry.middleCY;
    }

    return measureOverlay.top + (measureOverlay.bottom - measureOverlay.top) * 0.5;
  }

  private getIncorrectFeedbackWidth(
    geometry: IncorrectFeedbackStaffGeometry | null
  ): number {
    const height = this.getIncorrectFeedbackHeight(geometry);
    return Math.max(height * 1.33, 10);
  }

  private getIncorrectFeedbackHeight(
    geometry: IncorrectFeedbackStaffGeometry | null
  ): number {
    return Math.max((geometry?.lineSpacing ?? 10) * 0.9, 8);
  }

  private getIncorrectFeedbackStepHeight(
    geometry: IncorrectFeedbackStaffGeometry | null,
    measureOverlay: MeasureOverlay
  ): number {
    if (geometry) {
      return Math.max(geometry.lineSpacing / 2, 4);
    }

    return Math.max((measureOverlay.bottom - measureOverlay.top) / 32, 4);
  }

  private getIncorrectFeedbackStaffId(playedHalfTone: number): number | null {
    if (!Number.isFinite(playedHalfTone)) {
      return null;
    }

    return this.isTrebleClefFeedbackPitch(playedHalfTone) ? 0 : 1;
  }

  private getIncorrectFeedbackStaffGeometryEntry(
    measureNumber: number,
    staffId: number | null,
    measureOverlay: MeasureOverlay
  ): IncorrectFeedbackStaffGeometry | null {
    if (!Number.isFinite(measureNumber) || staffId === null) {
      return null;
    }

    const direct =
      this.incorrectFeedbackStaffGeometry.get(`${measureNumber}:${staffId}`) ?? null;
    if (direct) {
      return direct;
    }

    let nearest: IncorrectFeedbackStaffGeometry | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.incorrectFeedbackStaffGeometry.forEach((entry) => {
      if (entry.staffId !== staffId) {
        return;
      }

      const distance = Math.abs(entry.measureNumber - measureNumber);
      if (distance < nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    });

    if (nearest) {
      return nearest;
    }

    const overlayHeight = Math.max(measureOverlay.bottom - measureOverlay.top, 1);
    const fallbackLineSpacing = Math.max(overlayHeight / 14, 8);
    const isTreble = staffId === 0;
    const topLineY = isTreble
      ? measureOverlay.top + fallbackLineSpacing
      : measureOverlay.bottom - fallbackLineSpacing * 5;
    const bottomLineY = topLineY + fallbackLineSpacing * 4;

    return {
      measureNumber,
      staffId,
      topLineY,
      bottomLineY,
      lineSpacing: fallbackLineSpacing,
      middleCY: isTreble ? bottomLineY + fallbackLineSpacing : topLineY - fallbackLineSpacing,
    };
  }

  private getTimedLiveCurrentFeedbackCursorLeft(
    preferredStaffId: number | null = null
  ): number | null {
    if (!this.shouldUseTimedLiveRealtimeClassification()) {
      return null;
    }

    const scoreTimestamp = this.getTimedLiveCursorScoreTimestamp();
    if (!Number.isFinite(scoreTimestamp)) {
      return null;
    }

    return this.getTimedLiveStableFeedbackCursorLeft(
      Number(scoreTimestamp),
      preferredStaffId
    );
  }

  private getTimedLiveStableFeedbackCursorLeft(
    scoreTimestamp: number,
    preferredStaffId: number | null = null
  ): number | null {
    const renderState = this.getTimedLiveRenderedCursorState(scoreTimestamp);
    if (!renderState || !Number.isFinite(renderState.left)) {
      return null;
    }

    const anchorNotes = this.getTimedLiveStableFeedbackAnchorNotes(
      renderState.event,
      preferredStaffId
    );
    if (anchorNotes.length === 0) {
      return null;
    }

    return Number(renderState.left);
  }

  private getTimedLiveRenderedCursorState(scoreTimestamp: number): {
    left: number;
    top: number;
    height: number;
    progress: number | null;
    segment: TimedLiveCursorSegment | null;
    event: TimedLiveCursorEvent | null;
  } | null {
    // Feedback notes should use the green cursor exactly as it is rendered on
    // screen. If the animation loop has already produced a visible cursor state
    // for roughly this timestamp, prefer that state over recomputing from the
    // timeline. This avoids drift near loop/system boundaries.
    const activeRenderState = this.timedLiveCursorRenderState;
    if (
      activeRenderState?.visible &&
      Number.isFinite(activeRenderState.left) &&
      Number.isFinite(activeRenderState.top) &&
      Number.isFinite(activeRenderState.height) &&
      activeRenderState.scoreTimestamp !== null &&
      Math.abs(activeRenderState.scoreTimestamp - scoreTimestamp) <= 1 / 128
    ) {
      return {
        left: activeRenderState.left,
        top: activeRenderState.top,
        height: activeRenderState.height,
        progress: null,
        segment: null,
        event: this.getTimedLiveCursorEventAtOrBefore(activeRenderState.scoreTimestamp),
      };
    }

    return this.resolveTimedLiveCursorRenderAtTimestamp(scoreTimestamp);
  }

  private getTimedLiveStableFeedbackAnchorNotes(
    event: TimedLiveCursorEvent | null,
    preferredStaffId: number | null = null
  ): TimedLiveCursorNote[] {
    if (!event) {
      return [];
    }

    const selectedNotes = this.getTimedLiveSelectedEventNotes(event)
      .map(({ note }) => note)
      .filter(
        (note) =>
          Number.isFinite(note.left) &&
          Number.isFinite(note.top) &&
          (preferredStaffId === null || note.staffId === preferredStaffId)
      );
    if (selectedNotes.length > 0) {
      return selectedNotes;
    }

    return event.notes.filter(
      (note) =>
        Number.isFinite(note.left) &&
        Number.isFinite(note.top) &&
        (preferredStaffId === null || note.staffId === preferredStaffId)
    );
  }

  private resolveIncorrectPitchSpelling(
    halfTone: number,
    measureNumber: number,
    scoreTimestamp: number,
    staffId: number | null,
    anchorStepIndex: number | null
  ): IncorrectPitchSpelling | null {
    const candidates = this.buildIncorrectPitchCandidates(halfTone);
    if (
      candidates.length === 0 ||
      !Number.isFinite(measureNumber) ||
      !Number.isFinite(scoreTimestamp) ||
      staffId === null ||
      !Number.isFinite(staffId)
    ) {
      return null;
    }

    const keySignature = this.getKeySignatureAccidentals(measureNumber, staffId);
    const measureState = this.buildMeasureAccidentalState(
      measureNumber,
      scoreTimestamp,
      staffId
    );
    const keyDirection =
      keySignature.keyType < 0 ? -1 : keySignature.keyType > 0 ? 1 : 0;
    let bestCandidate: IncorrectPitchSpelling | null = null;
    let bestScore: number[] | null = null;

    candidates.forEach((candidate) => {
      const currentAccidental = this.getCurrentAccidentalForPitch(
        candidate.fundamentalNote,
        candidate.octave,
        keySignature.alterations,
        measureState
      );
      const displayAccidental = this.getDisplayAccidentalKind(
        currentAccidental,
        candidate.accidentalHalfTones
      );
      const score = [
        displayAccidental === null ? 0 : displayAccidental === 'natural' ? 1 : 2,
        anchorStepIndex === null
          ? 0
          : Math.abs(candidate.diatonicStepIndex - anchorStepIndex),
        this.getKeyBiasCost(displayAccidental, keyDirection),
        Math.abs(candidate.accidentalHalfTones),
        candidate.diatonicStepIndex,
      ];
      if (!this.isAccidentalCandidateScoreBetter(score, bestScore)) {
        return;
      }

      bestCandidate = {
        ...candidate,
        displayAccidental,
      };
      bestScore = score;
    });

    return bestCandidate;
  }

  private buildIncorrectPitchCandidates(halfTone: number): IncorrectPitchSpelling[] {
    const candidates: IncorrectPitchSpelling[] = [];
    const seen = new Set<string>();

    [0, 2, 4, 5, 7, 9, 11].forEach((fundamentalNote) => {
      [-1, 0, 1].forEach((accidentalHalfTones) => {
        const rawOctave = halfTone - fundamentalNote - accidentalHalfTones;
        if (((rawOctave % 12) + 12) % 12 !== 0) {
          return;
        }

        const octave = Math.round(rawOctave / 12) - 3;
        const key = `${fundamentalNote}:${octave}:${accidentalHalfTones}`;
        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        candidates.push({
          fundamentalNote,
          octave,
          accidentalHalfTones,
          diatonicStepIndex: this.getPitchDiatonicStepIndex(
            fundamentalNote,
            octave
          ),
          displayAccidental: null,
        });
      });
    });

    return candidates;
  }

  private buildMeasureAccidentalState(
    measureNumber: number,
    scoreTimestamp: number,
    staffId: number
  ): Map<string, number> {
    const state = new Map<string, number>();
    const measureIndex = this.getSourceMeasureIndexByNumber(measureNumber);
    if (measureIndex < 0) {
      return state;
    }

    const measure: any =
      this.openSheetMusicDisplay?.Sheet?.SourceMeasures?.[measureIndex];
    const measureStart =
      measure?.AbsoluteTimestamp?.RealValue ?? measure?.absoluteTimestamp?.realValue;
    if (!Number.isFinite(measureStart)) {
      return state;
    }

    const relativeTimestamp = scoreTimestamp - Number(measureStart);
    const timestampContainers =
      measure?.VerticalSourceStaffEntryContainers ??
      measure?.verticalSourceStaffEntryContainers ??
      [];
    timestampContainers.forEach((container: any) => {
      const timestamp =
        container?.Timestamp?.RealValue ??
        container?.timestamp?.RealValue ??
        container?.timestamp?.realValue ??
        container?.timestamp;
      if (!Number.isFinite(timestamp) || timestamp >= relativeTimestamp - 0.000001) {
        return;
      }

      const staffEntries = container?.StaffEntries ?? container?.staffEntries ?? [];
      const staffEntry =
        staffEntries[staffId] ??
        staffEntries.find(
          (entry: any, index: number) =>
            (entry?.ParentStaff?.idInMusicSheet ??
              entry?.parentStaff?.idInMusicSheet ??
              index) === staffId
        );
      if (!staffEntry) {
        return;
      }

      const voiceEntries = staffEntry?.VoiceEntries ?? staffEntry?.voiceEntries ?? [];
      voiceEntries.forEach((voiceEntry: any) => {
        const notes = voiceEntry?.Notes ?? voiceEntry?.notes ?? [];
        notes.forEach((note: any) => {
          if (note?.isRest?.() === true || note?.isRestFlag === true) {
            return;
          }

          const pitchInfo = this.getSourcePitchInfo(note);
          if (!pitchInfo) {
            return;
          }

          state.set(
            `${pitchInfo.fundamentalNote}:${pitchInfo.octave}`,
            pitchInfo.accidentalHalfTones
          );
        });
      });
    });

    return state;
  }

  private getKeySignatureAccidentals(
    measureNumber: number,
    staffId: number
  ): { keyType: number; alterations: Map<number, number> } {
    const alterations = new Map<number, number>();
    const measureIndex = this.getSourceMeasureIndexByNumber(measureNumber);
    if (measureIndex < 0) {
      return { keyType: 0, alterations };
    }

    const keyInstruction = this.getKeyInstructionForMeasure(measureIndex, staffId);
    const keyType = Number(keyInstruction?.Key ?? keyInstruction?.keyType ?? 0);
    const alteratedNotes =
      keyInstruction?.AlteratedNotes ?? keyInstruction?.alteratedNotes ?? [];
    const accidentalHalfTones = keyType > 0 ? 1 : keyType < 0 ? -1 : 0;

    alteratedNotes.forEach((note: number) => {
      if (!Number.isFinite(note) || accidentalHalfTones === 0) {
        return;
      }

      alterations.set(Number(note), accidentalHalfTones);
    });

    return { keyType, alterations };
  }

  private getKeyInstructionForMeasure(measureIndex: number, staffId: number): any {
    const measures: any[] = this.openSheetMusicDisplay?.Sheet?.SourceMeasures ?? [];
    for (let index = measureIndex; index >= 0; index--) {
      const instructionEntries =
        measures[index]?.FirstInstructionsStaffEntries ??
        measures[index]?.firstInstructionsStaffEntries ??
        [];
      const staffEntry = instructionEntries[staffId];
      if (!staffEntry) {
        continue;
      }

      const instructions = Array.from(
        staffEntry?.Instructions ?? staffEntry?.instructions ?? []
      );
      const keyInstruction = instructions.find((instruction: any) =>
        Array.isArray(
          instruction?.AlteratedNotes ?? instruction?.alteratedNotes
        )
      );
      if (keyInstruction) {
        return keyInstruction;
      }
    }

    return null;
  }

  private getCurrentAccidentalForPitch(
    fundamentalNote: number,
    octave: number,
    keySignatureAlterations: Map<number, number>,
    measureAccidentals: Map<string, number>
  ): number {
    return (
      measureAccidentals.get(`${fundamentalNote}:${octave}`) ??
      keySignatureAlterations.get(fundamentalNote) ??
      0
    );
  }

  private getDisplayAccidentalKind(
    currentAccidental: number,
    targetAccidental: number
  ): FeedbackAccidentalKind | null {
    if (currentAccidental === targetAccidental) {
      return null;
    }

    if (targetAccidental === 0) {
      return 'natural';
    }
    if (targetAccidental === 1) {
      return 'sharp';
    }
    if (targetAccidental === -1) {
      return 'flat';
    }

    return null;
  }

  private getKeyBiasCost(
    accidental: FeedbackAccidentalKind | null,
    keyDirection: number
  ): number {
    if (accidental === null || keyDirection === 0) {
      return 0;
    }
    if (accidental === 'natural') {
      return 1;
    }
    if (
      (keyDirection < 0 && accidental === 'flat') ||
      (keyDirection > 0 && accidental === 'sharp')
    ) {
      return 0;
    }

    return 2;
  }

  private isAccidentalCandidateScoreBetter(
    candidateScore: number[],
    bestScore: number[] | null
  ): boolean {
    if (!bestScore) {
      return true;
    }

    for (let index = 0; index < candidateScore.length; index++) {
      if (candidateScore[index] === bestScore[index]) {
        continue;
      }

      return candidateScore[index] < bestScore[index];
    }

    return false;
  }

  private getFeedbackAccidentalMarker(
    accidental: FeedbackAccidentalKind | null,
    noteHeight: number
  ): FeedbackAccidentalMarker | null {
    if (!accidental) {
      return null;
    }

    return {
      kind: accidental,
      symbol: this.getFeedbackAccidentalSymbol(accidental),
      fontSize: Math.max(noteHeight * 1.9, 14),
    };
  }

  private getFeedbackAccidentalSymbol(
    accidental: FeedbackAccidentalKind
  ): string {
    switch (accidental) {
      case 'sharp':
        return '♯';
      case 'flat':
        return '♭';
      default:
        return '♮';
    }
  }

  private getSourcePitchInfo(sourceNote: any): SourcePitchInfo | null {
    const pitch = sourceNote?.Pitch ?? sourceNote?.pitch;
    const fundamentalNote =
      pitch?.FundamentalNote ?? pitch?.fundamentalNote ?? null;
    const octave = pitch?.Octave ?? pitch?.octave ?? null;
    const accidental = pitch?.Accidental ?? pitch?.accidental ?? null;
    const halfTone =
      pitch?.HalfTone ?? pitch?.halfTone ?? sourceNote?.halfTone ?? null;
    if (
      !Number.isFinite(fundamentalNote) ||
      !Number.isFinite(octave) ||
      !Number.isFinite(halfTone)
    ) {
      return null;
    }

    return {
      halfTone: Number(halfTone),
      fundamentalNote: Number(fundamentalNote),
      octave: Number(octave),
      accidentalHalfTones: this.getAccidentalHalfTones(
        Number.isFinite(accidental) ? Number(accidental) : null
      ),
    };
  }

  private getAccidentalHalfTones(accidental: number | null): number {
    switch (accidental) {
      case 0:
        return 1;
      case 1:
        return -1;
      case 4:
        return 2;
      case 5:
        return -2;
      default:
        return 0;
    }
  }

  private getSourceMeasureIndexByNumber(measureNumber: number): number {
    return (
      this.openSheetMusicDisplay?.Sheet?.SourceMeasures?.findIndex(
        (measure: any, index: number) =>
          (measure.MeasureNumber ?? measure.measureNumber ?? index + 1) ===
          measureNumber
      ) ?? -1
    );
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

  private getPitchDiatonicStepIndex(
    fundamentalNote: number,
    octave: number
  ): number {
    const diatonicOrder = this.getDiatonicOrderFromFundamentalNote(fundamentalNote);
    if (diatonicOrder === null) {
      return this.getDiatonicStepIndex(12 * (octave + 3) + fundamentalNote);
    }

    return (octave + 3) * 7 + diatonicOrder;
  }

  private getDiatonicOrderFromFundamentalNote(
    fundamentalNote: number
  ): number | null {
    switch (fundamentalNote) {
      case 0:
        return 0;
      case 2:
        return 1;
      case 4:
        return 2;
      case 5:
        return 3;
      case 7:
        return 4;
      case 9:
        return 5;
      case 11:
        return 6;
      default:
        return null;
    }
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
    this.relayDebugEvent('realtime', message);
  }

  private appendCursorTraceEvent(message: string): void {
    if (!PlayPageComponent.ENABLE_CURSOR_TRACE) {
      return;
    }
    this.cursorTraceEvents.push(message);
    this.relayDebugEvent('trace', message);
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
      `m${snapshot.measureNumber} ${this.formatScoreTimestamp(snapshot.timestamp)}`,
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
    this.relayDebugEvent('wrap', message);
  }

  private relayDebugEvent(
    channel: 'wrap' | 'realtime' | 'trace',
    message: string
  ): void {
    if (!isDevMode()) {
      return;
    }

    if (this.museDebugConsoleRelay[channel]) {
      console.debug(`[muse:${channel}] ${message}`);
    }

    if (this.museDebugLocalRelay[channel]) {
      void this.postMuseDebugRelayEvent(channel, message);
    }
  }

  private async postMuseDebugRelayEvent(
    channel: 'wrap' | 'realtime' | 'trace',
    message: string
  ): Promise<void> {
    try {
      await fetch(this.museDebugLocalRelayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          message,
          transportMode: this.transportMode,
          loopPass: this.loopPass,
          measureNumber:
            (this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentMeasureIndex ??
              -1) + 1,
          timestamp:
            this.openSheetMusicDisplay?.cursors?.[0]?.iterator?.CurrentSourceTimestamp
              ?.RealValue ?? null,
        }),
        keepalive: true,
      });
    } catch (error) {
      if (this.museDebugConsoleRelay[channel]) {
        console.warn(
          `[muse:${channel}] local relay failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private installMuseDebugApi(): void {
    if (!isDevMode() || typeof window === 'undefined') {
      return;
    }

    window.__museDebug = {
      getWrapLog: () => [...this.cursorWrapDebugEvents],
      getRealtimeLog: () => [...this.realtimeDebugEvents],
      getCursorTrace: () => [...this.cursorTraceEvents],
      getTimedLiveCursorDebug: () => ({
        renderState: this.timedLiveCursorRenderState,
        windows: [...this.timedLiveCursorWindowRects],
        thresholds: [...this.timedLiveCursorThresholdMarkers],
        snapshot: this.timedLiveCursorDebugSnapshot,
        sessionTotals: { ...this.timedLiveCursorDebugSessionTotals },
        simulatedInputEnabled: this.timedLiveSimulatedInputEnabled,
        simulatedTimingOffsetMs: this.timedLiveSimulatedTimingOffsetMs,
        simulatedPitchOffsetSemitones: this.timedLiveSimulatedPitchOffsetSemitones,
        simulationEarlyThresholdMs: this.getTimedLiveSimulationEarlyThresholdMs(),
        simulationLateThresholdMs: this.getTimedLiveSimulationLateThresholdMs(),
        simulatedFeedbackStats: { ...this.timedLiveSimulatedFeedbackStats },
      }),
      clearWrapLog: () => {
        this.cursorWrapDebugEvents = [];
      },
      clearRealtimeLog: () => {
        this.realtimeDebugEvents = [];
      },
      clearCursorTrace: () => {
        this.cursorTraceEvents = [];
      },
      getState: () => this.getMuseDebugState(),
      playListen: () => this.osmdListen(),
      playWait: () => this.osmdPractice(),
      playRealtime: () => this.osmdPracticeRealtime(),
      stop: () => this.osmdStop(),
      setTimedCursorDebug: (enabled = true) => {
        this.showTimedLiveCursorDebugOverlay = enabled;
        this.handleTimedLiveCursorDebugOverlayChange();
      },
      setTimedCursorSim: (
        enabled = true,
        offsetMs = this.timedLiveSimulatedTimingOffsetMs,
        pitchOffsetSemitones = this.timedLiveSimulatedPitchOffsetSemitones
      ) => {
        this.timedLiveSimulatedInputEnabled = enabled;
        this.timedLiveSimulatedTimingOffsetMs = offsetMs;
        this.timedLiveSimulatedPitchOffsetSemitones = pitchOffsetSemitones;
        this.handleTimedLiveSimulatedInputChange();
      },
      enableConsoleRelay: (channel = 'all', enabled = true) => {
        if (channel === 'all') {
          this.museDebugConsoleRelay.wrap = enabled;
          this.museDebugConsoleRelay.realtime = enabled;
          this.museDebugConsoleRelay.trace = enabled;
          return;
        }

        this.museDebugConsoleRelay[channel] = enabled;
      },
      enableLocalRelay: (channel = 'all', enabled = true) => {
        if (channel === 'all') {
          this.museDebugLocalRelay.wrap = enabled;
          this.museDebugLocalRelay.realtime = enabled;
          this.museDebugLocalRelay.trace = enabled;
          return;
        }

        this.museDebugLocalRelay[channel] = enabled;
      },
      setLocalRelayUrl: (url: string) => {
        this.museDebugLocalRelayUrl = url;
      },
      clearLocalRelay: async () => {
        await fetch(this.museDebugLocalRelayUrl.replace(/\/log$/, '/clear'), {
          method: 'POST',
        });
      },
      getRelayStatus: () => ({
        consoleRelay: { ...this.museDebugConsoleRelay },
        localRelay: { ...this.museDebugLocalRelay },
        localRelayUrl: this.museDebugLocalRelayUrl,
      }),
      dumpWrapLog: () => {
        const lines = [...this.cursorWrapDebugEvents].reverse();
        lines.forEach((line) => console.debug(`[muse:wrap] ${line}`));
        return lines;
      },
    };
  }

  private uninstallMuseDebugApi(): void {
    if (typeof window === 'undefined' || window.__museDebug === undefined) {
      return;
    }

    delete window.__museDebug;
  }

  private getMuseDebugState(): Record<string, unknown> {
    const cursor = this.openSheetMusicDisplay?.cursors?.[0];
    const container = document.getElementById('scoreOverlayHost');
    const base = this.getPlayCursorPosition();
    const rendered = this.getTraceRenderedPlayCursorPosition();
    const visualDebug = container
      ? this.getCurrentPlayCursorVisualDebug(container)
      : null;

    return {
      running: this.running,
      transportMode: this.transportMode,
      loopPass: this.loopPass,
      measureNumber:
        (cursor?.iterator?.CurrentMeasureIndex ?? -1) + 1,
      timestamp: cursor?.iterator?.CurrentSourceTimestamp?.RealValue ?? null,
      requiredSummary: this.formatRequiredNoteSummary(),
      skipPlayNotes: this.skipPlayNotes,
      playbackClock: { ...this.playbackClock },
      cursorBase: base,
      cursorRendered: rendered,
      cursorTransformX: this.getPlayCursorTransformX(),
      wrapSnapshot: this.cursorWrapDebugSnapshot,
      visualTargets: visualDebug,
      wrapLogSize: this.cursorWrapDebugEvents.length,
      realtimeLogSize: this.realtimeDebugEvents.length,
      traceLogSize: this.cursorTraceEvents.length,
      timedLiveCursorDebugEnabled: this.showTimedLiveCursorDebugOverlay,
      timedLiveCursorRenderState: this.timedLiveCursorRenderState,
      timedLiveCursorWindowCount: this.timedLiveCursorWindowRects.length,
      timedLiveCursorThresholdCount: this.timedLiveCursorThresholdMarkers.length,
      timedLiveCursorSnapshot: this.timedLiveCursorDebugSnapshot,
      timedLiveSimulatedInputEnabled: this.timedLiveSimulatedInputEnabled,
      timedLiveSimulatedTimingOffsetMs: this.timedLiveSimulatedTimingOffsetMs,
      timedLiveSimulatedPitchOffsetSemitones:
        this.timedLiveSimulatedPitchOffsetSemitones,
      timedLiveSimulationEarlyThresholdMs:
        this.getTimedLiveSimulationEarlyThresholdMs(),
      timedLiveSimulationLateThresholdMs:
        this.getTimedLiveSimulationLateThresholdMs(),
      timedLiveSimulatedFeedbackStats: this.timedLiveSimulatedFeedbackStats,
    };
  }

  private formatRequiredNoteSummary(): string {
    const notes = Array.from(this.notesService.getMapRequired().values())
      .map((note) => {
        const pitchLabel = this.noteKeyToLabel(note.key);
        const freshness = note.value === 0 ? 'new' : `hold${note.value}`;
        return `${pitchLabel}:${freshness}@${this.formatScoreTimestamp(
          note.timestamp
        )}`;
      })
      .sort();

    return notes.join(' ') || 'none';
  }

  private appendLoopRestartStateDebugEvent(label: string): void {
    if (!this.showCursorWrapDebugOverlay) {
      return;
    }

    const cursor = this.openSheetMusicDisplay?.cursors?.[0];
    const currentTimestamp =
      cursor?.iterator?.CurrentSourceTimestamp?.RealValue ?? NaN;
    const currentMeasureNumber =
      (cursor?.iterator?.CurrentMeasureIndex ?? -1) + 1;
    const nextIter = cursor?.iterator?.clone?.();
    let nextTimestamp = NaN;
    let nextMeasureNumber = NaN;
    if (nextIter) {
      nextIter.moveToNext();
      if (!nextIter.EndReached) {
        nextTimestamp = nextIter.CurrentSourceTimestamp?.RealValue ?? NaN;
        nextMeasureNumber = (nextIter.CurrentMeasureIndex ?? -1) + 1;
      }
    }

    const container = document.getElementById('scoreOverlayHost');
    const preferredTargets = container
      ? this.getPreferredActivePracticeTargetCenters(container)
      : [];

    this.appendCursorWrapDebugEvent(
      `${label} cur ${this.formatScoreTimestamp(currentTimestamp)} next ${
        Number.isFinite(nextTimestamp)
          ? this.formatScoreTimestamp(nextTimestamp)
          : 'end'
      } skip ${this.skipPlayNotes} req[${
        this.formatRequiredNoteSummary()
      }] vis[${this.formatCursorDebugTargets(preferredTargets)}] m${
        Number.isFinite(currentMeasureNumber) ? currentMeasureNumber : '?'
      }->${
        Number.isFinite(nextMeasureNumber) ? nextMeasureNumber : 'end'
      }`
    );
  }

  private withCursorFollowSuppressed<T>(work: () => T): T {
    const cursor0: any = this.openSheetMusicDisplay?.cursors?.[0];
    const cursor1: any = this.openSheetMusicDisplay?.cursors?.[1];
    const previousFollowCursor = this.openSheetMusicDisplay?.FollowCursor;
    const previousCursor0Follow = cursor0?.cursorOptions?.follow;
    const previousCursor1Follow = cursor1?.cursorOptions?.follow;

    if (typeof previousFollowCursor === 'boolean') {
      this.openSheetMusicDisplay.FollowCursor = false;
    }
    if (cursor0?.cursorOptions) {
      cursor0.cursorOptions.follow = false;
    }
    if (cursor1?.cursorOptions) {
      cursor1.cursorOptions.follow = false;
    }

    try {
      return work();
    } finally {
      if (typeof previousFollowCursor === 'boolean') {
        this.openSheetMusicDisplay.FollowCursor = previousFollowCursor;
      }
      if (cursor0?.cursorOptions) {
        cursor0.cursorOptions.follow = previousCursor0Follow;
      }
      if (cursor1?.cursorOptions) {
        cursor1.cursorOptions.follow = previousCursor1Follow;
      }
    }
  }

  private appendScheduledAudioDebugEvent(
    kind: 'on' | 'off',
    pitch: number,
    audioTime?: number
  ): void {
    if (!this.showCursorWrapDebugOverlay) {
      return;
    }

    const halfTone = pitch - 12;
    const pitchLabel = this.noteKeyToLabel(halfTone.toFixed());
    const audioLabel =
      typeof audioTime === 'number' && Number.isFinite(audioTime)
        ? audioTime.toFixed(3)
        : 'na';
    const scoreLabel = this.formatScoreTimestamp(this.getCurrentPracticeTimestamp());
    this.appendCursorWrapDebugEvent(
      `audio ${kind} ${pitchLabel} at ${audioLabel} ${scoreLabel}`
    );
  }

  private getRetriggerReleaseAudioTime(audioTime?: number): number | undefined {
    if (typeof audioTime !== 'number' || !Number.isFinite(audioTime)) {
      return audioTime;
    }

    const retriggerGapSec = Math.min(
      0.02,
      Math.max(0.012, PlayPageComponent.AUDIO_SCHEDULE_AHEAD_SEC * 0.3)
    );
    return Math.max(toneNow(), audioTime - retriggerGapSec);
  }

  private formatScoreTimestamp(timestamp: number | null): string {
    if (!Number.isFinite(timestamp)) {
      return 't?';
    }

    const measure = this.getMeasureAtTimestamp(Number(timestamp));
    if (!measure) {
      return `t${Number(timestamp).toFixed(3)}`;
    }

    const measureNumber = measure.MeasureNumber ?? measure.measureListIndex + 1 ?? null;
    const measureStart = measure.AbsoluteTimestamp?.RealValue;
    const beatLength = this.getBeatLengthInWholeNotes(measure);
    if (
      !Number.isFinite(measureStart) ||
      !Number.isFinite(beatLength) ||
      beatLength <= 0
    ) {
      return `t${Number(timestamp).toFixed(3)}`;
    }

    const beatOffset = (Number(timestamp) - measureStart) / beatLength;
    return `t${Number(timestamp).toFixed(3)} b${beatOffset.toFixed(2)}${Number.isFinite(measureNumber) ? ` m${measureNumber}` : ''}`;
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
    this.refreshTimedLiveCursorTimelineDeferred();
    this.refreshCursorDebugMarkersDeferred();
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
    this.refreshTimedLiveCursorTimelineDeferred();
    this.refreshCursorDebugMarkersDeferred();
  }

  private restoreLoopRange(): void {
    if (this.savedLoopRange) {
      this.inputMeasure.lower = this.savedLoopRange.lower;
      this.inputMeasure.upper = this.savedLoopRange.upper;
      this.checkboxRepeat = true;
      this.showRangePicker = true;
      this.loopPass = 0;
      this.refreshTimedLiveCursorTimelineDeferred();
      this.refreshCursorDebugMarkersDeferred();
      return;
    }

    this.showRangePicker = true;
    this.refreshTimedLiveCursorTimelineDeferred();
    this.refreshCursorDebugMarkersDeferred();
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
      this.incorrectFeedbackStaffGeometry.clear();
      this.timedLiveCursorTimeline = null;
      this.timedLiveCursorRenderState = null;
      return;
    }

    const sheet: any = this.openSheetMusicDisplay?.Sheet;
    const graphicSheet: any = this.openSheetMusicDisplay?.GraphicSheet;
    const container = document.getElementById('scoreOverlayHost');

    if (!sheet || !graphicSheet || !container) {
      this.measureOverlays = [];
      this.incorrectFeedbackStaffGeometry.clear();
      this.timedLiveCursorTimeline = null;
      this.timedLiveCursorRenderState = null;
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
    this.incorrectFeedbackStaffGeometry =
      this.buildIncorrectFeedbackStaffGeometry();
    this.refreshTimedLiveCursorTimelineDeferred();
    this.refreshCursorDebugMarkersDeferred();
  }

  private buildIncorrectFeedbackStaffGeometry(): Map<
    string,
    IncorrectFeedbackStaffGeometry
  > {
    const geometry = new Map<string, IncorrectFeedbackStaffGeometry>();
    const sheet: any = this.openSheetMusicDisplay?.Sheet;
    const graphicSheet: any = this.openSheetMusicDisplay?.GraphicSheet;
    const container = document.getElementById('scoreOverlayHost');
    if (!sheet || !graphicSheet || !container) {
      return geometry;
    }

    const containerRect = container.getBoundingClientRect();

    sheet.SourceMeasures.forEach((sourceMeasure: any, index: number) => {
      const measureNumber = index + 1;
      const graphicalMeasures = this.getGraphicalMeasuresForSourceMeasure(
        sourceMeasure,
        index,
        graphicSheet
      );

      graphicalMeasures.forEach((measure: any) => {
        const staffId = measure?.ParentStaff?.idInMusicSheet;
        const staffLine = measure?.ParentStaffLine;
        const staffLines = staffLine?.StaffLines ?? [];
        if (!Number.isFinite(staffId) || staffLines.length < 5) {
          return;
        }

        const lineYs = staffLines
          .slice(0, 5)
          .map((line: any) =>
            this.getIncorrectFeedbackStaffLineY(
              line,
              staffLine,
              containerRect
            )
          )
          .filter((lineY: number | null): lineY is number => Number.isFinite(lineY));
        if (lineYs.length < 5) {
          return;
        }

        const lineSpacing = Math.max(this.getAverageAdjacentDistance(lineYs), 8);
        const topLineY = lineYs[0];
        const bottomLineY = lineYs[lineYs.length - 1];
        const isTreble = staffId === 0;

        geometry.set(`${measureNumber}:${staffId}`, {
          measureNumber,
          staffId,
          topLineY,
          bottomLineY,
          lineSpacing,
          middleCY: isTreble
            ? bottomLineY + lineSpacing
            : topLineY - lineSpacing,
        });
      });
    });

    return geometry;
  }

  private getIncorrectFeedbackStaffLineY(
    line: any,
    staffLine: any,
    containerRect: DOMRect
  ): number | null {
    const staffAbsoluteY = staffLine?.PositionAndShape?.AbsolutePosition?.y;
    const lineY =
      line?.Start?.y ??
      line?.start?.y ??
      line?.End?.y ??
      line?.end?.y;
    if (!Number.isFinite(staffAbsoluteY) || !Number.isFinite(lineY)) {
      return null;
    }

    const domRect = this.convertSvgRectToDomRect({
      x: 0,
      y: (staffAbsoluteY + lineY) * PlayPageComponent.OSMD_UNIT_IN_PIXELS,
      width: 0,
      height: 0,
    });
    if (!domRect) {
      return null;
    }

    return domRect.top - containerRect.top;
  }

  private getAverageAdjacentDistance(values: number[]): number {
    if (values.length < 2) {
      return 0;
    }

    const deltas = values
      .slice(1)
      .map((value, index) => value - values[index])
      .filter((delta) => Number.isFinite(delta) && delta > 0);
    if (deltas.length === 0) {
      return 0;
    }

    return deltas.reduce((total, delta) => total + delta, 0) / deltas.length;
  }

  private refreshTimedLiveCursorTimelineDeferred(): void {
    if (this.timedLiveCursorRefreshTimeout !== null) {
      window.clearTimeout(this.timedLiveCursorRefreshTimeout);
    }

    this.timedLiveCursorRefreshTimeout = window.setTimeout(() => {
      this.timedLiveCursorRefreshTimeout = null;
      this.refreshTimedLiveCursorTimeline();
    }, 0);
  }

  private refreshTimedLiveCursorTimeline(): void {
    if (!this.fileLoaded) {
      this.timedLiveCursorTimeline = null;
      this.timedLiveCursorRenderState = null;
      this.syncTimedLiveCursorDebugLoop();
      return;
    }

    // Build the new timed/live cursor timeline only while idle so we do not
    // disturb the active playback cursors until the runtime handoff is ready.
    if (this.running) {
      return;
    }

    const cursor: any = this.openSheetMusicDisplay?.cursors?.[0];
    const container = document.getElementById('scoreOverlayHost');
    if (!cursor || !container || this.measureOverlays.length === 0) {
      this.timedLiveCursorTimeline = null;
      this.timedLiveCursorRenderState = null;
      this.syncTimedLiveCursorDebugLoop();
      return;
    }

    const timeline = this.buildTimedLiveCursorTimeline(cursor, container);
    this.timedLiveCursorTimeline = timeline;
    this.timedLiveCursorRenderState = timeline
      ? {
          left: timeline.startLeft,
          top: timeline.startTop,
          height: timeline.startHeight,
          visible: false,
          scoreTimestamp: null,
          transitionMode: 'smooth',
        }
      : null;
    this.syncTimedLiveCursorDebugLoop();
  }

  private buildTimedLiveCursorTimeline(
    cursor: any,
    container: HTMLElement
  ): TimedLiveCursorTimeline | null {
    // The timed-live timeline is the canonical visual model for live playback.
    // We still walk OSMD's cursor to enumerate score events, but once the
    // timeline exists the rendered green cursor and feedback note placement
    // should be derived from this structure rather than from raw cursor math.
    const startMeasure = this.getSourceMeasureByNumber(this.inputMeasure.lower);
    const endMeasure = this.getSourceMeasureByNumber(this.inputMeasure.upper);
    const startOverlay = this.getMeasureOverlayByNumber(this.inputMeasure.lower);
    const endOverlay = this.getMeasureOverlayByNumber(this.inputMeasure.upper);

    if (!startMeasure || !endMeasure || !startOverlay || !endOverlay) {
      return null;
    }

    const startTimestamp = startMeasure.AbsoluteTimestamp?.RealValue;
    const endTimestamp =
      endMeasure.AbsoluteTimestamp?.RealValue + endMeasure.Duration?.RealValue;
    if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) {
      return null;
    }

    const events: TimedLiveCursorEvent[] = [];
    const previousFollowCursor = this.openSheetMusicDisplay?.FollowCursor;
    const previousCursorFollow = cursor?.cursorOptions?.follow;
    const wasHidden = !!cursor?.hidden;

    if (typeof previousFollowCursor === 'boolean') {
      this.openSheetMusicDisplay.FollowCursor = false;
    }
    if (cursor?.cursorOptions) {
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
          const event = this.buildTimedLiveCursorEvent(
            cursor,
            container,
            events.length
          );
          if (event) {
            events.push(event);
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
      if (typeof previousFollowCursor === 'boolean') {
        this.openSheetMusicDisplay.FollowCursor = previousFollowCursor;
      }
      if (cursor?.cursorOptions) {
        cursor.cursorOptions.follow = previousCursorFollow;
      }
      if (wasHidden) {
        cursor.hide?.();
      }
    }

    if (events.length === 0) {
      return null;
    }

    return {
      range: {
        lower: this.inputMeasure.lower,
        upper: this.inputMeasure.upper,
      },
      startTimestamp: Number(startTimestamp),
      startLeft: startOverlay.left,
      startTop: startOverlay.top,
      startHeight: Math.max(startOverlay.bottom - startOverlay.top, 12),
      endTimestamp: Number(endTimestamp),
      endLeft: endOverlay.right,
      endTop: endOverlay.top,
      endHeight: Math.max(endOverlay.bottom - endOverlay.top, 12),
      events,
      segments: this.buildTimedLiveCursorSegments(
        events,
        Number(startTimestamp),
        Number(endTimestamp),
        startOverlay,
        endOverlay
      ),
      builtAt: Date.now(),
    };
  }

  private buildTimedLiveCursorEvent(
    cursor: any,
    container: HTMLElement,
    index: number
  ): TimedLiveCursorEvent | null {
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

    const measureOverlay = this.getMeasureOverlayByNumber(measureNumber);
    if (!measureOverlay) {
      return null;
    }

    const actionableTargets = this.getCursorActionableTargetCenters(cursor, container);
    const allTargets = this.getCursorTargetCenters(cursor, container);
    const notes = this.getAllGraphicalNotesForCursor(cursor)
      .map((note) => {
        const placement = this.getRenderedNoteheadPlacement(note, false);

        return {
          halfTone: note.halfTone,
          staffId:
            note.graphicalNote?.sourceNote?.ParentStaff?.idInMusicSheet ?? null,
          actionable: this.isActionableGraphicalPracticeNote(note.graphicalNote),
          soundingDurationWholeNotes: this.getTimedLiveGraphicalNoteDuration(
            note.graphicalNote
          ),
          pitchInfo: note.pitchInfo,
          left: placement ? placement.left + placement.width / 2 : null,
          top: placement ? placement.top + placement.height / 2 : null,
          width: placement ? placement.width : 10,
          height: placement ? placement.height : 8,
        };
      })
      .sort((a, b) => {
        const leftA = Number.isFinite(a.left) ? Number(a.left) : Number.POSITIVE_INFINITY;
        const leftB = Number.isFinite(b.left) ? Number(b.left) : Number.POSITIVE_INFINITY;
        if (leftA !== leftB) {
          return leftA - leftB;
        }

        return a.halfTone - b.halfTone;
      });
    const left =
      allTargets[0] ??
      this.getMeasureTimestampX(currentMeasure, timestamp, measureOverlay);
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
      id: `timed-live-${measureNumber}-${timestamp}-${index}`,
      measureNumber,
      timestamp,
      durationToNext,
      left: Number(left),
      top: measureOverlay.top,
      height: Math.max(measureOverlay.bottom - measureOverlay.top, 12),
      barStartX: measureOverlay.left,
      barEndX: measureOverlay.right,
      systemId: this.getRenderedSystemIdForMeasure(measureNumber),
      actionable,
      actionableTargets,
      allTargets,
      notes,
    };
  }

  private buildTimedLiveCursorSegments(
    events: TimedLiveCursorEvent[],
    startTimestamp: number,
    endTimestamp: number,
    startOverlay: MeasureOverlay,
    endOverlay: MeasureOverlay
  ): TimedLiveCursorSegment[] {
    // Segments describe rendered cursor motion between score timestamps. Wrap
    // segments deliberately include a discontinuity so the cursor reaches the
    // exit barline, teleports to the entry barline, and then continues
    // forward. That teleport is intentional and is what keeps the cursor from
    // visually traversing skipped bars.
    const segments: TimedLiveCursorSegment[] = [];
    const startHeight = Math.max(startOverlay.bottom - startOverlay.top, 12);
    const endHeight = Math.max(endOverlay.bottom - endOverlay.top, 12);

    const firstEvent = events[0] ?? null;
    if (
      firstEvent &&
      firstEvent.timestamp > startTimestamp + Number.EPSILON
    ) {
      segments.push({
        id: `timed-live-segment-start-${startTimestamp}-${firstEvent.timestamp}`,
        startTimestamp,
        endTimestamp: firstEvent.timestamp,
        duration: Math.max(firstEvent.timestamp - startTimestamp, 0),
        startLeft: startOverlay.left,
        startTop: startOverlay.top,
        startHeight,
        endLeft: firstEvent.left,
        endTop: firstEvent.top,
        endHeight: firstEvent.height,
        wrapsSystem: false,
        wrapExitX: null,
        wrapEntryX: null,
      });
    }

    for (let index = 0; index < events.length - 1; index++) {
      const current = events[index];
      const next = events[index + 1];
      const wrapsSystem =
        current.systemId !== null &&
        next.systemId !== null &&
        current.systemId !== next.systemId;

      segments.push({
        id: `timed-live-segment-${current.timestamp}-${next.timestamp}-${index}`,
        startTimestamp: current.timestamp,
        endTimestamp: next.timestamp,
        duration: Math.max(next.timestamp - current.timestamp, 0),
        startLeft: current.left,
        startTop: current.top,
        startHeight: current.height,
        endLeft: next.left,
        endTop: next.top,
        endHeight: next.height,
        wrapsSystem,
        wrapExitX: wrapsSystem ? current.barEndX : null,
        wrapEntryX: wrapsSystem ? next.barStartX : null,
      });
    }

    const lastEvent = events[events.length - 1] ?? null;
    if (lastEvent && endTimestamp > lastEvent.timestamp + Number.EPSILON) {
      segments.push({
        id: `timed-live-segment-end-${lastEvent.timestamp}-${endTimestamp}`,
        startTimestamp: lastEvent.timestamp,
        endTimestamp,
        duration: Math.max(endTimestamp - lastEvent.timestamp, 0),
        startLeft: lastEvent.left,
        startTop: lastEvent.top,
        startHeight: lastEvent.height,
        endLeft: endOverlay.right,
        endTop: endOverlay.top,
        endHeight,
        wrapsSystem: false,
        wrapExitX: null,
        wrapEntryX: null,
      });
    }

    return segments;
  }

  getTimedLiveCursorStyle(): Record<string, string> {
    const cursor = this.timedLiveCursorRenderState;
    if (!cursor || !cursor.visible) {
      return {};
    }

    return {
      left: `${cursor.left}px`,
      top: `${cursor.top}px`,
      height: `${Math.max(cursor.height, 12)}px`,
      transition:
        cursor.transitionMode === 'teleport'
          ? 'none'
          : 'left 90ms linear, top 90ms linear, height 90ms linear',
    };
  }

  getTimedLiveCursorWindowStyle(
    windowRect: TimedLiveCursorWindowRect
  ): Record<string, string> {
    return {
      left: `${windowRect.left}px`,
      top: `${windowRect.top}px`,
      width: `${windowRect.width}px`,
      height: `${windowRect.height}px`,
      '--timed-live-window-color': windowRect.color,
    };
  }

  getTimedLiveCursorThresholdStyle(
    marker: TimedLiveCursorThresholdMarker
  ): Record<string, string> {
    return {
      left: `${marker.left}px`,
      top: `${marker.top}px`,
      height: `${Math.max(marker.height, 12)}px`,
      '--timed-live-threshold-color': marker.color,
    };
  }

  getTimedLiveCursorDebugPanelStyle(): Record<string, string> {
    const position = this.timedLiveCursorDebugPanelPosition;
    if (!position) {
      return {};
    }

    return {
      left: `${position.left}px`,
      top: `${position.top}px`,
      right: 'auto',
    };
  }

  showTimedLiveCursorDebugPanel(): boolean {
    return this.showTimedLiveCursorDebugOverlay && this.fileLoaded;
  }

  showTimedLiveCursorOverlay(): boolean {
    return this.shouldUseTimedLiveCursorVisual();
  }

  getTimedLiveCursorDebugSummaryLines(): string[] {
    const snapshot = this.timedLiveCursorDebugSnapshot;
    if (!snapshot) {
      const timeline = this.timedLiveCursorTimeline;
      if (!timeline) {
        return ['timeline unavailable'];
      }

      return [
        `timeline ${timeline.events.length} events ${timeline.segments.length} segments`,
        `range m${timeline.range.lower}-${timeline.range.upper}`,
        'transport idle',
      ];
    }

    const currentScoreLabel =
      snapshot.scoreTimestamp !== null
        ? this.formatScoreTimestamp(snapshot.scoreTimestamp)
        : 't?';
    const progressLabel =
      snapshot.progressPercent !== null
        ? `${Math.round(snapshot.progressPercent)}%`
        : 'na';
    const windowNoteSummary = Object.entries(snapshot.windowNoteCountByStaff)
      .map(([staff, count]) => `${staff}:${count}`)
      .join(' ');

    return [
      `${this.transportMode ?? 'idle'} loop ${this.loopPass} score ${currentScoreLabel}`,
      `sim ${
        this.timedLiveSimulatedInputEnabled
          ? `${this.timedLiveSimulatedTimingOffsetMs}ms ${this.timedLiveSimulatedPitchOffsetSemitones >= 0 ? '+' : ''}${this.timedLiveSimulatedPitchOffsetSemitones}st`
          : 'off'
      } hits ${this.timedLiveSimulatedFeedbackStats.triggered}/${this.timedLiveSimulatedFeedbackStats.scheduled}`,
      `event ${snapshot.currentEventLabel}`,
      `segment ${snapshot.currentSegmentLabel} prog ${progressLabel}`,
      `window ${this.formatScoreTimestamp(snapshot.windowStartTimestamp)} -> ${this.formatScoreTimestamp(snapshot.windowEndTimestamp)}`,
      `notes ${windowNoteSummary || 'none'} win ${snapshot.windowMs}ms thr e ${snapshot.earlyThresholdMs}ms l ${snapshot.lateThresholdMs}ms`,
      `early ${snapshot.earlyThresholdVisible ? 'on' : 'off'} late ${snapshot.lateThresholdVisible ? 'on' : 'off'} wrap ${snapshot.wrapsSystem ? 'yes' : 'no'}`,
      `sim stats g ${this.timedLiveSimulatedFeedbackStats.onTime} e ${this.timedLiveSimulatedFeedbackStats.early} l ${this.timedLiveSimulatedFeedbackStats.late} m ${this.timedLiveSimulatedFeedbackStats.missed}`,
      `frames ${this.timedLiveCursorDebugSessionTotals.frames} seg ${this.timedLiveCursorDebugSessionTotals.segmentTransitions} wraps ${this.timedLiveCursorDebugSessionTotals.wrapTransitions}`,
      `timeline ${this.timedLiveCursorTimeline?.events.length ?? 0} events ${this.timedLiveCursorTimeline?.segments.length ?? 0} segments`,
    ];
  }

  startTimedLiveCursorDebugPanelDrag(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement | null;
    const panel = handle?.closest('.realtime-debug-panel') as HTMLElement | null;
    if (!panel) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = panel.getBoundingClientRect();
    const containingRect = this.getTimedLiveCursorDebugPanelContainingRect(panel);
    this.timedLiveCursorDebugPanelPosition = {
      left: rect.left - containingRect.left,
      top: rect.top - containingRect.top,
    };
    this.timedLiveCursorDebugPanelDragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    this.timedLiveCursorDebugPanelSize = {
      width: rect.width,
      height: rect.height,
    };

    window.addEventListener(
      'pointermove',
      this.onTimedLiveCursorDebugPanelPointerMove
    );
    window.addEventListener(
      'pointerup',
      this.onTimedLiveCursorDebugPanelPointerUp
    );
  }

  async handleTimedLiveCursorDebugPanelWheel(event: WheelEvent): Promise<void> {
    const target = event.target as EventTarget | null;
    if (target instanceof HTMLInputElement && target.type === 'number') {
      target.blur();
    }

    const panel = event.currentTarget as HTMLElement | null;
    if (panel && this.canElementScrollForWheelDelta(panel, event)) {
      return;
    }

    const scrollElement = await this.content?.getScrollElement?.();
    if (!scrollElement) {
      return;
    }

    event.preventDefault();
    scrollElement.scrollTop += this.getWheelDeltaPixels(
      event,
      scrollElement.clientHeight
    );
  }

  private syncTimedLiveCursorDebugLoop(): void {
    this.updateLegacyPlayCursorDebugVisibility();
    if (this.shouldRunTimedLiveCursorDebugLoop()) {
      this.startTimedLiveCursorDebugLoop();
      return;
    }

    this.stopTimedLiveCursorDebugLoop(true);
  }

  private shouldRunTimedLiveCursorDebugLoop(): boolean {
    return (
      this.running &&
      this.isTimedTransportMode() &&
      !!this.timedLiveCursorTimeline
    );
  }

  private shouldUseTimedLiveCursorVisual(): boolean {
    return this.running && this.isTimedTransportMode() && !!this.timedLiveCursorTimeline;
  }

  private showTimedLiveCursorAtStartTimestamp(): void {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline || !this.isTimedTransportMode()) {
      return;
    }

    // Pre-roll contract for timed playback:
    // while the count-in is active, the timed-live cursor must already be
    // visible at the first playable timestamp, but it must not advance yet.
    // Importantly, this is the first rendered musical timestamp, not the raw
    // left barline of the measure. Parking on the barline sends the cursor
    // through the clef/key-signature area and also makes beat one late when
    // the first note starts exactly at the measure timestamp.
    //
    // We therefore resolve the cursor's rendered position at the start
    // timestamp itself instead of seeding from `timeline.startLeft`.
    const startRenderState =
      this.resolveTimedLiveCursorRenderAtTimestamp(timeline.startTimestamp);
    if (!startRenderState) {
      return;
    }

    this.timedLiveCursorRenderState = {
      left: startRenderState.left,
      top: startRenderState.top,
      height: startRenderState.height,
      visible: true,
      scoreTimestamp: timeline.startTimestamp,
      transitionMode: 'teleport',
    };
  }

  private startTimedLiveCursorDebugLoop(): void {
    if (this.timedLiveCursorAnimationFrame !== null) {
      return;
    }

    const tick = () => {
      this.timedLiveCursorAnimationFrame = null;
      if (!this.shouldRunTimedLiveCursorDebugLoop()) {
        this.stopTimedLiveCursorDebugLoop(true);
        return;
      }

      this.updateTimedLiveCursorDebugOverlay();
      this.timedLiveCursorAnimationFrame = window.requestAnimationFrame(tick);
    };

    this.updateTimedLiveCursorDebugOverlay();
    this.timedLiveCursorAnimationFrame = window.requestAnimationFrame(tick);
  }

  private stopTimedLiveCursorDebugLoop(reset: boolean): void {
    if (this.timedLiveCursorAnimationFrame !== null) {
      window.cancelAnimationFrame(this.timedLiveCursorAnimationFrame);
      this.timedLiveCursorAnimationFrame = null;
    }

    if (reset) {
      this.clearTimedLiveCursorDebugState();
    }
  }

  private resetTimedLiveCursorDebugSession(): void {
    this.timedLiveCursorDebugSessionTotals = {
      frames: 0,
      segmentTransitions: 0,
      wrapTransitions: 0,
    };
    this.timedLiveCursorLastSegmentId = null;
    this.timedLiveCursorDebugSnapshot = null;
    this.timedLiveCursorThresholdMarkers = [];
    this.timedLiveCursorWindowRects = [];
  }

  private readonly onTimedLiveCursorDebugPanelPointerMove = (
    event: PointerEvent
  ): void => {
    if (!this.timedLiveCursorDebugPanelDragOffset) {
      return;
    }

    event.preventDefault();
    const containingRect = this.getTimedLiveCursorDebugPanelContainingRect();
    const width = this.timedLiveCursorDebugPanelSize?.width ?? 320;
    const height = this.timedLiveCursorDebugPanelSize?.height ?? 180;
    const minInset = 12;
    const left = Math.min(
      Math.max(
        event.clientX -
          containingRect.left -
          this.timedLiveCursorDebugPanelDragOffset.x,
        minInset
      ),
      Math.max(containingRect.width - width - minInset, minInset)
    );
    const top = Math.min(
      Math.max(
        event.clientY -
          containingRect.top -
          this.timedLiveCursorDebugPanelDragOffset.y,
        minInset
      ),
      Math.max(containingRect.height - height - minInset, minInset)
    );

    this.timedLiveCursorDebugPanelPosition = { left, top };
  };

  private readonly onTimedLiveCursorDebugPanelPointerUp = (): void => {
    this.timedLiveCursorDebugPanelDragOffset = null;
    window.removeEventListener(
      'pointermove',
      this.onTimedLiveCursorDebugPanelPointerMove
    );
    window.removeEventListener(
      'pointerup',
      this.onTimedLiveCursorDebugPanelPointerUp
    );
  };

  private canElementScrollForWheelDelta(
    element: HTMLElement,
    event: WheelEvent
  ): boolean {
    if (element.scrollHeight <= element.clientHeight + 1) {
      return false;
    }

    const deltaY = this.getWheelDeltaPixels(event, element.clientHeight);
    if (Math.abs(deltaY) <= Number.EPSILON) {
      return false;
    }

    if (deltaY < 0) {
      return element.scrollTop > 0;
    }

    return element.scrollTop + element.clientHeight < element.scrollHeight - 1;
  }

  private getWheelDeltaPixels(event: WheelEvent, pageHeight: number): number {
    switch (event.deltaMode) {
      case WheelEvent.DOM_DELTA_LINE:
        return event.deltaY * 16;
      case WheelEvent.DOM_DELTA_PAGE:
        return event.deltaY * Math.max(pageHeight, 1);
      default:
        return event.deltaY;
    }
  }

  private clampTimedLiveCursorDebugPanelPosition(): void {
    const position = this.timedLiveCursorDebugPanelPosition;
    if (!position) {
      return;
    }

    const containingRect = this.getTimedLiveCursorDebugPanelContainingRect();
    const width = this.timedLiveCursorDebugPanelSize?.width ?? 320;
    const height = this.timedLiveCursorDebugPanelSize?.height ?? 180;
    const minInset = 12;

    this.timedLiveCursorDebugPanelPosition = {
      left: Math.min(
        Math.max(position.left, minInset),
        Math.max(containingRect.width - width - minInset, minInset)
      ),
      top: Math.min(
        Math.max(position.top, minInset),
        Math.max(containingRect.height - height - minInset, minInset)
      ),
    };
  }

  private getTimedLiveCursorDebugPanelContainingRect(
    panel?: HTMLElement | null
  ): DOMRect {
    const referencePanel =
      panel ??
      (document.querySelector('.realtime-debug-panel--bottom') as HTMLElement | null);
    const containingElement =
      (referencePanel?.offsetParent as HTMLElement | null) ??
      document.getElementById('play-content');

    return (
      containingElement?.getBoundingClientRect?.() ??
      new DOMRect(0, 0, window.innerWidth, window.innerHeight)
    );
  }

  private clearTimedLiveCursorDebugState(): void {
    this.timedLiveCursorLastSegmentId = null;
    this.timedLiveCursorThresholdMarkers = [];
    this.timedLiveCursorWindowRects = [];
    this.timedLiveCursorDebugSnapshot = null;
    if (this.timedLiveCursorRenderState) {
      this.timedLiveCursorRenderState = {
        ...this.timedLiveCursorRenderState,
        visible: false,
        scoreTimestamp: null,
        transitionMode: 'smooth',
      };
    }
  }

  private updateLegacyPlayCursorDebugVisibility(): void {
    const cursorElement = this.getPlayCursorElement();
    if (!cursorElement) {
      return;
    }

    cursorElement.style.opacity =
      this.shouldUseTimedLiveSimulatedFeedback() ||
      this.shouldUseTimedLiveCursorVisual()
        ? '0'
        : '';
  }

  private shouldUseTimedLiveSimulatedFeedback(): boolean {
    return (
      this.showTimedLiveCursorDebugOverlay &&
      this.listenMode &&
      this.timedLiveSimulatedInputEnabled
    );
  }

  private syncTimedLiveSimulationControls(): void {
    this.timedLiveSimulatedTimingOffsetMs =
      this.normalizeTimedLiveSimulatedTimingOffsetMs(
        this.timedLiveSimulatedTimingOffsetMs
      );
    this.timedLiveSimulatedPitchOffsetSemitones =
      this.normalizeTimedLiveSimulatedPitchOffsetSemitones(
        this.timedLiveSimulatedPitchOffsetSemitones
      );
    this.timedLiveSimulationEarlyThresholdMs =
      this.normalizeTimedLiveSimulationThresholdMs(
        this.timedLiveSimulationEarlyThresholdMs
      );
    this.timedLiveSimulationLateThresholdMs =
      this.normalizeTimedLiveSimulationThresholdMs(
        this.timedLiveSimulationLateThresholdMs
      );
  }

  private normalizeTimedLiveSimulatedTimingOffsetMs(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.min(
      Math.max(Math.round(value), -PlayPageComponent.MAX_TIMED_LIVE_SIMULATION_TIMING_OFFSET_MS),
      PlayPageComponent.MAX_TIMED_LIVE_SIMULATION_TIMING_OFFSET_MS
    );
  }

  private normalizeTimedLiveSimulatedPitchOffsetSemitones(
    value: number
  ): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.min(
      Math.max(
        Math.round(value),
        -PlayPageComponent.MAX_TIMED_LIVE_SIMULATION_PITCH_OFFSET_SEMITONES
      ),
      PlayPageComponent.MAX_TIMED_LIVE_SIMULATION_PITCH_OFFSET_SEMITONES
    );
  }

  private normalizeTimedLiveSimulationThresholdMs(value: number): number {
    if (!Number.isFinite(value)) {
      return PlayPageComponent.DEFAULT_TIMED_LIVE_SIMULATION_THRESHOLD_MS;
    }

    return Math.min(
      Math.max(Math.round(value), 0),
      PlayPageComponent.MAX_TIMED_LIVE_SIMULATION_THRESHOLD_MS
    );
  }

  private getTimedLiveSimulationEarlyThresholdMs(): number {
    return this.normalizeTimedLiveSimulationThresholdMs(
      this.timedLiveSimulationEarlyThresholdMs
    );
  }

  private getTimedLiveSimulationLateThresholdMs(): number {
    return this.normalizeTimedLiveSimulationThresholdMs(
      this.timedLiveSimulationLateThresholdMs
    );
  }

  private getTimedLiveSimulatedPitchOffsetSemitones(): number {
    return this.normalizeTimedLiveSimulatedPitchOffsetSemitones(
      this.timedLiveSimulatedPitchOffsetSemitones
    );
  }

  private shouldSuppressListenAutoplayFeedbackForName(name: string): boolean {
    return (
      this.shouldUseTimedLiveSimulatedFeedback() &&
      this.mapNotesAutoPressed.has(name)
    );
  }

  private enqueueTimedLiveSimulatedPendingNote(
    pendingNote: TimedLiveSimulatedPendingNote
  ): void {
    const key = pendingNote.playedHalfTone.toFixed();
    const pendingNotes = this.timedLiveSimulatedPendingNotes.get(key) ?? [];
    pendingNotes.push(pendingNote);
    this.timedLiveSimulatedPendingNotes.set(key, pendingNotes);
  }

  private consumeTimedLiveSimulatedPendingNote(
    name: string
  ): TimedLiveSimulatedPendingNote | null {
    const pendingNotes = this.timedLiveSimulatedPendingNotes.get(name);
    if (!pendingNotes || pendingNotes.length === 0) {
      return null;
    }

    const pendingNote = pendingNotes.shift() ?? null;
    if (pendingNotes.length === 0) {
      this.timedLiveSimulatedPendingNotes.delete(name);
    }

    return pendingNote;
  }

  private incrementTimedLiveSimulatedHeldNote(name: string): void {
    this.timedLiveSimulatedHeldNotes.set(
      name,
      (this.timedLiveSimulatedHeldNotes.get(name) ?? 0) + 1
    );
  }

  private releaseTimedLiveSimulatedHeldNote(name: string): number {
    const count = (this.timedLiveSimulatedHeldNotes.get(name) ?? 0) - 1;
    if (count > 0) {
      this.timedLiveSimulatedHeldNotes.set(name, count);
      return count;
    }

    this.timedLiveSimulatedHeldNotes.delete(name);
    return 0;
  }

  private hasTimedLiveSimulatedFeedbackActivity(): boolean {
    return (
      this.timedLiveSimulatedScheduleTimeouts.length > 0 ||
      this.timedLiveSimulatedFeedbackTimeouts.length > 0 ||
      this.timedLiveSimulatedPendingNotes.size > 0 ||
      this.timedLiveSimulatedHeldNotes.size > 0 ||
      this.timedLiveSimulatedOutputTokens.size > 0
    );
  }

  private hasActiveTimedLiveSimulatedOutput(): boolean {
    return (
      this.timedLiveSimulatedHeldNotes.size > 0 ||
      this.timedLiveSimulatedOutputTokens.size > 0
    );
  }

  private clearTimedLiveSimulatedPendingState(): void {
    this.timedLiveSimulatedPendingNotes.clear();
    this.timedLiveSimulatedProcessedEventNotes.clear();
    this.timedLiveRealtimeMatchedEventNotes.clear();
    this.timedLiveSimulatedHeldNotes.clear();
    this.timedLiveSimulatedOutputTokens.clear();
    this.timedLiveSimulatedOutputInstrumentIds.clear();
    this.timedLiveSimulatedOutputRouteKeys.clear();
  }

  private clearTimedLiveSimulatedReflectedState(noteNames: string[]): void {
    noteNames.forEach((name) => {
      this.mapNotesAutoPressed.delete(name);
      this.autoPressedMidiInstrumentIds.delete(name);
      this.notesService.release(name);
      this.correctlyHeldPracticeKeys.delete(name);
    });
  }

  private commitTimedLiveSimulatedFeedbackNote(
    pendingNote: TimedLiveSimulatedPendingNote,
    renderNotehead: boolean = true
  ): void {
    this.timedLiveSimulatedFeedbackStats.triggered++;
    if (pendingNote.timingClass === 'correct') {
      this.timedLiveSimulatedFeedbackStats.onTime++;
    } else if (pendingNote.timingClass === 'early') {
      this.timedLiveSimulatedFeedbackStats.early++;
    } else if (pendingNote.timingClass === 'late') {
      this.timedLiveSimulatedFeedbackStats.late++;
    } else {
      this.timedLiveSimulatedFeedbackStats.missed++;
    }

    if (!renderNotehead) {
      return;
    }

    // The rendered green cursor is the placement source of truth for live
    // playback feedback. Misses always follow it. Early/late notes default to
    // the same cursor anchor, with a debug toggle to compare target-note
    // anchoring without changing the default behavior.
    const cursorLeft = this.getTimedLiveStableFeedbackCursorLeft(
      pendingNote.hitTimestamp,
      pendingNote.note.staffId
    );
    const placement = this.getTimedLiveSimulatedFeedbackPlacement(
      pendingNote.note,
      pendingNote.timingClass,
      cursorLeft
    );

    if (!placement) {
      return;
    }

    const id = `timed-feedback-${pendingNote.loopPass}-${pendingNote.event.timestamp}-${pendingNote.note.staffId ?? 'all'}-${pendingNote.playedHalfTone}-${pendingNote.timingClass}-${pendingNote.index}`;
    const className =
      pendingNote.timingClass === 'correct'
        ? 'feedback-notehead feedback-notehead--correct'
        : pendingNote.timingClass === 'early'
          ? 'feedback-notehead feedback-notehead--early'
          : pendingNote.timingClass === 'late'
            ? 'feedback-notehead feedback-notehead--late'
            : 'feedback-notehead feedback-notehead--miss';

    this.renderFeedbackNotehead(
      this.timingFeedbackNoteheadElements,
      className,
      id,
      placement
    );
  }

  private resetTimedLiveSimulatedFeedbackStats(): void {
    this.timedLiveSimulatedFeedbackStats = {
      scheduled: 0,
      triggered: 0,
      onTime: 0,
      early: 0,
      late: 0,
      missed: 0,
    };
  }

  private clearTimedLiveSimulatedScheduleTimeouts(): void {
    this.timedLiveSimulatedScheduleTimeouts.forEach((timeout) =>
      clearTimeout(timeout)
    );
    this.timedLiveSimulatedScheduleTimeouts = [];
  }

  private clearTimedLiveSimulatedFeedbackTimeouts(): void {
    this.clearTimedLiveSimulatedScheduleTimeouts();
    this.timedLiveSimulatedFeedbackTimeouts.forEach((timeout) =>
      clearTimeout(timeout)
    );
    this.timedLiveSimulatedFeedbackTimeouts = [];
    this.clearTimedLiveSimulatedPendingState();
  }

  private stopTimedLiveSimulatedFeedbackPlayback(
    handoffToListenPlayback: boolean = false
  ): void {
    const activeOutputPitches = Array.from(this.timedLiveSimulatedOutputTokens.keys());
    const activeOutputInstrumentIds = new Map(
      this.timedLiveSimulatedOutputInstrumentIds
    );
    const activeOutputRouteKeys = new Map(this.timedLiveSimulatedOutputRouteKeys);
    const reflectedNoteNames = Array.from(this.timedLiveSimulatedHeldNotes.keys());

    this.clearTimedLiveSimulatedFeedbackTimeouts();
    this.clearTimedLiveSimulatedReflectedState(reflectedNoteNames);

    if (activeOutputPitches.length === 0) {
      if (reflectedNoteNames.length > 0 && this.pianoKeyboard) {
        this.pianoKeyboard.updateNotesStatus();
      }
      if (
        handoffToListenPlayback &&
        this.running &&
        this.listenMode &&
        reflectedNoteNames.length > 0
      ) {
        const handoffAudioTime = this.getScheduledAudioTime();
        this.appendCursorWrapDebugEvent(
          `sim handoff ${handoffAudioTime.toFixed(3)}`
        );
        this.playNote(handoffAudioTime);
      }
      return;
    }

    const handoffAudioTime = handoffToListenPlayback
      ? this.getScheduledAudioTime()
      : undefined;
    const releaseAudioTime =
      typeof handoffAudioTime === 'number' && Number.isFinite(handoffAudioTime)
        ? this.getRetriggerReleaseAudioTime(handoffAudioTime) ?? handoffAudioTime
        : this.getScheduledAudioTime();

    activeOutputPitches.forEach((pitch) => {
      this.sendOutputNoteOff(
        pitch,
        releaseAudioTime,
        activeOutputInstrumentIds.get(pitch) ?? null,
        activeOutputRouteKeys.get(pitch) ?? null
      );
    });

    if (reflectedNoteNames.length > 0 && this.pianoKeyboard) {
      this.pianoKeyboard.updateNotesStatus();
    }

    if (handoffToListenPlayback && this.running && this.listenMode) {
      this.appendCursorWrapDebugEvent(`sim handoff ${handoffAudioTime?.toFixed(3)}`);
      this.playNote(handoffAudioTime);
    }
  }

  private scheduleTimedLiveSimulatedCallback(
    callback: () => void,
    delayMs: number,
    type: 'schedule' | 'playback' = 'playback'
  ): void {
    const timeout = setTimeout(callback, Math.max(delayMs, 0));
    if (type === 'schedule') {
      this.timedLiveSimulatedScheduleTimeouts.push(timeout);
      return;
    }

    this.timedLiveSimulatedFeedbackTimeouts.push(timeout);
  }

  private scheduleTimedLiveSimulatedStateNoteOn(
    pitch: number,
    delayMs: number
  ): void {
    this.scheduleTimedLiveSimulatedCallback(() => {
      this.applyTimedLiveSimulatedStateNoteOn(pitch);
    }, delayMs);
  }

  private scheduleTimedLiveSimulatedStateNoteOff(
    pitch: number,
    delayMs: number
  ): void {
    this.scheduleTimedLiveSimulatedCallback(() => {
      this.applyTimedLiveSimulatedStateNoteOff(pitch);
    }, delayMs);
  }

  private applyTimedLiveSimulatedStateNoteOn(pitch: number): void {
    if (!this.running || !this.shouldUseTimedLiveSimulatedFeedback()) {
      return;
    }

    const key = (pitch - 12).toFixed();
    this.mapNotesAutoPressed.set(key, 1);
    this.autoPressedMidiInstrumentIds.set(key, null);
    this.handleTimedLiveSimulatedStateNoteOn(pitch);
  }

  private applyTimedLiveSimulatedStateNoteOff(pitch: number): void {
    const name = (pitch - 12).toFixed();
    this.mapNotesAutoPressed.delete(name);
    this.autoPressedMidiInstrumentIds.delete(name);
    this.releaseTimedLiveSimulatedHeldNote(name);
    if (this.pianoKeyboard) {
      this.pianoKeyboard.updateNotesStatus();
    }
  }

  private handleTimedLiveSimulatedStateNoteOn(pitch: number): void {
    const halfTone = pitch - 12;
    const name = halfTone.toFixed();
    const pendingNote = this.consumeTimedLiveSimulatedPendingNote(name);
    if (!pendingNote) {
      if (this.pianoKeyboard) {
        this.pianoKeyboard.updateNotesStatus();
      }
      return;
    }

    const matchesCurrentStep = this.getCurrentRequiredPressKeys().has(name);
    this.commitTimedLiveSimulatedFeedbackNote(pendingNote, matchesCurrentStep);

    if (!matchesCurrentStep && this.checkboxFeedback) {
      this.renderTimedLiveSimulatedIncorrectFeedbackNote(pendingNote);
    }

    if (this.markTimedLiveSimulatedEventNoteProcessed(pendingNote)) {
      this.advanceTimedLiveSimulatedPlaybackStep();
    }

    if (this.pianoKeyboard) {
      this.pianoKeyboard.updateNotesStatus();
    }
  }

  private renderTimedLiveSimulatedIncorrectFeedbackNote(
    pendingNote: TimedLiveSimulatedPendingNote
  ): void {
    const placement = this.getTimedLiveSimulatedIncorrectPlacement(pendingNote);
    if (!placement) {
      return;
    }

    const id = `sim-wrong-${pendingNote.loopPass}-${pendingNote.event.timestamp}-${pendingNote.playedHalfTone}-${pendingNote.index}`;
    this.renderFeedbackNotehead(
      this.incorrectNoteheadElements,
      'feedback-notehead feedback-notehead--incorrect',
      id,
      placement
    );
  }

  private getTimedLiveSimulatedIncorrectPlacement(
    pendingNote: TimedLiveSimulatedPendingNote
  ): FeedbackNoteheadPlacement | null {
    const noteCenterX =
      this.getTimedLiveStableFeedbackCursorLeft(
        pendingNote.hitTimestamp,
        pendingNote.note.staffId
      ) ?? pendingNote.note.left;
    const noteCenterY = pendingNote.note.top;
    if (!Number.isFinite(noteCenterX) || !Number.isFinite(noteCenterY)) {
      return null;
    }

    const width = Math.max(pendingNote.note.width, 10);
    const height = Math.max(pendingNote.note.height, 8);
    return this.buildIncorrectFeedbackPlacement({
      playedHalfTone: pendingNote.playedHalfTone,
      anchorHalfTone: pendingNote.note.halfTone,
      anchorPitchInfo: pendingNote.note.pitchInfo,
      anchorCenterY: Number(noteCenterY),
      width,
      height,
      centerX: Number(noteCenterX),
      stepHeight: Math.max(height * 0.55, 4),
      measureNumber: pendingNote.event.measureNumber,
      scoreTimestamp: pendingNote.event.timestamp,
      staffId: pendingNote.note.staffId,
    });
  }

  private markTimedLiveSimulatedEventNoteProcessed(
    pendingNote: TimedLiveSimulatedPendingNote
  ): boolean {
    const progressKey = `${pendingNote.loopPass}:${pendingNote.event.id}`;
    const processedIndexes =
      this.timedLiveSimulatedProcessedEventNotes.get(progressKey) ?? new Set<number>();
    processedIndexes.add(pendingNote.index);
    this.timedLiveSimulatedProcessedEventNotes.set(progressKey, processedIndexes);

    const expectedNotes = this.getTimedLiveSimulatedFeedbackNotesForEvent(
      pendingNote.event
    );
    return processedIndexes.size >= expectedNotes.length;
  }

  private advanceTimedLiveSimulatedPlaybackStep(): void {
    if (
      !this.running ||
      !this.listenMode ||
      !this.shouldUseTimedLiveSimulatedFeedback()
    ) {
      return;
    }

    this.osmdCursorPlayMoveNext(true);
  }

  private getTimedLiveSimulatedAudioScheduleLeadMs(delayMs: number): number {
    const scheduleLeadMs = PlayPageComponent.AUDIO_SCHEDULE_AHEAD_SEC * 1000;
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      return 0;
    }

    return Math.min(Math.max(delayMs - 1, 0), scheduleLeadMs);
  }

  private scheduleTimedLiveSimulatedFeedback(
    fromCurrentPosition: boolean = false
  ): void {
    this.clearTimedLiveSimulatedScheduleTimeouts();
    if (fromCurrentPosition) {
      this.timedLiveSimulatedFeedbackStats = {
        ...this.timedLiveSimulatedFeedbackStats,
        scheduled: this.timedLiveSimulatedFeedbackStats.triggered,
      };
    }
    if (!this.shouldUseTimedLiveSimulatedFeedback()) {
      return;
    }

    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      return;
    }

    const scheduleAnchorTimestamp = fromCurrentPosition
      ? this.getTimedLiveCursorScoreTimestamp() ?? this.playbackStartScoreTimestamp
      : this.playbackStartScoreTimestamp;
    if (!Number.isFinite(scheduleAnchorTimestamp)) {
      return;
    }

    const loopPass = this.loopPass;
    const offsetMs = this.timedLiveSimulatedTimingOffsetMs;
    const offsetWholeNotes = this.getPlaybackWholeNotesFromMs(offsetMs);

    if (!fromCurrentPosition) {
      this.resetTimedLiveSimulatedFeedbackStats();
    }

    timeline.events.forEach((event) => {
      if (
        fromCurrentPosition &&
        event.timestamp <= scheduleAnchorTimestamp + 0.000001
      ) {
        return;
      }

      const notes = this.getTimedLiveSimulatedFeedbackNotesForEvent(event);
      notes.forEach((note, index) => {
        const rawDelayMs =
          this.getPlaybackDelayMs(event.timestamp - scheduleAnchorTimestamp) +
          offsetMs;
        if (rawDelayMs < -150) {
          return;
        }

        const onsetDelayMs = Math.max(rawDelayMs, 0);
        const audioLeadMs =
          this.getTimedLiveSimulatedAudioScheduleLeadMs(onsetDelayMs);
        const audioScheduleDelayMs = onsetDelayMs - audioLeadMs;

        this.scheduleTimedLiveSimulatedCallback(() => {
          if (
            !this.running ||
            !this.shouldUseTimedLiveSimulatedFeedback() ||
            this.loopPass !== loopPass
          ) {
            return;
          }

          if (note.actionable) {
            this.triggerTimedLiveSimulatedFeedbackNote(
              event,
              note,
              offsetWholeNotes,
              offsetMs,
              index,
              rawDelayMs,
              audioLeadMs
            );
            return;
          }

          this.triggerTimedLiveSimulatedTieFeedbackNote(
            event,
            note,
            offsetWholeNotes,
            offsetMs,
            index,
            audioLeadMs
          );
        }, audioScheduleDelayMs, 'schedule');
        this.timedLiveSimulatedFeedbackStats.scheduled++;
      });
    });
  }

  private getTimedLiveSimulatedFeedbackNotesForEvent(
    event: TimedLiveCursorEvent
  ): TimedLiveCursorNote[] {
    return event.notes;
  }

  private triggerTimedLiveSimulatedFeedbackNote(
    event: TimedLiveCursorEvent,
    note: TimedLiveCursorNote,
    offsetWholeNotes: number,
    offsetMs: number,
    index: number,
    rawDelayMs: number = 0,
    stateDelayMs: number = 0
  ): void {
    const timingClass = this.classifyTimedLiveSimulatedFeedback(offsetMs);
    const playedHalfTone =
      note.halfTone + this.getTimedLiveSimulatedPitchOffsetSemitones();
    const pitch = playedHalfTone + 12;
    if (Number.isFinite(pitch) && pitch >= 0 && pitch <= 127) {
      const hitTimestamp = event.timestamp + offsetWholeNotes;
      const name = playedHalfTone.toFixed();
      this.enqueueTimedLiveSimulatedPendingNote({
        event,
        note,
        timingClass,
        hitTimestamp,
        playedHalfTone,
        loopPass: this.loopPass,
        index,
      });
      this.incrementTimedLiveSimulatedHeldNote(name);
      const cueDurationMs = this.getTimedLiveSimulatedCueDurationMs(
        note,
        rawDelayMs
      );
      const audioTime = this.getTimedLiveSimulatedAudioTime(hitTimestamp);
      const midiInstrumentId = this.getMidiInstrumentIdForStaffId(note.staffId);
      this.playTimedLiveSimulatedOutputNote(
        pitch,
        60,
        cueDurationMs,
        cueDurationMs + Math.max(stateDelayMs, 0),
        audioTime,
        stateDelayMs,
        midiInstrumentId
      );
    }
  }

  private triggerTimedLiveSimulatedTieFeedbackNote(
    event: TimedLiveCursorEvent,
    note: TimedLiveCursorNote,
    offsetWholeNotes: number,
    offsetMs: number,
    index: number,
    onsetDelayMs: number = 0
  ): void {
    const pendingNote: TimedLiveSimulatedPendingNote = {
      event,
      note,
      timingClass: this.classifyTimedLiveSimulatedFeedback(offsetMs),
      hitTimestamp: event.timestamp + offsetWholeNotes,
      playedHalfTone:
        note.halfTone + this.getTimedLiveSimulatedPitchOffsetSemitones(),
      loopPass: this.loopPass,
      index,
    };

    this.scheduleTimedLiveSimulatedCallback(() => {
      if (
        !this.running ||
        !this.shouldUseTimedLiveSimulatedFeedback() ||
        this.loopPass !== pendingNote.loopPass
      ) {
        return;
      }

      this.commitTimedLiveSimulatedFeedbackNote(pendingNote, false);
      if (
        this.checkboxFeedback &&
        pendingNote.playedHalfTone !== pendingNote.note.halfTone
      ) {
        this.renderTimedLiveSimulatedIncorrectFeedbackNote(pendingNote);
      }

      if (this.markTimedLiveSimulatedEventNoteProcessed(pendingNote)) {
        this.advanceTimedLiveSimulatedPlaybackStep();
      }
    }, onsetDelayMs);
  }

  private playTimedLiveSimulatedOutputNote(
    pitch: number,
    velocity: number,
    durationMs: number,
    releaseDelayMs: number,
    audioTime?: number,
    stateDelayMs: number = 0,
    midiInstrumentId: number | null = null
  ): void {
    const previousToken = this.timedLiveSimulatedOutputTokens.get(pitch);
    if (previousToken !== undefined) {
      this.sendOutputNoteOff(
        pitch,
        this.getRetriggerReleaseAudioTime(audioTime) ?? audioTime,
        this.timedLiveSimulatedOutputInstrumentIds.get(pitch) ?? null,
        this.timedLiveSimulatedOutputRouteKeys.get(pitch) ?? null
      );
      this.scheduleTimedLiveSimulatedStateNoteOff(pitch, stateDelayMs);
    }

    const token = ++this.timedLiveSimulatedOutputTokenSeed;
    this.timedLiveSimulatedOutputTokens.set(pitch, token);
    this.timedLiveSimulatedOutputInstrumentIds.set(pitch, midiInstrumentId);
    const routeKey = this.sendOutputNoteOn(
      pitch,
      velocity,
      audioTime,
      midiInstrumentId
    );
    this.timedLiveSimulatedOutputRouteKeys.set(pitch, routeKey);
    this.scheduleTimedLiveSimulatedStateNoteOn(pitch, stateDelayMs);

    this.scheduleTimedLiveSimulatedCallback(() => {
      if (
        !this.running ||
        !this.shouldUseTimedLiveSimulatedFeedback() ||
        this.timedLiveSimulatedOutputTokens.get(pitch) !== token
      ) {
        return;
      }

      this.timedLiveSimulatedOutputTokens.delete(pitch);
      this.timedLiveSimulatedOutputInstrumentIds.delete(pitch);
      const activeRouteKey =
        this.timedLiveSimulatedOutputRouteKeys.get(pitch) ?? null;
      this.timedLiveSimulatedOutputRouteKeys.delete(pitch);
      const releaseAudioTime =
        typeof audioTime === 'number' && Number.isFinite(audioTime)
          ? audioTime + durationMs / 1000
          : undefined;
      this.sendOutputNoteOff(
        pitch,
        releaseAudioTime,
        midiInstrumentId,
        activeRouteKey
      );
      this.applyTimedLiveSimulatedStateNoteOff(pitch);
    }, releaseDelayMs);
  }

  private getTimedLiveSimulatedAudioTime(
    scoreTimestamp: number
  ): number | undefined {
    const playbackStartAudioTimeSec = this.playbackStartAudioTimeSec;
    if (
      typeof playbackStartAudioTimeSec !== 'number' ||
      !Number.isFinite(playbackStartAudioTimeSec) ||
      !Number.isFinite(this.playbackStartScoreTimestamp)
    ) {
      return undefined;
    }

    const offsetMs = this.getPlaybackDelayMs(
      scoreTimestamp - this.playbackStartScoreTimestamp
    );
    if (!Number.isFinite(offsetMs)) {
      return undefined;
    }

    return playbackStartAudioTimeSec + offsetMs / 1000;
  }

  private getTimedLiveSimulatedCueDurationMs(
    note: TimedLiveCursorNote,
    rawDelayMs: number = 0
  ): number {
    const eventDurationMs = this.getPlaybackDelayMs(
      Math.max(note.soundingDurationWholeNotes, 1 / 32)
    );
    return Math.max(40, eventDurationMs + Math.min(rawDelayMs, 0));
  }

  private classifyTimedLiveSimulatedFeedback(
    offsetMs: number
  ): 'correct' | 'early' | 'late' | 'miss' {
    const earlyThresholdMs = this.getTimedLiveSimulationEarlyThresholdMs();
    const lateThresholdMs = this.getTimedLiveSimulationLateThresholdMs();
    if (offsetMs >= -earlyThresholdMs && offsetMs <= lateThresholdMs) {
      return 'correct';
    }

    const matchWindowMs = this.getTimedLiveSimulationMatchWindowMs();
    if (offsetMs < -matchWindowMs || offsetMs > matchWindowMs) {
      return 'miss';
    }

    return offsetMs < 0 ? 'early' : 'late';
  }

  private getTimedLiveSimulationMatchWindowMs(): number {
    return Math.max(
      this.getPlaybackDelayMs(PlayPageComponent.TIMED_LIVE_DEBUG_WINDOW_WHOLE_NOTES),
      this.getTimedLiveSimulationEarlyThresholdMs(),
      this.getTimedLiveSimulationLateThresholdMs()
    );
  }

  private shouldUseTimedLiveRealtimeClassification(): boolean {
    return (
      this.realtimeMode &&
      !!this.timedLiveCursorTimeline &&
      !this.shouldUseTimedLiveSimulatedFeedback()
    );
  }

  private getTimedLiveSelectedEventNotes(
    event: TimedLiveCursorEvent
  ): Array<{ note: TimedLiveCursorNote; index: number }> {
    const practiceSelection = this.getPracticeStaffSelection();
    return event.notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => {
        if (!note.actionable) {
          return false;
        }

        return note.staffId === null || practiceSelection[note.staffId];
      });
  }

  private getTimedLiveRealtimeMatchKey(event: TimedLiveCursorEvent): string {
    return `${this.loopPass}:${event.id}`;
  }

  private isTimedLiveRealtimeNoteMatched(
    event: TimedLiveCursorEvent,
    index: number
  ): boolean {
    const matchedIndexes =
      this.timedLiveRealtimeMatchedEventNotes.get(
        this.getTimedLiveRealtimeMatchKey(event)
      ) ?? new Set<number>();
    return matchedIndexes.has(index);
  }

  private markTimedLiveRealtimeNoteMatched(
    event: TimedLiveCursorEvent,
    index: number
  ): void {
    const key = this.getTimedLiveRealtimeMatchKey(event);
    const matchedIndexes =
      this.timedLiveRealtimeMatchedEventNotes.get(key) ?? new Set<number>();
    matchedIndexes.add(index);
    this.timedLiveRealtimeMatchedEventNotes.set(key, matchedIndexes);
  }

  private findTimedLiveRealtimeMatch(
    playedHalfTone: number,
    scoreTimestamp: number
  ): TimedLiveMatchedRealtimeNote | null {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      return null;
    }

    const matchWindowMs = this.getTimedLiveSimulationMatchWindowMs();
    let bestMatch: TimedLiveMatchedRealtimeNote | null = null;

    timeline.events.forEach((event) => {
      const offsetMs = this.getPlaybackSignedDurationMs(
        scoreTimestamp - event.timestamp
      );
      if (Math.abs(offsetMs) > matchWindowMs) {
        return;
      }

      this.getTimedLiveSelectedEventNotes(event).forEach(({ note, index }) => {
        if (note.halfTone !== playedHalfTone) {
          return;
        }
        if (this.isTimedLiveRealtimeNoteMatched(event, index)) {
          return;
        }

        const candidate: TimedLiveMatchedRealtimeNote = {
          event,
          note,
          index,
          timingClass: this.classifyTimedLiveSimulatedFeedback(offsetMs),
          offsetMs,
        };

        if (
          !bestMatch ||
          Math.abs(candidate.offsetMs) < Math.abs(bestMatch.offsetMs)
        ) {
          bestMatch = candidate;
        }
      });
    });

    return bestMatch;
  }

  private buildTimedLiveRealtimePendingNote(
    match: TimedLiveMatchedRealtimeNote,
    playedHalfTone: number,
    scoreTimestamp: number
  ): TimedLiveSimulatedPendingNote {
    return {
      event: match.event,
      note: match.note,
      timingClass: match.timingClass,
      hitTimestamp: scoreTimestamp,
      playedHalfTone,
      loopPass: this.loopPass,
      index: match.index,
    };
  }

  private handleTimedLiveRealtimeNoteOn(
    playedHalfTone: number,
    scoreTimestamp: number
  ): TimedLiveMatchedRealtimeNote | null {
    const match = this.findTimedLiveRealtimeMatch(playedHalfTone, scoreTimestamp);
    if (!match) {
      return null;
    }

    this.markTimedLiveRealtimeNoteMatched(match.event, match.index);
    this.commitTimedLiveSimulatedFeedbackNote(
      this.buildTimedLiveRealtimePendingNote(match, playedHalfTone, scoreTimestamp),
      true
    );
    return match;
  }

  private getPlaybackWholeNotesFromMs(durationMs: number): number {
    const wholeNoteMs = this.getPlaybackDelayMs(1);
    if (!Number.isFinite(durationMs) || !Number.isFinite(wholeNoteMs) || wholeNoteMs <= 0) {
      return 0;
    }

    return durationMs / wholeNoteMs;
  }

  private getPlaybackSignedDurationMs(durationInWholeNotes: number): number {
    if (!Number.isFinite(durationInWholeNotes)) {
      return 0;
    }

    return (durationInWholeNotes * 4 * 60000) / this.getEffectiveTempoBPM();
  }

  private getTimedLiveSimulatedFeedbackPlacement(
    note: TimedLiveCursorNote,
    timingClass: 'correct' | 'early' | 'late' | 'miss',
    cursorLeft: number | null
  ): { left: number; top: number; width: number; height: number } | null {
    if (!Number.isFinite(note.left) || !Number.isFinite(note.top)) {
      return null;
    }

    const width = Math.max(note.width, 10);
    const height = Math.max(note.height, 8);
    const leftCenter = this.shouldAnchorTimedLiveTimingFeedbackToCursor(
      timingClass,
      cursorLeft
    )
      ? Number(cursorLeft)
      : Number(note.left);

    return {
      left: leftCenter - width / 2,
      top: Number(note.top) - height / 2,
      width,
      height,
    };
  }

  private shouldAnchorTimedLiveTimingFeedbackToCursor(
    timingClass: TimedLiveSimulatedFeedbackTimingClass,
    cursorLeft: number | null
  ): cursorLeft is number {
    if (!Number.isFinite(cursorLeft)) {
      return false;
    }

    if (timingClass === 'correct') {
      return false;
    }

    if (timingClass === 'miss') {
      return true;
    }

    return this.timedLiveEarlyLateFeedbackUsesCursorAnchor;
  }

  private updateTimedLiveCursorDebugOverlay(): void {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      this.clearTimedLiveCursorDebugState();
      return;
    }

    const scoreTimestamp = this.getTimedLiveCursorScoreTimestamp();
    if (scoreTimestamp === null) {
      this.clearTimedLiveCursorDebugState();
      return;
    }

    const cursorState = this.resolveTimedLiveCursorRenderAtTimestamp(scoreTimestamp);
    if (!cursorState) {
      this.clearTimedLiveCursorDebugState();
      return;
    }

    const previousRenderState = this.timedLiveCursorRenderState;
    this.timedLiveCursorRenderState = {
      left: cursorState.left,
      top: cursorState.top,
      height: cursorState.height,
      visible: true,
      scoreTimestamp,
      transitionMode: this.resolveTimedLiveCursorTransitionMode(
        previousRenderState,
        cursorState,
        scoreTimestamp
      ),
    };

    if (!this.showTimedLiveCursorDebugOverlay) {
      this.timedLiveCursorThresholdMarkers = [];
      this.timedLiveCursorWindowRects = [];
      this.timedLiveCursorDebugSnapshot = null;
      return;
    }

    this.timedLiveCursorDebugSessionTotals.frames++;
    if (
      cursorState.segment &&
      cursorState.segment.id !== this.timedLiveCursorLastSegmentId
    ) {
      this.timedLiveCursorDebugSessionTotals.segmentTransitions++;
      if (cursorState.segment.wrapsSystem) {
        this.timedLiveCursorDebugSessionTotals.wrapTransitions++;
      }
      this.timedLiveCursorLastSegmentId = cursorState.segment.id;
    }

    const windowWholeNotes =
      PlayPageComponent.TIMED_LIVE_DEBUG_WINDOW_WHOLE_NOTES;
    const earlyThresholdMs = this.getTimedLiveSimulationEarlyThresholdMs();
    const lateThresholdMs = this.getTimedLiveSimulationLateThresholdMs();
    const earlyThresholdWholeNotes = this.getPlaybackWholeNotesFromMs(
      earlyThresholdMs
    );
    const lateThresholdWholeNotes = this.getPlaybackWholeNotesFromMs(
      lateThresholdMs
    );
    const windowMs = Math.round(this.getPlaybackDelayMs(windowWholeNotes));
    const windowStartTimestamp = Math.max(
      timeline.startTimestamp,
      scoreTimestamp - windowWholeNotes
    );
    const windowEndTimestamp = Math.min(
      timeline.endTimestamp,
      scoreTimestamp + windowWholeNotes
    );
    const thresholdStartTimestamp = Math.max(
      timeline.startTimestamp,
      scoreTimestamp - lateThresholdWholeNotes
    );
    const thresholdEndTimestamp = Math.min(
      timeline.endTimestamp,
      scoreTimestamp + earlyThresholdWholeNotes
    );

    this.timedLiveCursorThresholdMarkers = this.buildTimedLiveCursorThresholdMarkers(
      thresholdStartTimestamp,
      thresholdEndTimestamp
    );
    this.timedLiveCursorWindowRects = this.buildTimedLiveCursorWindowRects(
      windowStartTimestamp,
      windowEndTimestamp
    );
    this.timedLiveCursorDebugSnapshot = {
      scoreTimestamp,
      currentEventId: cursorState.event?.id ?? null,
      currentEventLabel: this.formatTimedLiveCursorEventLabel(cursorState.event),
      currentSegmentId: cursorState.segment?.id ?? null,
      currentSegmentLabel: this.formatTimedLiveCursorSegmentLabel(
        cursorState.segment
      ),
      progressPercent:
        cursorState.progress !== null
          ? Math.max(0, Math.min(100, cursorState.progress * 100))
          : null,
      wrapsSystem: !!cursorState.segment?.wrapsSystem,
      windowStartTimestamp,
      windowEndTimestamp,
      windowMs,
      windowNoteCountByStaff: this.summarizeTimedLiveCursorWindowNotes(
        windowStartTimestamp,
        windowEndTimestamp
      ),
      earlyThresholdMs,
      lateThresholdMs,
      earlyThresholdVisible: this.timedLiveCursorThresholdMarkers.some(
        (marker) => marker.id === 'timed-live-threshold-early'
      ),
      lateThresholdVisible: this.timedLiveCursorThresholdMarkers.some(
        (marker) => marker.id === 'timed-live-threshold-late'
      ),
    };
  }

  private buildTimedLiveCursorThresholdMarkers(
    windowStartTimestamp: number,
    windowEndTimestamp: number
  ): TimedLiveCursorThresholdMarker[] {
    const markers: TimedLiveCursorThresholdMarker[] = [];
    const lateState = this.resolveTimedLiveCursorRenderAtTimestamp(
      windowStartTimestamp
    );
    const earlyState = this.resolveTimedLiveCursorRenderAtTimestamp(
      windowEndTimestamp
    );

    if (lateState) {
      markers.push({
        id: 'timed-live-threshold-late',
        label: 'late',
        left: lateState.left,
        top: lateState.top,
        height: lateState.height,
        color: '#7c3aed',
      });
    }

    if (earlyState) {
      markers.push({
        id: 'timed-live-threshold-early',
        label: 'early',
        left: earlyState.left,
        top: earlyState.top,
        height: earlyState.height,
        color: '#f97316',
      });
    }

    return markers;
  }

  private buildTimedLiveCursorWindowRects(
    windowStartTimestamp: number,
    windowEndTimestamp: number
  ): TimedLiveCursorWindowRect[] {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      return [];
    }

    const notesByStaffAndSystem = new Map<
      string,
      {
        staffId: number | null;
        systemId: number | null;
        notes: TimedLiveCursorNote[];
      }
    >();
    timeline.events
      .filter(
        (event) =>
          event.timestamp >= windowStartTimestamp - Number.EPSILON &&
          event.timestamp <= windowEndTimestamp + Number.EPSILON
      )
      .forEach((event) => {
        const preferredNotes = event.notes.filter((note) => note.actionable);
        const notes = preferredNotes.length > 0 ? preferredNotes : event.notes;
        notes.forEach((note) => {
          if (!Number.isFinite(note.left) || !Number.isFinite(note.top)) {
            return;
          }

          const groupKey = `${note.staffId ?? 'all'}:${event.systemId ?? 'na'}`;
          const existing = notesByStaffAndSystem.get(groupKey) ?? {
            staffId: note.staffId,
            systemId: event.systemId ?? null,
            notes: [],
          };
          existing.notes.push(note);
          notesByStaffAndSystem.set(groupKey, existing);
        });
      });

    return Array.from(notesByStaffAndSystem.values())
      .map(({ staffId, systemId, notes }) => {
        if (!notes.length) {
          return null;
        }

        const lefts = notes
          .map((note) => note.left)
          .filter((value): value is number => Number.isFinite(value));
        const tops = notes
          .map((note) => note.top)
          .filter((value): value is number => Number.isFinite(value));
        if (!lefts.length || !tops.length) {
          return null;
        }

        const paddingX = 18;
        const paddingY = 18;
        const left = Math.min(...lefts) - paddingX;
        const right = Math.max(...lefts) + paddingX;
        const top = Math.min(...tops) - paddingY;
        const bottom = Math.max(...tops) + paddingY;

        return {
          id: `timed-live-window-${staffId ?? 'all'}-${systemId ?? 'na'}`,
          staffId,
          systemId,
          label: `${this.getTimedLiveCursorStaffLabel(staffId)} ${notes.length}`,
          noteCount: notes.length,
          left,
          top,
          width: Math.max(right - left, 24),
          height: Math.max(bottom - top, 24),
          color: this.getTimedLiveCursorStaffColor(staffId),
        };
      })
      .filter((windowRect): windowRect is TimedLiveCursorWindowRect => !!windowRect);
  }

  private summarizeTimedLiveCursorWindowNotes(
    windowStartTimestamp: number,
    windowEndTimestamp: number
  ): Record<string, number> {
    const summary: Record<string, number> = {};
    this.buildTimedLiveCursorWindowRects(windowStartTimestamp, windowEndTimestamp).forEach(
      (windowRect) => {
        const label = this.getTimedLiveCursorStaffLabel(windowRect.staffId);
        summary[label] = (summary[label] ?? 0) + windowRect.noteCount;
      }
    );
    return summary;
  }

  private getTimedLiveCursorStaffLabel(staffId: number | null): string {
    if (staffId === 0) {
      return 'RH';
    }
    if (staffId === 1) {
      return 'LH';
    }
    if (Number.isFinite(staffId)) {
      return `S${Number(staffId) + 1}`;
    }

    return 'All';
  }

  private getTimedLiveCursorStaffColor(staffId: number | null): string {
    if (staffId === 0) {
      return '#0ea5e9';
    }
    if (staffId === 1) {
      return '#ec4899';
    }

    return '#64748b';
  }

  private formatTimedLiveCursorEventLabel(
    event: TimedLiveCursorEvent | null
  ): string {
    if (!event) {
      return 'none';
    }

    return `m${event.measureNumber} ${this.formatScoreTimestamp(event.timestamp)}`;
  }

  private formatTimedLiveCursorSegmentLabel(
    segment: TimedLiveCursorSegment | null
  ): string {
    if (!segment) {
      return 'none';
    }

    return `${this.formatScoreTimestamp(segment.startTimestamp)} -> ${this.formatScoreTimestamp(segment.endTimestamp)}`;
  }

  private getTimedLiveCursorScoreTimestamp(): number | null {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline || !this.running || !this.isTimedTransportMode()) {
      return null;
    }

    if (!Number.isFinite(this.playbackStartScoreTimestamp) || this.timePlayStart <= 0) {
      return null;
    }

    const startAudioTimeSec = this.playbackStartAudioTimeSec;
    if (typeof startAudioTimeSec !== 'number' || !Number.isFinite(startAudioTimeSec)) {
      return null;
    }

    const wholeNotesPerSecond = this.getEffectiveTempoBPM() / 240;
    const elapsedSec = Math.max(toneNow() - startAudioTimeSec, 0);
    const estimatedTimestamp =
      this.playbackStartScoreTimestamp + elapsedSec * wholeNotesPerSecond;

    return Math.min(
      Math.max(estimatedTimestamp, timeline.startTimestamp),
      timeline.endTimestamp
    );
  }

  private resolveTimedLiveCursorRenderAtTimestamp(timestamp: number): {
    left: number;
    top: number;
    height: number;
    progress: number | null;
    segment: TimedLiveCursorSegment | null;
    event: TimedLiveCursorEvent | null;
  } | null {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      return null;
    }

    const clampedTimestamp = Math.min(
      Math.max(timestamp, timeline.startTimestamp),
      timeline.endTimestamp
    );
    const segment = this.findTimedLiveCursorSegmentAtTimestamp(clampedTimestamp);
    if (!segment) {
      return {
        left: timeline.endLeft,
        top: timeline.endTop,
        height: timeline.endHeight,
        progress: null,
        segment: null,
        event: timeline.events[timeline.events.length - 1] ?? null,
      };
    }

    const duration = Math.max(segment.duration, Number.EPSILON);
    const progress =
      duration > Number.EPSILON
        ? Math.min(
            Math.max((clampedTimestamp - segment.startTimestamp) / duration, 0),
            1
          )
        : 1;

    const height = this.interpolateLinear(
      segment.startHeight,
      segment.endHeight,
      progress
    );
    const top = this.interpolateLinear(segment.startTop, segment.endTop, progress);

    if (!segment.wrapsSystem) {
      return {
        left: this.interpolateLinear(segment.startLeft, segment.endLeft, progress),
        top,
        height,
        progress,
        segment,
        event: this.getTimedLiveCursorEventAtOrBefore(clampedTimestamp),
      };
    }

    // Wrap segments are piecewise by design: move to the exit barline,
    // teleport to the entry barline, then continue forward. We never draw a
    // continuous backward animation through intervening bars.
    const wrapExitX = segment.wrapExitX ?? segment.startLeft;
    const wrapEntryX = segment.wrapEntryX ?? segment.endLeft;
    const firstDistance = Math.max(wrapExitX - segment.startLeft, 0);
    const secondDistance = Math.max(segment.endLeft - wrapEntryX, 0);
    const totalDistance = firstDistance + secondDistance;

    if (totalDistance <= Number.EPSILON) {
      return {
        left: segment.endLeft,
        top: segment.endTop,
        height: segment.endHeight,
        progress,
        segment,
        event: this.getTimedLiveCursorEventAtOrBefore(clampedTimestamp),
      };
    }

    const travelled = totalDistance * progress;
    if (travelled <= firstDistance || secondDistance <= Number.EPSILON) {
      return {
        left: segment.startLeft + travelled,
        top: segment.startTop,
        height: segment.startHeight,
        progress,
        segment,
        event: this.getTimedLiveCursorEventAtOrBefore(clampedTimestamp),
      };
    }

    return {
      left: wrapEntryX + (travelled - firstDistance),
      top: segment.endTop,
      height: segment.endHeight,
      progress,
      segment,
      event: this.getTimedLiveCursorEventAtOrBefore(clampedTimestamp),
    };
  }

  private resolveTimedLiveCursorTransitionMode(
    previousRenderState: TimedLiveCursorRenderState | null,
    cursorState: {
      left: number;
      top: number;
      height: number;
      progress: number | null;
      segment: TimedLiveCursorSegment | null;
      event: TimedLiveCursorEvent | null;
    },
    scoreTimestamp: number
  ): 'smooth' | 'teleport' {
    // Live cursor behavior must be identical in timed mode regardless of
    // whether notes are driven by autoplay or by human input. We therefore
    // decide whether the rendered cursor should animate or teleport solely from
    // the timeline geometry and the previously rendered cursor state.
    const previousTimestamp = previousRenderState?.scoreTimestamp;
    if (
      previousTimestamp !== null &&
      previousTimestamp !== undefined &&
      scoreTimestamp + Number.EPSILON < previousTimestamp
    ) {
      return 'teleport';
    }

    // Wrap segments model a "portal" at the end of the current bar/system: the
    // cursor moves forward normally until it reaches that portal, then it
    // reappears instantly at the corresponding position in the destination
    // bar/system. Any rendered left/top discontinuity across that boundary must
    // therefore be an instantaneous jump with CSS transitions disabled.
    if (
      previousRenderState?.visible &&
      (cursorState.left < previousRenderState.left - 8 ||
        Math.abs(cursorState.top - previousRenderState.top) > 8)
    ) {
      return 'teleport';
    }

    return 'smooth';
  }

  private findTimedLiveCursorSegmentAtTimestamp(
    timestamp: number
  ): TimedLiveCursorSegment | null {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      return null;
    }

    return (
      timeline.segments.find(
        (segment) =>
          segment.startTimestamp - Number.EPSILON <= timestamp &&
          timestamp <= segment.endTimestamp + Number.EPSILON
      ) ?? null
    );
  }

  private getTimedLiveCursorEventAtOrBefore(
    timestamp: number
  ): TimedLiveCursorEvent | null {
    const timeline = this.timedLiveCursorTimeline;
    if (!timeline) {
      return null;
    }

    let result: TimedLiveCursorEvent | null = null;
    timeline.events.forEach((event) => {
      if (event.timestamp <= timestamp + Number.EPSILON) {
        result = event;
      }
    });
    return result;
  }

  private interpolateLinear(start: number, end: number, progress: number): number {
    return start + (end - start) * progress;
  }

  private getMeasureOverlayByNumber(measureNumber: number): MeasureOverlay | null {
    return (
      this.measureOverlays.find((measure) => measure.measureNumber === measureNumber) ??
      null
    );
  }

  private getSourceMeasureByNumber(measureNumber: number): any {
    return (
      this.openSheetMusicDisplay?.Sheet?.SourceMeasures?.find(
        (measure: any, index: number) =>
          (measure.MeasureNumber ?? index + 1) === measureNumber
      ) ?? null
    );
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
    const graphicalNotes = this.getAllGraphicalNotesForCursor(cursor)
      .filter(
        (note) =>
          !actionableOnly ||
          this.isActionableGraphicalPracticeNote(note.graphicalNote)
      )
      .map((note) => note.graphicalNote);

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

  private getTimedLiveGraphicalNoteDuration(graphicalNote: any): number {
    const sourceNote = graphicalNote?.sourceNote;
    if (!sourceNote) {
      return 0;
    }

    const tieNotes = Array.isArray(sourceNote.NoteTie?.notes)
      ? sourceNote.NoteTie.notes
      : null;
    if (
      tieNotes &&
      tieNotes.length > 0 &&
      sourceNote === sourceNote.NoteTie?.StartNote
    ) {
      return tieNotes.reduce((total: number, tieNote: any) => {
        const length = tieNote?.Length?.RealValue;
        return total + (Number.isFinite(length) ? Number(length) : 0);
      }, 0);
    }

    const length = sourceNote.Length?.RealValue;
    return Number.isFinite(length) ? Number(length) : 0;
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
    return this.isTimedTransportMode();
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

  private getCurrentScheduledPlaybackAudioTime(): number {
    const minimumScheduledAudioTime = toneNow() + 0.001;
    const scheduledAudioTimeSec = this.playbackClock.scheduledAudioTimeSec;

    if (
      typeof scheduledAudioTimeSec === 'number' &&
      Number.isFinite(scheduledAudioTimeSec)
    ) {
      if (
        scheduledAudioTimeSec < minimumScheduledAudioTime
      ) {
        const catchupSec =
          minimumScheduledAudioTime - scheduledAudioTimeSec;
        if (catchupSec >= 0.002) {
          this.appendCursorWrapDebugEvent(
            `audio catchup ${Math.round(catchupSec * 1000)}ms`
          );
        }
        this.playbackClock.scheduledAudioTimeSec = minimumScheduledAudioTime;
        return minimumScheduledAudioTime;
      }

      return scheduledAudioTimeSec;
    }

    this.playbackClock.scheduledAudioTimeSec = minimumScheduledAudioTime;
    return minimumScheduledAudioTime;
  }

  private advanceScheduledPlaybackAudioTime(durationMs: number): void {
    const currentAudioTime = this.getCurrentScheduledPlaybackAudioTime();
    const durationSec =
      Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0;
    this.playbackClock.scheduledAudioTimeSec = currentAudioTime + durationSec;
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
      this.releaseMonitoredMidiInputNotes();
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
          if (this.checkboxMidiInputAudio) {
            this.monitorMidiInputNoteOn(note.dataByte1, note.dataByte2 ?? 60);
          }
          this.keyNoteOn(Date.now(), note.dataByte1);
        } else if (note.type === 'noteOff') {
          this.monitorMidiInputNoteOff(note.dataByte1);
          this.keyNoteOff(Date.now(), note.dataByte1);
        }
      }
    );

    this.midiHandlers.push(dvc, cmd);

    const { devices } = await CapacitorMuseTrainerMidi.listDevices();
    this.midiDeviceHandler(devices);
  }

  // Press note on Ouput MIDI Device
  keyPressNote(
    pitch: number,
    velocity: number,
    audioTime?: number,
    midiInstrumentId: number | null = null
  ): void {
    this.keyPressNoteInternal(pitch, velocity, audioTime, true, midiInstrumentId);
  }

  private sendOutputNoteOn(
    pitch: number,
    velocity: number,
    audioTime?: number,
    midiInstrumentId: number | null = null
  ): string | null {
    this.appendScheduledAudioDebugEvent('on', pitch, audioTime);

    if (this.midiAvailable && this.checkboxMidiOut) {
      CapacitorMuseTrainerMidi.sendCommand({
        command: [0x90, pitch, velocity],
        timestamp: performance.now(),
      }).catch((e) => console.error(e));
      return null;
    }

    return this.sendSoftwareNoteOn(pitch, velocity, audioTime, midiInstrumentId);
  }

  keyPressNoteInternal(
    pitch: number,
    velocity: number,
    audioTime?: number,
    reflectInput: boolean = true,
    midiInstrumentId: number | null = null
  ): void {
    const key = (pitch - 12).toFixed();
    this.mapNotesAutoPressed.set(key, 1);
    this.autoPressedMidiInstrumentIds.set(key, midiInstrumentId);
    if (reflectInput) {
      this.timeouts.push(
        setTimeout(() => {
          this.keyNoteOn(Date.now() - this.timePlayStart, pitch);
        }, 0)
      );
    }

    const routeKey = this.sendOutputNoteOn(
      pitch,
      velocity,
      audioTime,
      midiInstrumentId
    );
    this.autoPressedSoftwareRouteKeys.set(key, routeKey);
  }

  // Release note on Ouput MIDI Device
  keyReleaseNote(
    pitch: number,
    audioTime?: number,
    midiInstrumentId: number | null = null
  ): void {
    this.keyReleaseNoteInternal(pitch, audioTime, true, midiInstrumentId);
  }

  private sendOutputNoteOff(
    pitch: number,
    audioTime?: number,
    midiInstrumentId: number | null = null,
    routeKey?: string | null
  ): void {
    this.appendScheduledAudioDebugEvent('off', pitch, audioTime);

    if (this.midiAvailable && this.checkboxMidiOut) {
      CapacitorMuseTrainerMidi.sendCommand({
        command: [0x80, pitch, 0x00],
        timestamp: performance.now(),
      }).catch((e) => console.error(e));
      return;
    }

    this.sendSoftwareNoteOff(pitch, audioTime, midiInstrumentId, routeKey);
  }

  keyReleaseNoteInternal(
    pitch: number,
    audioTime?: number,
    reflectInput: boolean = true,
    midiInstrumentId: number | null = null
  ): void {
    const key = (pitch - 12).toFixed();
    this.mapNotesAutoPressed.delete(key);
    this.autoPressedMidiInstrumentIds.delete(key);
    const routeKey = this.autoPressedSoftwareRouteKeys.get(key) ?? null;
    this.autoPressedSoftwareRouteKeys.delete(key);
    if (reflectInput) {
      this.timeouts.push(
        setTimeout(() => {
          this.keyNoteOff(Date.now() - this.timePlayStart, pitch);
        }, 0)
      );
    }

    this.sendOutputNoteOff(pitch, audioTime, midiInstrumentId, routeKey);
  }

  // Input note pressed
  keyNoteOn(time: number, pitch: number): void {
    if (this.shouldIgnoreUserInputUntilPlaybackStart()) {
      return;
    }

    const halbTone = pitch - 12;
    const name = halbTone.toFixed();
    const timedLiveRealtimeClassification =
      this.shouldUseTimedLiveRealtimeClassification();
    const scoreTimestamp = timedLiveRealtimeClassification
      ? this.getTimedLiveCursorScoreTimestamp()
      : null;

    const pitchLabel = this.noteKeyToLabel(name);
    const requiredPressKeys = this.getCurrentRequiredPressKeys();
    const acceptedLateRealtimeNote = this.isAcceptedLateRealtimeNote(name);
    const suppressAutoplayFeedback =
      this.shouldSuppressListenAutoplayFeedbackForName(name);
    const matchesCurrentStep = requiredPressKeys.has(name);
    this.updateRealtimeDebugWindow();
    this.debugRealtimeStats.playedTotal++;

    if (!acceptedLateRealtimeNote) {
      this.notesService.press(name);
    }

    if (timedLiveRealtimeClassification && scoreTimestamp !== null) {
      const match = this.handleTimedLiveRealtimeNoteOn(halbTone, scoreTimestamp);
      if (match) {
        if (!this.realtimeCurrentStepMatchedKeys.has(name) && matchesCurrentStep) {
          this.realtimeCurrentStepMatchedKeys.add(name);
        }

        const timingClass = match.timingClass;
        if (timingClass === 'correct') {
          this.debugRealtimeStats.acceptedOnTime++;
          this.debugRealtimeStats.lastResult = 'on-time';
        } else if (timingClass === 'early') {
          this.debugRealtimeStats.early++;
          this.debugRealtimeStats.lastResult = 'early';
        } else if (timingClass === 'late') {
          this.debugRealtimeStats.acceptedLate++;
          this.debugRealtimeStats.lastResult = 'late';
        } else {
          this.debugRealtimeStats.rejected++;
          this.debugRealtimeStats.lastResult = 'miss';
        }
        this.debugRealtimeStats.lastPitch = pitchLabel;
        this.appendRealtimeDebugEvent(
          `${pitchLabel} ${this.debugRealtimeStats.lastResult}`
        );
        this.updateRealtimeDebugWindow();
      } else if (
        !matchesCurrentStep &&
        this.isPracticing() &&
        (this.checkboxFeedback || this.realtimeMode)
      ) {
        this.debugRealtimeStats.rejected++;
        this.debugRealtimeStats.lastPitch = pitchLabel;
        this.debugRealtimeStats.lastResult = 'rejected';
        this.appendRealtimeDebugEvent(`${pitchLabel} rejected`);
        this.updateRealtimeDebugWindow();
        this.markIncorrectInputNote(halbTone);
      }
    } else {
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
        if (!suppressAutoplayFeedback) {
          this.markCurrentNoteCorrect(name);
          this.debugRealtimeStats.acceptedOnTime++;
          this.debugRealtimeStats.lastPitch = pitchLabel;
          this.debugRealtimeStats.lastResult = 'hit current';
          this.appendRealtimeDebugEvent(`${pitchLabel} hit`);
          this.updateRealtimeDebugWindow();
        }
      }
    }

    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    if (!acceptedLateRealtimeNote && this.notesService.isRequiredNotesPressed()) {
      if (!suppressAutoplayFeedback) {
        this.debugRealtimeStats.lastPitch = pitchLabel;
        this.debugRealtimeStats.lastResult = 'step satisfied';
        this.appendRealtimeDebugEvent(`${pitchLabel} step satisfied`);
        this.updateRealtimeDebugWindow();
        this.markCurrentNotesCorrect();
      }
      if (this.realtimeMode) {
        this.currentStepSatisfied = true;
      } else {
        this.osmdCursorPlayMoveNext(suppressAutoplayFeedback);
      }
    }
  }

  // Input note released
  keyNoteOff(time: number, pitch: number): void {
    if (this.shouldIgnoreUserInputUntilPlaybackStart()) {
      return;
    }

    const halbTone = pitch - 12;
    const name = halbTone.toFixed();

    const suppressAutoplayFeedback =
      this.shouldSuppressListenAutoplayFeedbackForName(name);
    this.updateRealtimeDebugWindow();
    if (this.shouldUseTimedLiveRealtimeClassification()) {
      this.notesService.release(name);
      this.correctlyHeldPracticeKeys.delete(name);
      if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
      return;
    }

    if (this.isAcceptedLateRealtimeNote(name)) {
      return;
    }
    this.notesService.release(name);
    this.correctlyHeldPracticeKeys.delete(name);

    if (this.pianoKeyboard) this.pianoKeyboard.updateNotesStatus();
    if (!this.realtimeMode && this.notesService.isRequiredNotesPressed()) {
      if (!suppressAutoplayFeedback) {
        this.markCurrentNotesCorrect();
      }
      this.osmdCursorPlayMoveNext(suppressAutoplayFeedback);
    }
  }

  private isRealtimePlaybackOnly(): boolean {
    return this.staffIdList.length > 0
      ? this.staffIdList.every((id) => this.staffIdEnabled[id])
      : true;
  }

  private isInputCountInActive(): boolean {
    return this.running && this.startFlashCount > 0;
  }

  private shouldIgnoreUserInputUntilPlaybackStart(): boolean {
    return !this.running || this.isInputCountInActive() || this.timePlayStart <= 0;
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
          () => this.restartLoopPlayback()
        );
        if (!startedLoopWrapAnimation) {
          this.restartLoopPlayback();
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

    this.rebuildCurrentPlaybackStepState();
    this.updatePlayCursorVisualAlignment();
    this.playComputerNotes(audioTime);
  }

  private playComputerNotes(audioTime?: number): void {
    if (!this.realtimeMode) {
      return;
    }

    this.computerNotesService.playRequiredNotes(
      (note, velocity, noteObj) => {
        const key = (note - 12).toFixed();
        this.computerPressedNotes.set(key, 1);
        this.computerNotesService.press(key);
        this.keyPressNoteInternal(
          note,
          velocity,
          audioTime,
          false,
          this.getMidiInstrumentIdForNoteObject(noteObj)
        );
      },
      (note, noteObj, retrigger) => {
        const key = (note - 12).toFixed();
        this.computerPressedNotes.delete(key);
        this.computerNotesService.release(key);
        const midiInstrumentId = this.getMidiInstrumentIdForNoteObject(noteObj);
        this.keyReleaseNoteInternal(
          note,
          retrigger ? this.getRetriggerReleaseAudioTime(audioTime) : audioTime,
          false,
          midiInstrumentId
        );
      }
    );
  }

  private releaseComputerPressedNotes(): void {
    for (const [key] of this.computerPressedNotes) {
      this.computerNotesService.release(key);
      const midiInstrumentId =
        this.getMidiInstrumentIdForNoteObject(
          this.computerNotesService.getMapRequired().get(key)
        ) ??
        this.getMidiInstrumentIdForNoteObject(
          this.computerNotesService.getMapPrevRequired().get(key)
        );
      this.keyReleaseNoteInternal(
        parseInt(key) + 12,
        undefined,
        false,
        midiInstrumentId
      );
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
