export type Assignment = {
  id: string;
  subject: string;
  teacher: string;
  className: string;
  day: string;
  slot: number;
  room?: string;
  locked?: boolean;
};

export type TimeSlot = { slot: number; time: string };
export type StageDailySlots = Record<string, number>;
export type StageStudyDays = Record<string, string[]>;
export type TeacherGapLimits = Record<string, Record<string, number>>;
export type TeacherSlotLimits = Record<string, Record<string, Record<number, number>>>;

export type SubjectRequirement = {
  id?: string;
  className: string;
  subject: string;
  teacher: string;
  weeklyLessons: number;
  preferredDays?: string[];
  preferredSlots?: number[];
  minGapBetweenSameSubject?: number;
  maxPerDay?: number;
  consecutive?: boolean;
  room?: string;
};

export type TeacherAvailability = {
  teacher: string;
  unavailable?: Array<{ day: string; slot: number }>;
  preferred?: Array<{ day: string; slot: number; weight?: number }>;
};

export type SolverWeights = {
  internalClassGap: number;
  teacherGap: number;
  sameSubjectSameDay: number;
  subjectSpacing: number;
  dailyLoadImbalance: number;
  preferenceMiss: number;
  teacherLoadImbalance: number;
  roomChange: number;
  schoolSlotCoverage: number;
  schoolFrontLoad: number;
  classDailyBalance: number;
};

export type SchedulingConfig = {
  days: string[];
  timeSlots: TimeSlot[];
  classes: string[];
  stageDailySlots: StageDailySlots;
  stageStudyDays: StageStudyDays;
  teacherGapLimits: TeacherGapLimits;
  teacherSlotLimits: TeacherSlotLimits;
  teacherAvailability?: Record<string, TeacherAvailability>;
  roomAvailability?: Record<string, Array<{ day: string; slot: number }>>;
  subjectTargets?: Record<string, Record<string, number>>;
  requirements?: SubjectRequirement[];
  weights?: Partial<SolverWeights>;
  maxNodes?: number;
  timeLimitMs?: number;
  lockedAssignmentIds?: string[];
};

export type ConstraintViolation = {
  code: string;
  severity: "hard" | "soft";
  assignmentId?: string;
  message: string;
  day?: string;
  slot?: number;
  penalty: number;
};

export type ScheduleMetrics = {
  hardViolations: number;
  softPenalty: number;
  internalClassGaps: number;
  teacherGaps: number;
  sameSubjectSameDay: number;
  subjectSpacingViolations: number;
  dailyLoadImbalance: number;
  teacherLoadImbalance: number;
  preferenceMisses: number;
  schoolSlotCoverage: number;
  schoolFrontLoad: number;
  classDailyBalance: number;
  placed: number;
  unplaced: number;
};

export type SolverResult = {
  assignments: Assignment[];
  unplaced: Assignment[];
  violations: ConstraintViolation[];
  metrics: ScheduleMetrics;
  complete: boolean;
  exploredNodes: number;
  durationMs: number;
  reason?: string;
};
