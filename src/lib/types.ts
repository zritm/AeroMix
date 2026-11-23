export type SectionType = "intro" | "buildup" | "main" | "breakdown" | "outro";

export interface Section {
  type: SectionType;
  startBar: number;
  endBar: number;
  energy: number;
  vocal: boolean;
  dry: boolean;
}

export interface HotCue {
  name: string;
  bar: number;
}

/** in/out = null → брать автоматически из секций */
export interface Cues {
  in: number | null;
  out: number | null;
  hot: HotCue[];
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  filename: string;
  format: string;
  sizeBytes: number;
  duration: number;
  bpm: number;
  bpmConfidence: number;
  key: string;
  camelot: string;
  keyConfidence: number;
  energy: number;
  hasVocals: boolean;
  vocalConfidence: number;
  density: number;
  dryness: number;
  genre: string;
  tags: string[];
  playlist: string;
  priority: number;
  noStretch: boolean;
  firstDownbeat: number;
  gridConfidence: number;
  totalBars: number;
  rmsDb: number;
  sections: Section[];
  cues: Cues;
  waveform: number[];
  edits: string[];
  createdAt?: string;
  updatedAt?: string;
}

export type BlockType = "warmup" | "main" | "cooldown";

export type TransitionType =
  | "drum_to_drum"
  | "bass_swap"
  | "eq_blend"
  | "loop_roll"
  | "cut"
  | "filter"
  | "fade";

export interface MixSettings {
  profile: string;
  template: string;
  warmupMin: number;
  mainMin: number;
  cooldownMin: number;
  bpmStart: number;
  bpmTarget: number;
  bpmEnd: number;
  curveShape: "linear" | "ease";
  maxStretch: number; // %
  energyStart: number;
  energyMain: number;
  energyEnd: number;
  transBars: { warmup: number; main: number; cooldown: number };
  allowRepeat: boolean;
  avoidVocalClash: boolean;
  strictHarmonic: boolean;
  pins: { start: string[]; middle: string[]; end: string[] };
  pairs: { from: string; to: string }[];
  excluded: string[];
}

export type IssueLevel = "info" | "warn" | "error";
export interface Issue {
  level: IssueLevel;
  text: string;
  item?: number;
}

export interface Transition {
  type: TransitionType;
  bars: number;
  manual: boolean;
  relation: string;
  why: string[];
  issues: Issue[];
}

export interface PlanItem {
  uid: string;
  trackId: string;
  block: BlockType;
  inBar: number;
  outBar: number;
  manualPoints: boolean;
  startBeat: number;
  endBeat: number;
  trans: Transition | null;
  why: string[];
  issues: Issue[];
  stretchMin: number;
  stretchMax: number;
}

export interface Bounds {
  warmEnd: number;
  coolStart: number;
  end: number;
}

export interface Report {
  score: number;
  issues: Issue[];
  totalSec: number;
  warmupSec: number;
  mainSec: number;
  cooldownSec: number;
  maxStretchPct: number;
  keyClashes: number;
  vocalConflicts: number;
  energyJumps: number;
  trackCount: number;
}

export interface Plan {
  items: PlanItem[];
  bounds: Bounds;
  report: Report;
}
