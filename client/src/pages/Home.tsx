import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowUpLeft,
  ArrowDownUp,
  Undo2,
  Bell,
  DoorOpen,
  SearchCheck,
  RotateCcw,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileDown,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  Plus,
  Printer,
  Save,
  School,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  RefreshCw,
  LockKeyhole,
  Pencil,
  Trash2,
  Sparkles,
  UserRound,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { z } from "zod";
import { buildCurriculumRequirements, diagnoseSchedule, evaluateSchedule, expandRequirements, placementViolations, scoreScheduleQuality } from "@/features/scheduling";
import { solverWorker } from "@/features/scheduling/solver.client";
import type { SolverWeights, SubjectRequirement, TeacherAvailability, SchedulingConfig } from "@/features/scheduling";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

type NavKey = "dashboard" | "schedule" | "classes" | "teachers" | "subjects" | "notifications" | "exports" | "settings";
type ViewMode = "class" | "teacher" | "subject" | "master";
type Assignment = {
  id: string;
  subject: string;
  teacher: string;
  className: string;
  day: string;
  slot: number;
  locked?: boolean;
};
type TeacherGapLimits = Record<string, Record<string, number>>;
type TeacherSlotLimits = Record<string, Record<string, Record<number, number>>>;
type StageDailySlots = Record<string, number>;
type StageStudyDays = Record<string, string[]>;
type RoomAvailability = Record<string, Array<{ day: string; slot: number }>>;

type StyleToken = { strong: string; soft: string; border: string };

const days = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس"];
const timeSlots = [
  { slot: 1, time: "07:30 — 08:15" },
  { slot: 2, time: "08:20 — 09:05" },
  { slot: 3, time: "09:10 — 09:55" },
  { slot: 4, time: "10:15 — 11:00" },
  { slot: 5, time: "11:05 — 11:50" },
  { slot: 6, time: "11:55 — 12:40" },
  { slot: 7, time: "12:45 — 13:30" },
];
const gapConstraintTemplates = [
  { id: "morning", name: "تركيز صباحي", description: "يمنع الفراغات في أول حصتين", dailyLimit: 1, slotLimits: { 1: 0, 2: 0 } },
  { id: "after-break", name: "ما بعد الفسحة", description: "يحافظ على تماسك حصص ما بعد الفسحة", dailyLimit: 1, slotLimits: { 4: 0, 5: 0 } },
  { id: "strict", name: "يوم متماسك", description: "أقل حد ممكن للفراغات طوال اليوم", dailyLimit: 0, slotLimits: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 } },
  { id: "flexible", name: "مرن", description: "مرونة أعلى مع السماح بفراغين", dailyLimit: 2, slotLimits: {} },
] as const;

const subjectStyles: Record<string, StyleToken> = {
  رياضيات: { strong: "#4c35c7", soft: "#eeeaff", border: "#d8d0ff" },
  لغة_عربية: { strong: "#087e77", soft: "#e1f6f2", border: "#bde9e2" },
  علوم: { strong: "#c96c11", soft: "#fff0db", border: "#f5d2a3" },
  إنجليزي: { strong: "#b34b72", soft: "#fde9f0", border: "#f3c5d5" },
  اجتماعيات: { strong: "#2f7891", soft: "#e3f2f7", border: "#c0e0e9" },
  نشاط: { strong: "#987214", soft: "#fff6d9", border: "#f4e4a8" },
};

const initialAssignments: Assignment[] = [
  { id: "a1", subject: "رياضيات", teacher: "أحمد السعدي", className: "1/1", day: "الأحد", slot: 1 },
  { id: "a2", subject: "لغة_عربية", teacher: "نورة الحربي", className: "1/1", day: "الأحد", slot: 2 },
  { id: "a3", subject: "إنجليزي", teacher: "فهد القحطاني", className: "1/1", day: "الأحد", slot: 3 },
  { id: "a4", subject: "علوم", teacher: "ريم المطيري", className: "1/1", day: "الأحد", slot: 4 },
  { id: "a5", subject: "نشاط", teacher: "هند العتيبي", className: "1/1", day: "الأحد", slot: 5 },
  { id: "a6", subject: "رياضيات", teacher: "أحمد السعدي", className: "1/2", day: "الإثنين", slot: 1 },
  { id: "a7", subject: "لغة_عربية", teacher: "نورة الحربي", className: "1/2", day: "الإثنين", slot: 2 },
  { id: "a8", subject: "علوم", teacher: "ريم المطيري", className: "1/2", day: "الإثنين", slot: 3 },
  { id: "a9", subject: "إنجليزي", teacher: "فهد القحطاني", className: "1/2", day: "الإثنين", slot: 4 },
  { id: "a10", subject: "اجتماعيات", teacher: "سالم الغامدي", className: "1/2", day: "الإثنين", slot: 5 },
  { id: "a11", subject: "لغة_عربية", teacher: "نورة الحربي", className: "2/1", day: "الثلاثاء", slot: 1 },
  { id: "a12", subject: "رياضيات", teacher: "أحمد السعدي", className: "2/1", day: "الثلاثاء", slot: 2 },
  { id: "a13", subject: "اجتماعيات", teacher: "سالم الغامدي", className: "2/1", day: "الثلاثاء", slot: 3 },
  { id: "a14", subject: "علوم", teacher: "ريم المطيري", className: "2/1", day: "الثلاثاء", slot: 4 },
  { id: "a15", subject: "إنجليزي", teacher: "فهد القحطاني", className: "2/1", day: "الثلاثاء", slot: 5 },
  { id: "a16", subject: "رياضيات", teacher: "أحمد السعدي", className: "2/2", day: "الأربعاء", slot: 1 },
  { id: "a17", subject: "لغة_عربية", teacher: "نورة الحربي", className: "2/2", day: "الأربعاء", slot: 2 },
  { id: "a18", subject: "إنجليزي", teacher: "فهد القحطاني", className: "2/2", day: "الأربعاء", slot: 3 },
  { id: "a19", subject: "علوم", teacher: "ريم المطيري", className: "2/2", day: "الأربعاء", slot: 4 },
  { id: "a20", subject: "نشاط", teacher: "هند العتيبي", className: "2/2", day: "الأربعاء", slot: 5 },
  { id: "a21", subject: "اجتماعيات", teacher: "سالم الغامدي", className: "2/2", day: "الخميس", slot: 1 },
  { id: "a22", subject: "رياضيات", teacher: "أحمد السعدي", className: "2/2", day: "الخميس", slot: 2 },
  { id: "a23", subject: "لغة_عربية", teacher: "نورة الحربي", className: "2/2", day: "الخميس", slot: 3 },
  { id: "a24", subject: "إنجليزي", teacher: "فهد القحطاني", className: "2/2", day: "الخميس", slot: 4 },
];

const initialTeachers = [
  { name: "أحمد السعدي", subject: "رياضيات", load: 18, unavailable: "الخميس 7", free: "الثلاثاء 6" },
  { name: "نورة الحربي", subject: "لغة عربية", load: 20, unavailable: "—", free: "الأحد 7" },
  { name: "فهد القحطاني", subject: "إنجليزي", load: 16, unavailable: "الأحد 7", free: "الأربعاء 6" },
  { name: "ريم المطيري", subject: "علوم", load: 18, unavailable: "الثلاثاء 1", free: "الخميس 6" },
  { name: "سالم الغامدي", subject: "اجتماعيات", load: 14, unavailable: "—", free: "الإثنين 7" },
  { name: "هند العتيبي", subject: "نشاط", load: 12, unavailable: "الأربعاء 7", free: "الأحد 6" },
];

const initialSubjects = [
  { name: "رياضيات", weekly: 5, sections: 8, tone: "violet" },
  { name: "لغة عربية", weekly: 5, sections: 8, tone: "teal" },
  { name: "علوم", weekly: 4, sections: 8, tone: "amber" },
  { name: "إنجليزي", weekly: 4, sections: 8, tone: "rose" },
  { name: "اجتماعيات", weekly: 3, sections: 8, tone: "sky" },
  { name: "نشاط", weekly: 2, sections: 8, tone: "yellow" },
];

const navItems: { key: NavKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "لوحة التحكم", icon: LayoutDashboard },
  { key: "schedule", label: "مساحة الجدولة", icon: CalendarDays },
  { key: "classes", label: "الفصول", icon: School },
  { key: "teachers", label: "المعلمون", icon: Users },
  { key: "subjects", label: "المواد الدراسية", icon: BookOpen },
  { key: "notifications", label: "المراجعة", icon: SearchCheck },
];

const subjectLabel = (subject: string) => subject.replace("_", " ");

const defaultTeacherGapLimits = (): TeacherGapLimits => Object.fromEntries(initialTeachers.map((teacher) => [teacher.name, Object.fromEntries(days.map((day) => [day, 2]))]));
const defaultTeacherSlotLimits = (): TeacherSlotLimits => Object.fromEntries(initialTeachers.map((teacher) => [teacher.name, Object.fromEntries(days.map((day) => [day, Object.fromEntries(timeSlots.map((slot) => [slot.slot, -1]))]))]));
const defaultStageDailySlots = (): StageDailySlots => ({ "1": 7, "2": 7 });
const defaultStageStudyDays = (): StageStudyDays => ({ "1": [...days], "2": [...days] });
const getStageDailyLimit = (limits: StageDailySlots, className: string) => limits[className.split("/")[0]] ?? timeSlots.length;
const getStageStudyDays = (limits: StageStudyDays, className: string) => {
  const stage = className.split("/")[0];
  return Object.prototype.hasOwnProperty.call(limits, stage) ? (limits[stage] ?? []) : days;
};

function normalizeTeacherGapLimits(value: unknown): TeacherGapLimits {
  const defaults = defaultTeacherGapLimits();
  if (!value || typeof value !== "object") return defaults;
  const source = value as Record<string, unknown>;
  Object.keys(source).forEach((teacher) => {
    const raw = source[teacher];
    if (typeof raw === "number") defaults[teacher] = Object.fromEntries(days.map((day) => [day, raw]));
    else if (raw && typeof raw === "object") defaults[teacher] = Object.fromEntries(days.map((day) => [day, Math.max(0, Number((raw as Record<string, unknown>)[day]) || 0)]));
  });
  return defaults;
}

function normalizeTeacherSlotLimits(value: unknown): TeacherSlotLimits {
  const defaults = defaultTeacherSlotLimits();
  if (!value || typeof value !== "object") return defaults;
  const source = value as Record<string, unknown>;
  Object.keys(source).forEach((teacher) => {
    const teacherValue = source[teacher];
    if (!teacherValue || typeof teacherValue !== "object") return;
    days.forEach((day) => {
      const dayValue = (teacherValue as Record<string, unknown>)[day];
      if (!dayValue || typeof dayValue !== "object") return;
      timeSlots.forEach(({ slot }) => { const raw = Number((dayValue as Record<number, unknown>)[slot]);
        defaults[teacher][day][slot] = Number.isFinite(raw) ? Math.max(-1, raw) : -1; });
    });
  });
  return defaults;
}
const getTeacherGapLimit = (limits: TeacherGapLimits, teacher: string, day: string) => limits[teacher]?.[day] ?? 0;
const getTeacherSlotLimit = (limits: TeacherSlotLimits, teacher: string, day: string, slot: number) => limits[teacher]?.[day]?.[slot] ?? -1;

const defaultSolverWeights: SolverWeights = { internalClassGap: 35, teacherGap: 30, sameSubjectSameDay: 55, subjectSpacing: 50, dailyLoadImbalance: 10, preferenceMiss: 15, teacherLoadImbalance: 4, roomChange: 2, schoolSlotCoverage: 7, schoolFrontLoad: 10, classDailyBalance: 6 };
const parseAvailability = (teacher: { name: string; unavailable?: string }) => teacher.unavailable && teacher.unavailable !== "—" ? teacher.unavailable.split(",").map((value) => value.trim()).flatMap((value) => { const match = value.match(/^(.+?)\s+(\d+)$/); return match ? [{ day: match[1], slot: Number(match[2]) }] : []; }) : [];

const STORAGE_KEYS = {
  assignments: "madrasati.assignments.v1",
  teachers: "madrasati.teachers.v1",
  subjects: "madrasati.subjects.v1",
  classes: "madrasati.classes.v1",
  logo: "madrasati.school-logo.v1",
  teacherGapLimits: "madrasati.teacher-gap-limits.v1",
  teacherSlotLimits: "madrasati.teacher-slot-limits.v1",
  stageDailySlots: "madrasati.stage-daily-slots.v1",
  stageStudyDays: "madrasati.stage-study-days.v1",
  teacherAvailability: "madrasati.teacher-availability.v1",
  subjectRequirements: "madrasati.subject-requirements.v1",
  solverWeights: "madrasati.solver-weights.v1",
  curriculumMode: "madrasati.curriculum-mode.v1",
  rooms: "madrasati.rooms.v1",
  roomAvailability: "madrasati.room-availability.v1",
  schoolName: "madrasati.school-name.v1",
  stages: "madrasati.stages.v1",
};

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

const BackupSchema = z.object({
  app: z.string().optional(), version: z.number().optional(), createdAt: z.string().optional(),
  data: z.object({ schoolName: z.string().optional(), stages: z.array(z.string()).optional(), assignments: z.array(z.object({ id: z.string(), subject: z.string(), teacher: z.string(), className: z.string(), day: z.string(), slot: z.number() })), teachers: z.array(z.any()), subjects: z.array(z.any()), classes: z.array(z.string()), schoolLogo: z.string().nullable().optional(), teacherGapLimits: z.any().optional(), teacherSlotLimits: z.any().optional(), stageDailySlots: z.any().optional(), stageStudyDays: z.any().optional(), teacherAvailability: z.any().optional(), subjectRequirements: z.array(z.any()).optional(), solverWeights: z.any().optional(), curriculumMode: z.boolean().optional(), rooms: z.array(z.string()).optional(), roomAvailability: z.any().optional() })
});

const navPath: Record<NavKey, string> = {
  dashboard: "/",
  schedule: "/schedule",
  classes: "/classes",
  teachers: "/teachers",
  subjects: "/subjects",
  notifications: "/notifications",
  exports: "/exports",
  settings: "/settings",
};

const pathNav = (path: string): NavKey => {
  const entry = Object.entries(navPath).find(([, value]) => value === path);
  return (entry?.[0] as NavKey | undefined) ?? "dashboard";
};

export default function Home() {
  const [location, setLocation] = useLocation();
  const [activeNav, setActiveNav] = useState<NavKey>(() => pathNav(location));
  const goToNav = (key: NavKey) => {
    setActiveNav(key);
    setLocation(navPath[key]);
    setMobileMenu(false);
  };
  useEffect(() => {
    const next = pathNav(location);
    setActiveNav(next);
  }, [location]);

  const [dashboardTab, setDashboardTab] = useState<"overview" | "analytics">("overview");
  const [settingsTab, setSettingsTab] = useState<"school" | "schedule" | "constraints" | "data" | "advanced" | "danger">("school");
  const [activeView, setActiveView] = useState<ViewMode>("class");
  const [selectedClass, setSelectedClass] = useState("1/1");
  const [selectedTeacher, setSelectedTeacher] = useState("أحمد السعدي");
  const [selectedSubject, setSelectedSubject] = useState("رياضيات");
  const [selectedDay, setSelectedDay] = useState("all");
  const [assignments, setAssignments] = useState<Assignment[]>(() => loadStored(STORAGE_KEYS.assignments, initialAssignments));
  const [teachers, setTeachers] = useState(() => loadStored(STORAGE_KEYS.teachers, initialTeachers));
  const [subjects, setSubjects] = useState(() => loadStored(STORAGE_KEYS.subjects, initialSubjects));
  const [classes, setClasses] = useState<string[]>(() => loadStored(STORAGE_KEYS.classes, ["1/1", "1/2", "2/1", "2/2"]));
  const [stages, setStages] = useState<string[]>(() => loadStored(STORAGE_KEYS.stages, ["1", "2"]));
  const [schoolName, setSchoolName] = useState(() => loadStored(STORAGE_KEYS.schoolName, "مدرسة النور الأهلية"));
  const [generation, setGeneration] = useState(1);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastSolverResult, setLastSolverResult] = useState<{ complete: boolean; placed: number; unplaced: number; hardViolations: number; softPenalty: number; exploredNodes: number; durationMs: number } | null>(null);
  const [optimizationSummary, setOptimizationSummary] = useState<{ before: number; after: number; beforeQuality: number; afterQuality: number; moves: number; durationMs: number } | null>(null);
  const [conflict, setConflict] = useState<{ message: string; day: string; slot: number } | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [newTeacher, setNewTeacher] = useState("");
  const [newClass, setNewClass] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [newStage, setNewStage] = useState("");
  const [editingStage, setEditingStage] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState("");
  const [schoolLogo, setSchoolLogo] = useState<string | null>(() => loadStored<string | null>(STORAGE_KEYS.logo, null));
  const [teacherGapLimits, setTeacherGapLimits] = useState<TeacherGapLimits>(() => normalizeTeacherGapLimits(loadStored(STORAGE_KEYS.teacherGapLimits, defaultTeacherGapLimits())));
  const [teacherSlotLimits, setTeacherSlotLimits] = useState<TeacherSlotLimits>(() => normalizeTeacherSlotLimits(loadStored(STORAGE_KEYS.teacherSlotLimits, defaultTeacherSlotLimits())));
  const [stageDailySlots, setStageDailySlots] = useState<StageDailySlots>(() => loadStored(STORAGE_KEYS.stageDailySlots, defaultStageDailySlots()));
  const [stageStudyDays, setStageStudyDays] = useState<StageStudyDays>(() => loadStored(STORAGE_KEYS.stageStudyDays, defaultStageStudyDays()));
  const [teacherAvailability, setTeacherAvailability] = useState<Record<string, TeacherAvailability>>(() => loadStored(STORAGE_KEYS.teacherAvailability, Object.fromEntries(initialTeachers.map((teacher) => [teacher.name, { teacher: teacher.name, unavailable: parseAvailability(teacher) }]))));
  const [subjectRequirements, setSubjectRequirements] = useState<SubjectRequirement[]>(() => loadStored(STORAGE_KEYS.subjectRequirements, []));
  const [solverWeights, setSolverWeights] = useState<SolverWeights>(() => ({ ...defaultSolverWeights, ...loadStored(STORAGE_KEYS.solverWeights, {}) }));
  const [curriculumMode, setCurriculumMode] = useState(() => loadStored(STORAGE_KEYS.curriculumMode, false));
  const [rooms, setRooms] = useState<string[]>(() => loadStored(STORAGE_KEYS.rooms, ["مختبر 1", "قاعة الأنشطة"]));
  const [roomAvailability, setRoomAvailability] = useState<RoomAvailability>(() => loadStored(STORAGE_KEYS.roomAvailability, {}));
  const [newRoom, setNewRoom] = useState("");
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [slotSettingsDay, setSlotSettingsDay] = useState(days[0]);
  const [templateTeacher, setTemplateTeacher] = useState(initialTeachers[0]?.name ?? "");
  const [showCompressionReport, setShowCompressionReport] = useState(false);
  const [gapPreviewAssignments, setGapPreviewAssignments] = useState<Assignment[] | null>(null);
  const [undoAssignments, setUndoAssignments] = useState<Assignment[] | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ day: string; slot: number; moving: Assignment; valid: boolean; reason: string | null } | null>(null);
  const [analyticsStage, setAnalyticsStage] = useState("all");
  const [analyticsClass, setAnalyticsClass] = useState("all");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearScheduleConfirm, setShowClearScheduleConfirm] = useState(false);
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState<"teachers" | "classes" | "subjects" | "stages" | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const hasMountedStorageEffect = useRef(false);
  const scheduleGridRef = useRef<HTMLDivElement>(null);
  const masterGridRef = useRef<HTMLDivElement>(null);
  // Mobile timetable state
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSelectedDayIndex, setMobileSelectedDayIndex] = useState(0);
  // Mobile tap-to-move state (mirrors keyboard navigation pattern)
  const [mobileMovingAssignment, setMobileMovingAssignment] = useState<Assignment | null>(null);
  const [mobileMovingFrom, setMobileMovingFrom] = useState<{ day: string; slot: number } | null>(null);
  // Keyboard navigation state for timetable grid
  const [keyboardFocus, setKeyboardFocus] = useState<{ day: string; slot: number } | null>(null);
  const [isKeyboardMoving, setIsKeyboardMoving] = useState(false);
  const [keyboardMovingAssignment, setKeyboardMovingAssignment] = useState<Assignment | null>(null);
  // Debounce timer for localStorage writes
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Write all state to localStorage (used by debounced effect and persistNow)
  const writeToStorage = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.assignments, JSON.stringify(assignments));
      localStorage.setItem(STORAGE_KEYS.teachers, JSON.stringify(teachers));
      localStorage.setItem(STORAGE_KEYS.subjects, JSON.stringify(subjects));
      localStorage.setItem(STORAGE_KEYS.classes, JSON.stringify(classes));
      localStorage.setItem(STORAGE_KEYS.stages, JSON.stringify(stages));
      localStorage.setItem(STORAGE_KEYS.schoolName, JSON.stringify(schoolName));
      localStorage.setItem(STORAGE_KEYS.logo, JSON.stringify(schoolLogo));
      localStorage.setItem(STORAGE_KEYS.teacherGapLimits, JSON.stringify(teacherGapLimits));
      localStorage.setItem(STORAGE_KEYS.teacherSlotLimits, JSON.stringify(teacherSlotLimits));
      localStorage.setItem(STORAGE_KEYS.stageDailySlots, JSON.stringify(stageDailySlots));
      localStorage.setItem(STORAGE_KEYS.stageStudyDays, JSON.stringify(stageStudyDays));
      localStorage.setItem(STORAGE_KEYS.teacherAvailability, JSON.stringify(teacherAvailability));
      localStorage.setItem(STORAGE_KEYS.subjectRequirements, JSON.stringify(subjectRequirements));
      localStorage.setItem(STORAGE_KEYS.solverWeights, JSON.stringify(solverWeights));
      localStorage.setItem(STORAGE_KEYS.curriculumMode, JSON.stringify(curriculumMode));
      localStorage.setItem(STORAGE_KEYS.rooms, JSON.stringify(rooms));
      localStorage.setItem(STORAGE_KEYS.roomAvailability, JSON.stringify(roomAvailability));
      setLastSaved(new Date());
      hasMountedStorageEffect.current = true;
    } catch {
      setToast("تعذر الحفظ المحلي — مساحة التخزين ممتلئة");
    }
  }, [assignments, teachers, subjects, classes, stages, schoolName, schoolLogo, teacherGapLimits, teacherSlotLimits, stageDailySlots, stageStudyDays, teacherAvailability, subjectRequirements, solverWeights, curriculumMode, rooms, roomAvailability]);

  // Debounced localStorage writes - only writes after 300ms of no changes
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      writeToStorage();
    }, 300);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [writeToStorage]);

  // Mobile detection
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 760);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const persistNow = () => {
    writeToStorage();
    showToast("تم حفظ جميع التعديلات محلياً");
  };

  const stats = useMemo(() => {
    const expected = curriculumMode && subjectRequirements.length
      ? subjectRequirements.reduce((total, requirement) => total + Math.max(0, Math.floor(requirement.weeklyLessons)), 0)
      : subjects.reduce((total, subject) => total + Math.max(1, Number(subject.weekly) || 1) * classes.length, 0);
    const assigned = assignments.length;
    const engineEvaluation = evaluateSchedule(assignments, { days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights });
    const conflicts = engineEvaluation.hardViolations;
    const missing = Math.max(0, expected - assigned);
    return [
      { label: "الحصص المكتملة", value: String(assigned), note: `من أصل ${expected || assigned}`, color: "mint", icon: Check },
      { label: "التعارضات", value: String(conflicts), note: conflicts ? "تحتاج إلى مراجعة" : "الجدول سليم", color: "violet", icon: AlertTriangle },
      { label: "حصص غير موزعة", value: String(missing), note: missing ? "تحتاج إلى توزيع" : "اكتمل التوزيع", color: "amber", icon: Clock3 },
      { label: "المعلمون النشطون", value: String(teachers.length), note: `${teachers.filter((teacher) => teacher.load > 0).length} لديهم نصاب`, color: "sky", icon: Users },
    ];
  }, [assignments, classes, subjects, curriculumMode, subjectRequirements, stageDailySlots, stageStudyDays, teachers, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, solverWeights]);

  const diagnostics = useMemo(() => diagnoseSchedule({
    days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits,
    teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights,
  }, assignments), [assignments, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, subjectRequirements, solverWeights]);

  const scheduleQuality = useMemo(() => {
    const evaluation = evaluateSchedule(assignments, { days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights });
    const total = curriculumMode && subjectRequirements.length ? subjectRequirements.reduce((sum, requirement) => sum + Math.max(0, Math.floor(requirement.weeklyLessons)), 0) : assignments.length;
    return scoreScheduleQuality(evaluation, assignments.length, total);
  }, [assignments, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, subjectRequirements, solverWeights, curriculumMode]);

  const viewTitle = activeView === "class" ? `الصف ${selectedClass}` : activeView === "teacher" ? selectedTeacher : activeView === "subject" ? subjectLabel(selectedSubject) : "جميع الفصول";
  const visibleDays = selectedDay === "all" ? days : [selectedDay];

  const cellAssignments = (day: string, slot: number) => {
    const visibleAssignments = gapPreviewAssignments ?? assignments;
    return visibleAssignments.filter((item) => {
      if (item.day !== day || item.slot !== slot) return false;
      if (selectedDay !== "all" && item.day !== selectedDay) return false;
      if (activeView === "class") return item.className === selectedClass;
      if (activeView === "teacher") return item.teacher === selectedTeacher;
      if (activeView === "subject") return item.subject === selectedSubject || subjectLabel(item.subject) === subjectLabel(selectedSubject);
      return true;
    });
  };

  const isInternalGap = (day: string, slot: number) => {
    if (activeView === "master" || cellAssignments(day, slot).length > 0) return false;
    const occupiedSlots = timeSlots.map((entry) => entry.slot).filter((currentSlot) => cellAssignments(day, currentSlot).length > 0);
    return occupiedSlots.length > 1 && slot > Math.min(...occupiedSlots) && slot < Math.max(...occupiedSlots);
  };

  const teacherGapReason = (moving: Assignment, day: string, slot: number) => {
    const slots = [...assignments.filter((item) => item.id !== moving.id && item.teacher === moving.teacher && item.day === day).map((item) => item.slot), slot];
    if (slots.length < 2) return null;
    const gaps = Math.max(0, Math.max(...slots) - Math.min(...slots) + 1 - slots.length);
    const slotLimit = getTeacherSlotLimit(teacherSlotLimits, moving.teacher, day, slot);
    const limit = slotLimit >= 0 ? slotLimit : getTeacherGapLimit(teacherGapLimits, moving.teacher, day);
    return gaps > limit ? `تحذير: نقل الحصة سيترك ${gaps} فراغات للمعلم ${moving.teacher} يوم ${day}، والحد المسموح ${limit}` : null;
  };
  const classGapReason = (moving: Assignment, day: string, slot: number) => {
    const affectedDays = Array.from(new Set([moving.day, day]));
    for (const affectedDay of affectedDays) {
      const slots = assignments.filter((item) => item.id !== moving.id && item.className === moving.className && item.day === affectedDay).map((item) => item.slot);
      if (affectedDay === day) slots.push(slot);
      if (slots.length > 1) {
        const gaps = Math.max(0, Math.max(...slots) - Math.min(...slots) + 1 - slots.length);
        if (gaps > 0) return `ممنوع: نقل الحصة سيترك فراغاً داخلياً للفصل ${moving.className} يوم ${affectedDay}`;
      }
    }
    return null;
  };
  const conflictReason = (moving: Assignment, day: string, slot: number) => {
    const engineViolations = placementViolations(moving, { day, slot }, assignments.filter((item) => item.id !== moving.id), {
      days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits,
      teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights,
    });
    const hard = engineViolations.find((item) => item.severity === "hard");
    if (hard) return hard.message;
    return classGapReason(moving, day, slot) ?? teacherGapReason(moving, day, slot);
  };

  const handleDrop = (day: string, slot: number) => {
    if (!draggedId) return;
    const moving = assignments.find((item) => item.id === draggedId);
    if (!moving) return;
    const reason = conflictReason(moving, day, slot);
    if (reason) {
      setConflict({ message: reason, day, slot });
      showToast("لم يتم النقل — تم اكتشاف تعارض");
      setDraggedId(null);
      return;
    }
    setAssignments((current) => current.map((item) => (item.id === draggedId ? { ...item, day, slot } : item)));
    setConflict(null);
    setDraggedId(null);
    showToast(`تم نقل حصة ${subjectLabel(moving.subject)} إلى ${day}، الحصة ${slot}`);
  };

  const handleDragEnter = (day: string, slot: number) => {
    if (!draggedId) return;
    const moving = assignments.find((item) => item.id === draggedId);
    if (!moving) return;
    const reason = conflictReason(moving, day, slot);
    setDragPreview({ day, slot, moving, valid: !reason, reason });
  };

  const clearDragPreview = () => setDragPreview(null);

  // Keyboard navigation for timetable grid
  const handleKeyboardNavigation = (event: React.KeyboardEvent, day: string, slot: number, items: Assignment[]) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isKeyboardMoving && items.length > 0) {
        // Pick up the first assignment in this cell
        setIsKeyboardMoving(true);
        setKeyboardMovingAssignment(items[0]);
        setKeyboardFocus({ day, slot });
        showToast(`تم التقاط حصة ${subjectLabel(items[0].subject)} — استخدم الأسهم للتنقل، Enter للإفلات، Escape للإلغاء`);
      } else if (isKeyboardMoving && keyboardMovingAssignment) {
        // Drop the assignment
        const reason = conflictReason(keyboardMovingAssignment, day, slot);
        if (reason) {
          setConflict({ message: reason, day, slot });
          showToast("لم يتم النقل — تم اكتشاف تعارض");
        } else {
          setAssignments((current) => current.map((item) => (item.id === keyboardMovingAssignment.id ? { ...item, day, slot } : item)));
          showToast(`تم نقل حصة ${subjectLabel(keyboardMovingAssignment.subject)} إلى ${day}، الحصة ${slot}`);
        }
        setIsKeyboardMoving(false);
        setKeyboardMovingAssignment(null);
        setKeyboardFocus(null);
      }
    } else if (event.key === "Escape" && isKeyboardMoving) {
      event.preventDefault();
      setIsKeyboardMoving(false);
      setKeyboardMovingAssignment(null);
      setKeyboardFocus(null);
      showToast("تم إلغاء النقل");
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const dayIndex = visibleDays.indexOf(day);
      if (dayIndex < visibleDays.length - 1) {
        setKeyboardFocus({ day: visibleDays[dayIndex + 1], slot });
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      const dayIndex = visibleDays.indexOf(day);
      if (dayIndex > 0) {
        setKeyboardFocus({ day: visibleDays[dayIndex - 1], slot });
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      if (slot < timeSlots.length) {
        setKeyboardFocus({ day, slot: slot + 1 });
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (slot > 1) {
        setKeyboardFocus({ day, slot: slot - 1 });
      }
    }
  };

  // Mobile tap-to-move handlers
  const handleMobilePickup = (item: Assignment, day: string, slot: number) => {
    if (mobileMovingAssignment && mobileMovingAssignment.id === item.id) {
      // Tap same assignment again -> cancel
      setMobileMovingAssignment(null);
      setMobileMovingFrom(null);
      showToast("تم إلغاء النقل");
      return;
    }
    // Pick up new assignment
    setMobileMovingAssignment(item);
    setMobileMovingFrom({ day, slot });
    showToast(`تم التقاط حصة ${subjectLabel(item.subject)} — اضغط على خانة فارغة للإفلات، أو اضغط نفس الحصة للإلغاء`);
  };

  const handleMobileDrop = (day: string, slot: number) => {
    if (!mobileMovingAssignment || !mobileMovingFrom) return;
    const moving = mobileMovingAssignment;
    const reason = conflictReason(moving, day, slot);
    if (reason) {
      setConflict({ message: reason, day, slot });
      showToast("لم يتم النقل — تم اكتشاف تعارض");
    } else {
      setAssignments((current) => current.map((item) => (item.id === moving.id ? { ...item, day, slot } : item)));
      showToast(`تم نقل حصة ${subjectLabel(moving.subject)} إلى ${day}، الحصة ${slot}`);
    }
    setMobileMovingAssignment(null);
    setMobileMovingFrom(null);
  };

  const handleMobileEmptySlotTap = (day: string, slot: number) => {
    if (mobileMovingAssignment) {
      handleMobileDrop(day, slot);
    } else {
      // Tap empty slot without holding anything -> quick add (future: open quick-add modal)
      showToast("استخدم السحب والإفلات من النسخة المكتبية، أو اضغط على حصة لنقلها");
    }
  };

  const reorderClassSchedule = (className: string) => {
    let next = [...assignments];
    days.forEach((day) => {
      const classDayItems = next.filter((item) => item.className === className && item.day === day).sort((a, b) => a.slot - b.slot);
      classDayItems.forEach((item, index) => {
        let targetSlot = index + 1;
        while (targetSlot <= timeSlots.length && next.some((other) => other.id !== item.id && other.day === day && other.slot === targetSlot && other.teacher === item.teacher)) targetSlot += 1;
        if (targetSlot > timeSlots.length) return;
        const candidate = { ...item, slot: targetSlot };
        const violations = placementViolations(item, { day, slot: targetSlot }, next.filter((entry) => entry.id !== item.id), {
          days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights,
        });
        if (!violations.some((violation) => violation.severity === "hard")) {
          next = next.map((entry) => entry.id === item.id ? candidate : entry);
        }
      });
    });
    const beforeHard = evaluateSchedule(assignments, { days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights }).hardViolations;
    const afterHard = evaluateSchedule(next, { days, timeSlots, classes, stageDailySlots, stageStudyDays, teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability, requirements: subjectRequirements, weights: solverWeights }).hardViolations;
    if (afterHard > beforeHard) {
      showToast("لم يتم تطبيق إعادة الترتيب لأنها قد تزيد التعارضات");
      return;
    }
    setAssignments(next);
    setSelectedClass(className);
    setActiveView("class");
    showToast(`تمت إعادة ترتيب حصص الفصل ${className} مع الحفاظ على القيود الصلبة`);
  };

  const buildAutoFixedAssignments = (source: Assignment[]) => {
    let next = [...source];
    classes.forEach((className) => {
      days.forEach((day) => {
        const classDayItems = next.filter((item) => item.className === className && item.day === day).sort((a, b) => a.slot - b.slot);
        classDayItems.forEach((item, index) => {
          let targetSlot = index + 1;
          while (targetSlot <= timeSlots.length && next.some((other) => other.id !== item.id && other.day === day && other.slot === targetSlot && other.teacher === item.teacher)) targetSlot += 1;
          if (targetSlot > timeSlots.length) return;
          next = next.map((entry) => entry.id === item.id ? { ...entry, slot: targetSlot } : entry);
        });
      });
    });
    return next;
  };
  const autoFixInternalGaps = () => {
    const proposed = buildAutoFixedAssignments(assignments);
    setGapPreviewAssignments(proposed);
    showToast("تم تجهيز معاينة معالجة الفراغات — راجعها قبل التطبيق");
  };
  const applyGapPreview = () => {
    if (!gapPreviewAssignments) return;
    setUndoAssignments(assignments);
    setAssignments(gapPreviewAssignments);
    setGapPreviewAssignments(null);
    showToast("تم تطبيق معالجة الفراغات بنجاح");
  };
  const cancelGapPreview = () => {
    setGapPreviewAssignments(null);
    showToast("تم إلغاء معاينة معالجة الفراغات");
  };
  const undoLastChange = () => {
    if (!undoAssignments) return;
    setAssignments(undoAssignments);
    setUndoAssignments(null);
    showToast("تم التراجع عن آخر معالجة للفراغات");
  };
  const applyGapTemplate = (templateId: string) => {
    const template = gapConstraintTemplates.find((item) => item.id === templateId);
    if (!template || !templateTeacher) return;
    setTeacherGapLimits((current) => ({ ...current, [templateTeacher]: Object.fromEntries(days.map((day) => [day, template.dailyLimit])) }));
    setTeacherSlotLimits((current) => ({
      ...current,
      [templateTeacher]: Object.fromEntries(days.map((day) => [day, Object.fromEntries(timeSlots.map(({ slot }) => [slot, template.slotLimits[slot as keyof typeof template.slotLimits] ?? -1]))])),
    }));
    showToast(`تم تطبيق قالب «${template.name}» على ${templateTeacher}`);
  };

  const filteredAnalyticsAssignments = useMemo(() => assignments.filter((item) => {
    const matchesStage = analyticsStage === "all" || item.className.startsWith(`${analyticsStage}/`);
    const matchesClass = analyticsClass === "all" || item.className === analyticsClass;
    return matchesStage && matchesClass;
  }), [assignments, analyticsStage, analyticsClass]);

  const analyticsTeacherData = useMemo(() => teachers.map((teacher) => ({ name: teacher.name.split(" ")[0], fullName: teacher.name, حصص: filteredAnalyticsAssignments.filter((item) => item.teacher === teacher.name).length })).filter((item) => item.حصص > 0), [teachers, filteredAnalyticsAssignments]);
  const analyticsSubjectData = useMemo(() => Object.entries(filteredAnalyticsAssignments.reduce<Record<string, number>>((accumulator, item) => { accumulator[subjectLabel(item.subject)] = (accumulator[subjectLabel(item.subject)] ?? 0) + 1; return accumulator; }, {})).map(([name, حصص]) => ({ name, حصص })), [filteredAnalyticsAssignments]);
  const analyticsConflicts = useMemo(() => assignments.filter((item, index, all) => all.some((other, otherIndex) => otherIndex < index && other.day === item.day && other.slot === item.slot && (other.teacher === item.teacher || other.className === item.className))).length, [assignments]);
  const analyticsClasses = analyticsClass === "all"
    ? (analyticsStage === "all" ? classes : classes.filter((item) => item.startsWith(`${analyticsStage}/`)))
    : [analyticsClass];
  const analyticsExpectedSlots = curriculumMode && subjectRequirements.length
    ? subjectRequirements.filter((requirement) => analyticsClasses.includes(requirement.className)).reduce((total, requirement) => total + Math.max(0, Math.floor(requirement.weeklyLessons)), 0)
    : subjects.reduce((total, subject) => total + Math.max(1, Number(subject.weekly) || 1) * analyticsClasses.length, 0);
  const analyticsUnassigned = Math.max(0, analyticsExpectedSlots - filteredAnalyticsAssignments.length);
  const analyticsInternalGaps = useMemo(() => {
    const groups = new Map<string, Assignment[]>();
    filteredAnalyticsAssignments.forEach((item) => {
      const key = `${item.className}::${item.day}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    return Array.from(groups.values()).reduce((total, group) => {
      if (group.length < 2) return total;
      const slots = group.map((item) => item.slot);
      return total + Math.max(0, Math.max(...slots) - Math.min(...slots) + 1 - group.length);
    }, 0);
  }, [filteredAnalyticsAssignments]);
  const analyticsGapReports = useMemo(() => {
    const countGaps = (items: Assignment[]) => days.reduce((total, day) => {
      const slots = items.filter((item) => item.day === day).map((item) => item.slot);
      return total + (slots.length > 1 ? Math.max(0, Math.max(...slots) - Math.min(...slots) + 1 - slots.length) : 0);
    }, 0);
    const teacherReport = teachers.map((teacher) => ({ name: teacher.name, gaps: countGaps(filteredAnalyticsAssignments.filter((item) => item.teacher === teacher.name)) })).filter((item) => item.gaps > 0).sort((a, b) => b.gaps - a.gaps);
    const classReport = classes.map((className) => ({ name: className, gaps: countGaps(filteredAnalyticsAssignments.filter((item) => item.className === className)) })).filter((item) => item.gaps > 0).sort((a, b) => b.gaps - a.gaps);
    return { teacherReport, classReport };
  }, [teachers, classes, filteredAnalyticsAssignments]);
  const compressionReport = useMemo(() => classes.map((className) => {
    const gapsByDay = days.map((day) => {
      const slots = assignments.filter((item) => item.className === className && item.day === day).map((item) => item.slot);
      return { day, gaps: slots.length > 1 ? Math.max(0, Math.max(...slots) - Math.min(...slots) + 1 - slots.length) : 0 };
    }).filter((entry) => entry.gaps > 0);
    const conflictCount = assignments.filter((item, index, all) => item.className === className && all.some((other, otherIndex) => otherIndex < index && other.day === item.day && other.slot === item.slot && other.teacher === item.teacher)).length;
    return { className, gapsByDay, conflictCount };
  }).filter((entry) => entry.gapsByDay.length > 0 || entry.conflictCount > 0), [classes, assignments]);

  const generateSmartSchedule = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const sourceAssignments = curriculumMode && subjectRequirements.length ? expandRequirements(subjectRequirements) : assignments;
      const config: SchedulingConfig = {
        days,
        timeSlots,
        classes,
        stageDailySlots,
        stageStudyDays,
        teacherGapLimits,
        teacherSlotLimits,
        teacherAvailability,
        roomAvailability,
        requirements: subjectRequirements,
        weights: solverWeights,
        maxNodes: Math.max(100000, sourceAssignments.length * 10000),
        timeLimitMs: Math.min(10000, Math.max(2500, sourceAssignments.length * 50)),
      };
      showToast("جاري التوليد في الخلفية…");
      const result = await solverWorker.solve(sourceAssignments, config);

      setAssignments(result.assignments);
      setLastSolverResult({ complete: result.complete, placed: result.metrics.placed, unplaced: result.metrics.unplaced, hardViolations: result.metrics.hardViolations, softPenalty: result.metrics.softPenalty, exploredNodes: result.exploredNodes, durationMs: result.durationMs });
      setGeneration((value) => value + 1);
      setConflict(null);

      if (result.complete) {
        showToast(`اكتمل الحل — ${result.exploredNodes} عقدة، ${result.durationMs}ms، دون تعارضات صلبة`);
      } else {
        showToast(`حل جزئي: ${result.unplaced.length} حصة غير موزعة — راجع القيود أو وسّع الموارد`);
      }
    } catch (error) {
      console.error("Solver error:", error);
      showToast("فشل في توليد الجدول");
    } finally {
      setIsGenerating(false);
    }
  };


  const improveCurrentSchedule = async () => {
    if (isGenerating || assignments.length < 2) {
      if (assignments.length < 2) showToast("لا توجد حصص كافية لتحسين الجدول");
      return;
    }
    setIsGenerating(true);
    setOptimizationSummary(null);
    try {
      const config: SchedulingConfig = {
        days, timeSlots, classes, stageDailySlots, stageStudyDays,
        teacherGapLimits, teacherSlotLimits, teacherAvailability, roomAvailability,
        requirements: subjectRequirements, weights: solverWeights,
      };
      const beforeEval = evaluateSchedule(assignments, config);
      const total = curriculumMode && subjectRequirements.length
        ? subjectRequirements.reduce((sum, requirement) => sum + Math.max(0, Math.floor(requirement.weeklyLessons)), 0)
        : assignments.length;
      const beforeQuality = scoreScheduleQuality(beforeEval, assignments.length, total).overall;
      showToast("جاري تحسين الجدول…");
      const result = await solverWorker.optimize(assignments, config, { timeLimitMs: 3500, maxNodes: 18000 });
      const afterEvaluation = evaluateSchedule(result.assignments, config);
      const afterQuality = scoreScheduleQuality(afterEvaluation, result.assignments.length, total).overall;
      setOptimizationSummary({
        before: beforeEval.softPenalty,
        after: result.metrics.softPenalty,
        beforeQuality,
        afterQuality,
        moves: Number((result.reason?.match(/\d+/)?.[0] ?? "0")),
        durationMs: result.durationMs,
      });
      if (result.metrics.softPenalty < beforeEval.softPenalty || result.metrics.hardViolations < beforeEval.hardViolations) {
        setUndoAssignments(assignments);
        setAssignments(result.assignments);
        setConflict(null);
        setGeneration((value) => value + 1);
        showToast(`تم تحسين الجدول — ${result.reason ?? ""}`);
      } else {
        showToast("الجدول الحالي أفضل أو لم يجد المحرك تحسينًا آمنًا");
      }
    } catch (error) {
      console.error("Optimizer error:", error);
      showToast("فشل في تحسين الجدول");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadCsv = () => {
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const header = ["اليوم", "الحصة", "الوقت", "الفصل", "المادة", "المعلم"].map(escapeCsv).join(",") + "\n";
    const rows = assignments.map((item) => {
      const time = timeSlots.find((slot) => slot.slot === item.slot)?.time ?? "";
      return [item.day, item.slot, time, item.className, subjectLabel(item.subject), item.teacher].map(escapeCsv).join(",");
    }).join("\n");
    const blob = new Blob(["\ufeff" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `جدول-${schoolName}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("تم تنزيل ملف CSV بنجاح");
  };

  const downloadExcel = () => {
    const rows = assignments.map((item) => ({
      "اليوم": item.day, "الحصة": item.slot, "الوقت": timeSlots.find((slot) => slot.slot === item.slot)?.time ?? "",
      "الفصل": item.className, "المادة": subjectLabel(item.subject), "المعلم": item.teacher,
    }));
    const summary = [{ "المؤشر": "إجمالي الحصص", "القيمة": assignments.length }, { "المؤشر": "الفصول", "القيمة": classes.length }, { "المؤشر": "المعلمون", "القيمة": teachers.length }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "الجدول");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary), "الملخص");
    XLSX.writeFile(workbook, `جدول-${schoolName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast("تم تنزيل ملف Excel بنجاح");
  };

  const printSchedule = () => {
    showToast("تم تجهيز المعاينة — اختر الطباعة من نافذة المتصفح");
    window.setTimeout(() => window.print(), 160);
  };
  const printMasterSchedule = () => {
    if (activeView !== "master") setActiveView("master");
    setShowPrintPreview(true);
  };

  const captureElementAsPdf = async (element: HTMLElement | null, title: string, filename: string, orientation: "landscape" | "portrait" = "landscape") => {
    if (!element) {
      showToast("لم يتم العثور على العنصر للتصدير");
      return;
    }
    try {
      showToast("جاري إنشاء ملف PDF...");
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const finalWidth = imgWidth * ratio;
      const finalHeight = imgHeight * ratio;
      const x = (pdfWidth - finalWidth) / 2;
      const y = (pdfHeight - finalHeight) / 2;
      pdf.addImage(imgData, "PNG", x, y, finalWidth, finalHeight);
      pdf.save(filename);
      showToast(`تم إنشاء ملف PDF: ${filename}`);
    } catch (error) {
      console.error("PDF export error:", error);
      showToast("فشل إنشاء ملف PDF");
    }
  };

  const exportPdf = async () => {
    if (activeView === "master") {
      await captureElementAsPdf(masterGridRef.current, `الجدول الأسبوعي — ${viewTitle}`, `جدول-${viewTitle.replaceAll(" ", "-")}.pdf`);
    } else {
      await captureElementAsPdf(scheduleGridRef.current, `الجدول الأسبوعي — ${viewTitle}`, `جدول-${viewTitle.replaceAll(" ", "-")}.pdf`);
    }
  };

  const printAllTeachers = async () => {
    if (!masterGridRef.current) {
      showToast("لم يتم العثور على الجدول الموحد");
      return;
    }
    try {
      showToast("جاري إنشاء ملف PDF للمعلمين...");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      // Capture the master grid once
      const canvas = await html2canvas(masterGridRef.current, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const finalWidth = imgWidth * ratio;
      const finalHeight = imgHeight * ratio;
      const x = (pdfWidth - finalWidth) / 2;
      const y = (pdfHeight - finalHeight) / 2;
      pdf.addImage(imgData, "PNG", x, y, finalWidth, finalHeight);
      pdf.save("جداول-المعلمين-دفعة-واحدة.pdf");
      showToast(`تم إنشاء ملف PDF يضم ${teachers.length} معلم في الجدول الموحد`);
    } catch (error) {
      console.error("PDF export error:", error);
      showToast("فشل إنشاء ملف PDF للمعلمين");
    }
  };

  const handleLogoUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setSchoolLogo(String(reader.result)); showToast("تمت إضافة شعار المدرسة للترويسة"); };
    reader.readAsDataURL(file);
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        const normalized = records.map((record) => Object.fromEntries(Object.entries(record).map(([key, value]) => [String(key).trim().toLowerCase(), String(value).trim()])));
        const get = (record: Record<string, string>, keys: string[]) => keys.map((key) => record[key]).find(Boolean) ?? "";
        let teacherCount = 0; let subjectCount = 0; let classCount = 0;
        const importedTeachers = normalized.map((record) => {
          const name = get(record, ["المعلم", "اسم المعلم", "teacher", "name"]);
          const subject = get(record, ["المادة", "المادة الدراسية", "subject"]);
          const load = Number(get(record, ["النصاب", "النصاب الأسبوعي", "load"])) || 0;
          if (!name) return null;
          teacherCount += 1;
          return { name, subject: subject || "غير محدد", load, unavailable: get(record, ["الأيام الممنوعة", "unavailable"]) || "—", free: get(record, ["الحصص الأوف", "free"]) || "—" };
        }).filter(Boolean) as typeof initialTeachers;
        const importedSubjects = normalized.map((record, index) => {
          const name = get(record, ["المادة", "المادة الدراسية", "subject"]);
          if (!name || normalized.slice(0, index).some((previous) => get(previous, ["المادة", "المادة الدراسية", "subject"]) === name)) return null;
          subjectCount += 1;
          return { name, weekly: Number(get(record, ["الحصص الأسبوعية", "weekly"])) || 2, sections: classes.length, tone: "sky" };
        }).filter(Boolean) as typeof initialSubjects;
        const importedClasses = normalized.map((record) => get(record, ["الفصل", "الصف", "class", "classname"])).filter((value, index, array) => value && array.indexOf(value) === index);
        classCount = importedClasses.length;
        const importedStages = Array.from(new Set(importedClasses.map((className) => className.split("/")[0]).filter(Boolean)));
        if (importedTeachers.length) setTeachers((current) => [...current.filter((item) => !importedTeachers.some((incoming) => incoming.name === item.name)), ...importedTeachers]);
        if (importedSubjects.length) setSubjects((current) => [...current.filter((item) => !importedSubjects.some((incoming) => incoming.name === item.name)), ...importedSubjects]);
        if (importedClasses.length) setClasses((current) => [...current, ...importedClasses.filter((item) => !current.includes(item))]);
        if (importedStages.length) {
          setStages((current) => Array.from(new Set([...current, ...importedStages])));
          setStageDailySlots((current) => Object.fromEntries(importedStages.reduce<[string, number][]>((entries, stage) => { entries.push([stage, current[stage] ?? timeSlots.length]); return entries; }, [...Object.entries(current)])));
          setStageStudyDays((current) => Object.fromEntries(importedStages.reduce<[string, string[]][]>((entries, stage) => { entries.push([stage, current[stage] ?? [...days]]); return entries; }, [...Object.entries(current)])));
        }
        setImportSummary(`تم استيراد ${teacherCount} معلماً، ${subjectCount} مادة، و${classCount} فصول من ${file.name}`);
        showToast("اكتمل استيراد البيانات من الملف");
      } catch {
        showToast("تعذر قراءة الملف — تأكد من صيغته");
      }
    };
    reader.readAsArrayBuffer(file);
    event.target.value = "";
  };

  const clearAllLocalData = () => {
    Object.values(STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
    setAssignments(initialAssignments);
    setTeachers(initialTeachers);
    setSubjects(initialSubjects);
    setClasses(["1/1", "1/2", "2/1", "2/2"]);
    setStages(["1", "2"]);
    setSchoolName("مدرسة النور الأهلية");
    setSchoolLogo(null);
    setTeacherGapLimits(defaultTeacherGapLimits());
    setTeacherSlotLimits(defaultTeacherSlotLimits());
    setStageDailySlots(defaultStageDailySlots());
    setStageStudyDays(defaultStageStudyDays());
    setTeacherAvailability(Object.fromEntries(initialTeachers.map((teacher) => [teacher.name, { teacher: teacher.name, unavailable: parseAvailability(teacher) }])));
    setSubjectRequirements([]);
    setSolverWeights(defaultSolverWeights);
    setCurriculumMode(false);
    setRooms(["مختبر 1", "قاعة الأنشطة"]);
    setRoomAvailability({});
    setImportSummary(null);
    setShowClearConfirm(false);
    showToast("تم مسح جميع البيانات المحلية وإعادة البيانات الافتراضية");
  };

  const downloadBackup = () => {
    const backup = {
      app: "مدرستي — نظام الجداول الذكي",
      version: 1,
      createdAt: new Date().toISOString(),
      data: { schoolName, stages, assignments, teachers, subjects, classes, schoolLogo, teacherGapLimits, teacherSlotLimits, stageDailySlots, stageStudyDays, teacherAvailability, subjectRequirements, solverWeights, curriculumMode, rooms, roomAvailability },
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `نسخة-احتياطية-مدرستي-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("تم تنزيل النسخة الاحتياطية بنجاح");
  };

  const handleRestoreBackup = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = BackupSchema.parse(JSON.parse(String(reader.result)));
        const data = parsed.data;
        setAssignments(data.assignments);
        setTeachers(data.teachers);
        setSubjects(data.subjects);
        setClasses(data.classes);
        setStages(data.stages?.length ? data.stages : Array.from(new Set(data.classes.map((item) => item.split("/")[0]))));
        setSchoolName(data.schoolName ?? "مدرسة النور الأهلية");
        setSchoolLogo(data.schoolLogo ?? null);
        setTeacherGapLimits(normalizeTeacherGapLimits(data.teacherGapLimits));
        setTeacherSlotLimits(normalizeTeacherSlotLimits(data.teacherSlotLimits));
        setStageDailySlots(data.stageDailySlots ?? defaultStageDailySlots());
        setStageStudyDays(data.stageStudyDays ?? defaultStageStudyDays());
        setTeacherAvailability(data.teacherAvailability ?? Object.fromEntries(initialTeachers.map((teacher) => [teacher.name, { teacher: teacher.name, unavailable: parseAvailability(teacher) }])));
        setSubjectRequirements(data.subjectRequirements ?? []);
        setSolverWeights({ ...defaultSolverWeights, ...(data.solverWeights ?? {}) });
        setCurriculumMode(Boolean(data.curriculumMode));
        setRooms(data.rooms ?? ["مختبر 1", "قاعة الأنشطة"]);
        setRoomAvailability(data.roomAvailability ?? {});
        showToast("تمت استعادة النسخة الاحتياطية وحفظها محلياً");
      } catch {
        showToast("تعذر استعادة الملف — اختر نسخة JSON صحيحة");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const addTeacher = () => {
    const name = newTeacher.trim();
    if (!name || teachers.some((teacher) => teacher.name.trim().toLowerCase() === name.toLowerCase())) { showToast("هذا المعلم موجود بالفعل"); return; }
    setTeachers((current) => [...current, { name, subject: "غير محدد", load: 0, unavailable: "—", free: "—" }]);
    setNewTeacher("");
    showToast("تمت إضافة المعلم إلى القائمة");
  };

  const addClass = () => {
    const name = newClass.trim();
    const [stage, section] = name.split("/");
    if (!name || !stage || !section || !stages.includes(stage)) {
      showToast("استخدم صيغة مثل 3/1 وتأكد أن المرحلة موجودة");
      return;
    }
    if (classes.includes(name)) { showToast("هذا الفصل موجود بالفعل"); return; }
    setClasses((current) => [...current, name]);
    setStageDailySlots((current) => ({ ...current, [stage]: current[stage] ?? timeSlots.length }));
    setStageStudyDays((current) => ({ ...current, [stage]: current[stage] ?? [...days] }));
    setNewClass("");
    showToast("تمت إضافة الفصل بنجاح");
  };

  const addSubject = () => {
    const name = newSubject.trim();
    if (!name || subjects.some((subject) => subject.name.trim().toLowerCase() === name.toLowerCase())) { showToast("هذه المادة موجودة بالفعل"); return; }
    setSubjects((current) => [...current, { name, weekly: 2, sections: classes.length, tone: "sky" }]);
    setNewSubject("");
    showToast("تمت إضافة المادة الدراسية");
  };

  const removeTeacher = (name: string) => {
    if (assignments.some((item) => item.teacher === name)) { showToast("لا يمكن حذف معلم لديه حصص موزعة — أعد توزيعها أولاً"); return; }
    setTeachers((current) => current.filter((teacher) => teacher.name !== name));
    setTeacherAvailability((current) => { const next = { ...current }; delete next[name]; return next; });
    setTeacherGapLimits((current) => { const next = { ...current }; delete next[name]; return next; });
    setTeacherSlotLimits((current) => { const next = { ...current }; delete next[name]; return next; });
    showToast(`تم حذف المعلم ${name}`);
  };

  const removeClass = (className: string) => {
    if (assignments.some((item) => item.className === className)) { showToast("لا يمكن حذف فصل لديه حصص موزعة — امسح الجدول أو أعد توزيع حصصه أولاً"); return; }
    setClasses((current) => current.filter((item) => item !== className));
    setSubjectRequirements((current) => current.filter((item) => item.className !== className));
    if (selectedClass === className) setSelectedClass(classes.find((item) => item !== className) ?? "");
    showToast(`تم حذف الفصل ${className}`);
  };

  const updateSubject = (name: string, weekly: number) => {
    setSubjects((current) => current.map((subject) => subject.name === name ? { ...subject, weekly: Math.min(20, Math.max(1, weekly || 1)) } : subject));
  };

  const removeSubject = (name: string) => {
    if (assignments.some((item) => item.subject === name || subjectLabel(item.subject) === subjectLabel(name))) { showToast("لا يمكن حذف مادة لديها حصص موزعة"); return; }
    setSubjects((current) => current.filter((subject) => subject.name !== name));
    setSubjectRequirements((current) => current.filter((item) => item.subject !== name && subjectLabel(item.subject) !== subjectLabel(name)));
    showToast(`تم حذف مادة ${name}`);
  };

  const addStage = () => {
    const name = newStage.trim();
    if (!name || name.includes("/")) { showToast("اكتب اسم مرحلة صالحاً بدون علامة /"); return; }
    if (stages.some((stage) => stage.toLowerCase() === name.toLowerCase())) { showToast("هذه المرحلة موجودة بالفعل"); return; }
    setStages((current) => [...current, name]);
    setStageDailySlots((current) => ({ ...current, [name]: timeSlots.length }));
    setStageStudyDays((current) => ({ ...current, [name]: [...days] }));
    setNewStage("");
    showToast(`تمت إضافة ${name}`);
  };

  const saveStageEdit = (oldName: string) => {
    const nextName = editingStageName.trim();
    if (!nextName || nextName.includes("/")) { showToast("اسم المرحلة لا يمكن أن يكون فارغاً أو يحتوي /"); return; }
    if (nextName !== oldName && stages.some((stage) => stage.toLowerCase() === nextName.toLowerCase())) { showToast("اسم المرحلة مستخدم بالفعل"); return; }
    setStages((current) => current.map((stage) => stage === oldName ? nextName : stage));
    setClasses((current) => current.map((className) => className.startsWith(`${oldName}/`) ? `${nextName}/${className.split("/").slice(1).join("/")}` : className));
    setAssignments((current) => current.map((item) => item.className.startsWith(`${oldName}/`) ? { ...item, className: `${nextName}/${item.className.split("/").slice(1).join("/")}` } : item));
    setStageDailySlots((current) => { const next = { ...current, [nextName]: current[oldName] ?? timeSlots.length }; delete next[oldName]; return next; });
    setStageStudyDays((current) => { const next = { ...current, [nextName]: current[oldName] ?? [...days] }; delete next[oldName]; return next; });
    if (selectedClass.startsWith(`${oldName}/`)) setSelectedClass(`${nextName}/${selectedClass.split("/").slice(1).join("/")}`);
    if (analyticsStage === oldName) setAnalyticsStage(nextName);
    setEditingStage(null);
    showToast(`تم تعديل المرحلة إلى ${nextName}`);
  };

  const removeStage = (stage: string) => {
    const stageClasses = classes.filter((className) => className.startsWith(`${stage}/`));
    if (stageClasses.length) { showToast(`لا يمكن حذف ${stage} قبل حذف فصولها (${stageClasses.length})`); return; }
    setStages((current) => current.filter((item) => item !== stage));
    setStageDailySlots((current) => { const next = { ...current }; delete next[stage]; return next; });
    setStageStudyDays((current) => { const next = { ...current }; delete next[stage]; return next; });
    showToast(`تم حذف ${stage}`);
  };

  const addRoom = () => {
    const name = newRoom.trim();
    if (!name) return;
    if (rooms.some((room) => room.toLowerCase() === name.toLowerCase())) { showToast("هذه القاعة موجودة بالفعل"); return; }
    setRooms((current) => [...current, name]);
    setNewRoom("");
    showToast("تمت إضافة القاعة");
  };

  const removeRoom = (room: string) => {
    setRooms((current) => current.filter((item) => item !== room));
    setRoomAvailability((current) => { const next = { ...current }; delete next[room]; return next; });
    setSubjectRequirements((current) => current.map((item) => item.room === room ? { ...item, room: undefined } : item));
    showToast(`تم حذف ${room}`);
  };

  const toggleRoomUnavailable = (room: string, day: string, slot: number, checked: boolean) => {
    setRoomAvailability((current) => {
      const list = current[room] ?? [];
      const exists = list.some((item) => item.day === day && item.slot === slot);
      const next = checked && !exists ? [...list, { day, slot }] : !checked ? list.filter((item) => !(item.day === day && item.slot === slot)) : list;
      return { ...current, [room]: next };
    });
  };

  const bulkDelete = (target: "teachers" | "classes" | "subjects" | "stages") => {
    if (assignments.length) {
      showToast("لا يمكن الحذف الجماعي مع وجود حصص موزعة — امسح بيانات الجدول أولاً");
      return;
    }
    if (target === "teachers") {
      setTeachers([]);
      setTeacherAvailability({});
      setTeacherGapLimits({});
      setTeacherSlotLimits({});
      setSelectedTeacher("");
    } else if (target === "classes") {
      setClasses([]);
      setSubjectRequirements([]);
      setSelectedClass("");
    } else if (target === "subjects") {
      setSubjects([]);
      setSubjectRequirements([]);
      setSelectedSubject("");
    } else {
      setStages([]);
      setStageDailySlots({});
      setStageStudyDays({});
      setClasses([]);
      setSubjectRequirements([]);
      setSelectedClass("");
      setAnalyticsStage("all");
      setAnalyticsClass("all");
    }
    setBulkDeleteTarget(null);
    showToast(target === "teachers" ? "تم حذف جميع المعلمين" : target === "classes" ? "تم حذف جميع الفصول" : target === "subjects" ? "تم حذف جميع المواد الدراسية" : "تم حذف جميع المراحل والفصول المرتبطة بها");
  };

  const clearScheduleOnly = () => {
    setAssignments([]);
    setLastSolverResult(null);
    setGapPreviewAssignments(null);
    setUndoAssignments(null);
    setConflict(null);
    setShowClearScheduleConfirm(false);
    showToast("تم مسح بيانات الجدول فقط مع الاحتفاظ بإعدادات المدرسة");
  };

  const renderSidebar = () => (
    <aside className={`sidebar-shell ${mobileMenu ? "is-open" : ""}`}>
      <div className="sidebar-brand">
        <div className="brand-mark"><Sparkles size={20} strokeWidth={2.2} /></div>
        <div>
          <div className="brand-name">مدرستي</div>
          <div className="brand-caption">نظام الجداول الذكي</div>
        </div>
      </div>
      <div className="sidebar-section-label">مساحة العمل</div>
      <nav className="sidebar-nav">
        {navItems.filter(({ key }) => key === "dashboard" || key === "schedule").map(({ key, label, icon: Icon }) => (
          <button key={key} className={`sidebar-nav-item ${activeNav === key ? "active" : ""}`} onClick={() => { goToNav(key); }}>
            <Icon size={18} strokeWidth={activeNav === key ? 2.4 : 1.8} />
            <span>{label}</span>
            {key === "schedule" && <span className="nav-count">{classes.length}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-section-label sidebar-section-label-spaced">البيانات</div>
      <nav className="sidebar-nav">
        {navItems.filter(({ key }) => key === "classes" || key === "teachers" || key === "subjects").map(({ key, label, icon: Icon }) => (
          <button key={key} className={`sidebar-nav-item ${activeNav === key ? "active" : ""}`} onClick={() => { goToNav(key); }}>
            <Icon size={18} strokeWidth={activeNav === key ? 2.4 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-section-label sidebar-section-label-spaced">المراجعة والمشاركة</div>
      <nav className="sidebar-nav">
        <button className={`sidebar-nav-item ${activeNav === "notifications" ? "active" : ""}`} onClick={() => { goToNav("notifications"); }}><SearchCheck size={18} /><span>المراجعة والتشخيص</span></button>
        <button className={`sidebar-nav-item ${activeNav === "exports" ? "active" : ""}`} onClick={() => { goToNav("exports"); }}><FileDown size={18} /><span>التصدير والطباعة</span></button>
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-bottom">
        <div className="tip-card">
          <div className="tip-icon"><WandSparkles size={16} /></div>
          <div>
            <div className="tip-title">نصيحة اليوم</div>
            <div className="tip-copy">وزّع المواد الثقيلة في بداية اليوم لرفع التركيز.</div>
          </div>
        </div>
        <button className={`sidebar-nav-item muted ${activeNav === "settings" ? "active" : ""}`} onClick={() => { goToNav("settings"); }}><Settings size={18} /><span>الإعدادات</span></button>
        <div className="user-profile">
          <div className="avatar">م</div>
          <div className="user-meta"><strong>مدير المدرسة</strong><span>{schoolName}</span></div>
        </div>
      </div>
    </aside>
  );

  const renderHeader = () => (
    <header className="topbar">
      <div className="topbar-start">
        <button className="mobile-menu-btn" onClick={() => setMobileMenu((open) => !open)} aria-label="فتح القائمة"><Menu size={21} /></button>
        <div className="breadcrumb"><span>مدرستي</span><ChevronLeft size={14} /><strong>{navItems.find((item) => item.key === activeNav)?.label ?? "لوحة التحكم"}</strong></div>
      </div>
      <div className="topbar-actions">
        <button
          className="icon-btn notification-btn"
          onClick={() => { goToNav("notifications"); }}
          aria-label="فتح الإشعارات"
          title="الإشعارات"
        >
          <Bell size={18} />
          <span />
        </button>
        <div className="topbar-divider" />
        <div className="storage-status" title={lastSaved ? `آخر حفظ: ${lastSaved.toLocaleString("ar-SA")}` : "جاري تفعيل الحفظ المحلي"}><span className="storage-status-dot" /><span>{lastSaved ? "محفوظ محلياً" : "جاري الحفظ..."}</span>{lastSaved && <small>{lastSaved.toLocaleDateString("ar-SA")} • {lastSaved.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</small>}</div>
      </div>
    </header>
  );

  const renderStats = () => (
    <div className="stats-grid">
      {stats.map(({ label, value, note, color, icon: Icon }) => (
        <div className={`stat-card stat-${color}`} key={label}>
          <div className="stat-topline"><span className="stat-label">{label}</span><div className="stat-icon"><Icon size={17} /></div></div>
          <div className="stat-value">{value}</div>
          <div className="stat-note"><span className="trend-dot" />{note}</div>
        </div>
      ))}
    </div>
  );

  const renderReadinessSummary = () => {
    const conflicts = Number(stats.find((stat) => stat.label === "التعارضات")?.value ?? 0);
    const missing = Number(stats.find((stat) => stat.label === "حصص غير موزعة")?.value ?? 0);
    const hardDiagnostics = diagnostics.filter((issue) => issue.severity === "hard").length;
    const warningDiagnostics = diagnostics.filter((issue) => issue.severity === "warning").length;
    const isBlocked = conflicts > 0 || hardDiagnostics > 0;
    const needsAttention = !isBlocked && (missing > 0 || warningDiagnostics > 0);
    const readinessStatus = isBlocked ? "blocked" : needsAttention ? "attention" : "ready";
    const problem = isBlocked ? "الجدول غير قابل للاعتماد الآن" : needsAttention ? "الجدول يحتاج مراجعة خفيفة" : "الجدول جاهز للاعتماد";
    const reason = isBlocked
      ? `${conflicts} تعارضات و${hardDiagnostics} مشاكل تمنع الاعتماد`
      : needsAttention
        ? `${missing} حصص غير موزعة و${warningDiagnostics} تنبيهات قابلة للتحسين`
        : `${assignments.length} حصة موزعة دون مؤشرات تمنع الاعتماد`;
    const action = isBlocked ? "فتح المراجعة" : needsAttention ? "مراجعة التنبيهات" : "عرض الملخص";
    return (
      <section className={`readiness-summary ${readinessStatus}`} role="status" aria-live="polite">
        <div className="readiness-mark"><span aria-hidden="true">{isBlocked ? "!" : needsAttention ? "…" : "✓"}</span></div>
        <div className="readiness-copy">
          <strong>{problem}</strong>
          <span>{reason}</span>
          <small>{isBlocked ? "ابدأ بالمشاكل الحمراء قبل التوليد أو الطباعة." : needsAttention ? "أكمل الحصص الناقصة أو حسّن الفراغات قبل مشاركة الجدول." : "يمكنك المتابعة إلى الطباعة أو التصدير بثقة."}</small>
        </div>
        <button className="readiness-action" onClick={() => { setPreflightOpen(true); goToNav("notifications"); }}>
          {action}
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
      </section>
    );
  };

  const renderMasterGrid = () => {
    const visibleAssignments = gapPreviewAssignments ?? assignments;
    const masterCell = (teacher: string, day: string, slot: number) => visibleAssignments.find((item) => item.teacher === teacher && item.day === day && item.slot === slot);
    return <div ref={masterGridRef} className="master-table-wrap"><div className="master-table-title"><strong>جدول الحصص الأسبوعي لعام ١٤٤٧ / ٢٠٢٦</strong><span>{schoolName}</span></div><div className="master-table-scroll"><table className="master-table"><thead><tr><th className="master-index-head">م</th><th className="master-teacher-head">اسم المعلم</th>{days.map((day) => <th className="master-day-group" colSpan={7} key={day}>{day}</th>)}<th className="master-notes-head">الملاحظات</th></tr><tr><th /><th />{days.flatMap((day) => timeSlots.slice().reverse().map(({ slot }) => <th className="master-slot-head" key={`${day}-${slot}`}>{slot}</th>))}<th /></tr></thead><tbody>{teachers.map((teacher, teacherIndex) => <tr key={teacher.name}><td className="master-index">{teacherIndex + 1}</td><th className="master-teacher">{teacher.name}</th>{days.flatMap((day) => timeSlots.slice().reverse().map(({ slot }) => { const item = masterCell(teacher.name, day, slot); return <td className={`master-cell ${item ? "filled" : ""}`} key={`${teacher.name}-${day}-${slot}`}>{item && <><strong>{subjectLabel(item.subject)}</strong><small>{item.className}</small></>}</td>; }))}<td className="master-notes">{teacher.unavailable !== "—" ? teacher.unavailable : ""}</td></tr>)}</tbody></table></div><div className="master-legend"><span><i className="legend-filled" />حصة موزعة</span><span><i className="legend-empty" />حصة فارغة</span><span>عرض موحد للطباعة — الصفوف للمعلمين والأعمدة للأيام والحصص</span></div></div>;
  };

  // Mobile timetable view - day tabs with stacked period lists
  const renderMobileTimetable = () => (
    <div className="mobile-timetable" role="region" aria-label="الجدول الأسبوعي - عرض الجوال">
      <div className="mobile-day-tabs" role="tablist" aria-label="أيام الأسبوع">
        {visibleDays.map((day, index) => (
          <button
            key={day}
            role="tab"
            aria-selected={mobileSelectedDayIndex === index}
            aria-controls={`mobile-day-panel-${day}`}
            id={`mobile-day-tab-${day}`}
            className={`mobile-day-tab ${mobileSelectedDayIndex === index ? "active" : ""}`}
            onClick={() => setMobileSelectedDayIndex(index)}
          >
            <span>{day}</span>
            <small>{day === "الأحد" ? "Sun" : day === "الإثنين" ? "Mon" : day === "الثلاثاء" ? "Tue" : day === "الأربعاء" ? "Wed" : "Thu"}</small>
          </button>
        ))}
      </div>
      {visibleDays.map((day, index) => (
        <div
          key={day}
          role="tabpanel"
          id={`mobile-day-panel-${day}`}
          aria-labelledby={`mobile-day-tab-${day}`}
          hidden={mobileSelectedDayIndex !== index}
          className="mobile-day-panel"
        >
          <div className="mobile-period-list">
            {timeSlots.map(({ slot, time }) => {
              const items = cellAssignments(day, slot);
              const isConflict = conflict?.day === day && conflict.slot === slot;
              const internalGap = isInternalGap(day, slot);
              return (
                <div
                  key={slot}
                  className={`mobile-period-item ${isConflict ? "conflict" : ""} ${internalGap ? "internal-gap" : ""}`}
                >
                  <div className="mobile-period-header">
                    <strong>حصة {slot}</strong>
                    <span>{time}</span>
                    {slot === 3 && <em>فسحة</em>}
                  </div>
                  {items.length === 0 ? (
                    <div
                      className={`mobile-empty-slot ${mobileMovingAssignment ? "drop-target" : ""}`}
                      onClick={() => handleMobileEmptySlotTap(day, slot)}
                      role="button"
                      tabIndex={0}
                      aria-label={mobileMovingAssignment ? `إفلات حصة ${subjectLabel(mobileMovingAssignment.subject)} هنا` : "خانة فارغة"}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleMobileEmptySlotTap(day, slot); } }}
                    >
                      <span>{internalGap ? "فراغ داخلي" : "—"}</span>
                      {internalGap && <small>اضغط لإضافة حصة</small>}
                      {mobileMovingAssignment && <small className="drop-hint">إفلات هنا</small>}
                    </div>
                  ) : (
                    <div className="mobile-assignments-stack">
                      {items.map((item) => {
                        const style = subjectStyles[item.subject] ?? subjectStyles.اجتماعيات;
                        const isPickedUp = mobileMovingAssignment?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            className={`mobile-assignment-card ${isPickedUp ? "picked-up" : ""}`}
                            style={{ backgroundColor: style.soft, borderColor: style.border }}
                            onClick={() => handleMobilePickup(item, day, slot)}
                            role="button"
                            tabIndex={0}
                            aria-label={isPickedUp ? `حصة ${subjectLabel(item.subject)} مختارة — اضغط مرة أخرى للإلغاء` : `التقاط حصة ${subjectLabel(item.subject)}`}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleMobilePickup(item, day, slot); } }}
                          >
                            <div className="mobile-assignment-title-row">
                              <strong style={{ color: style.strong }}>{subjectLabel(item.subject)}</strong>
                              <span className="class-pill">{item.className}</span>
                            </div>
                            <div className="mobile-assignment-teacher">
                              <UserRound size={12} />
                              {item.teacher}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {isConflict && <div className="mobile-conflict-bubble"><AlertTriangle size={13} />تعارض</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const renderScheduleCard = () => (
    <section className="schedule-panel panel-shadow">
      <div className="panel-header schedule-panel-header">
        <div>
          <div className="eyebrow"><span className="live-dot" />الجدول الحالي</div>
          <h2>المخطط الأسبوعي <span className="schedule-context">{viewTitle}</span></h2>
          <p>الفصل الدراسي الأول <span className="header-separator">•</span> آخر تحديث منذ 8 دقائق</p>
        </div>
        <div className="panel-header-actions">
          <button className="outline-btn" onClick={persistNow}><Save size={15} />حفظ الآن</button>
          <button className="outline-btn" onClick={activeView === "master" ? printMasterSchedule : printSchedule}><Printer size={15} />{activeView === "master" ? "طباعة الجدول العام A4" : "طباعة"}</button>
          {gapPreviewAssignments ? <><button className="outline-btn preview-apply-btn" onClick={applyGapPreview}><Check size={15} />تطبيق المعاينة</button><button className="outline-btn preview-cancel-btn" onClick={cancelGapPreview}>إلغاء المعاينة</button></> : <button className="outline-btn gap-fix-btn" onClick={autoFixInternalGaps}><ArrowDownUp size={15} />معالجة الفراغات</button>}
          {undoAssignments && !gapPreviewAssignments && <button className="outline-btn undo-gap-btn" onClick={undoLastChange}><Undo2 size={15} />تراجع</button>}
          {compressionReport.length > 0 && <button className="outline-btn report-btn" onClick={() => setShowCompressionReport(true)}><AlertTriangle size={15} />تقرير الضغط ({compressionReport.length})</button>}
          <button className="primary-btn compact" onClick={generateSmartSchedule} disabled={isGenerating}><WandSparkles size={16} />{isGenerating ? "جارٍ التوليد…" : "توليد ذكي"}</button>
        </div>
      </div>
      <div className="schedule-toolbar">
        <div className="view-tabs">
          {([ ["class", "حسب الفصل"], ["teacher", "حسب المعلم"], ["subject", "حسب المادة"], ["master", "الجدول الموحد"] ] as [ViewMode, string][]).map(([key, label]) => (
            <button key={key} className={`view-tab ${activeView === key ? "active" : ""}`} onClick={() => setActiveView(key)}>{label}</button>
          ))}
        </div>
        <div className="toolbar-controls">
          <label className="select-like day-filter"><span>{selectedDay === "all" ? "كل الأيام" : selectedDay}</span><select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}><option value="all">كل الأيام</option>{days.map((day) => <option key={day}>{day}</option>)}</select><ChevronDown size={14} /></label>
          {activeView === "class" && <label className="select-like"><span>{viewTitle}</span><select value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>{classes.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label>}
          {activeView === "teacher" && <label className="select-like"><span>{selectedTeacher}</span><select value={selectedTeacher} onChange={(event) => setSelectedTeacher(event.target.value)}>{teachers.map((item) => <option key={item.name}>{item.name}</option>)}</select><ChevronDown size={14} /></label>}
          {activeView === "subject" && <label className="select-like"><span>{subjectLabel(selectedSubject)}</span><select value={selectedSubject} onChange={(event) => setSelectedSubject(event.target.value)}>{subjects.map((item) => <option key={item.name} value={item.name}>{subjectLabel(item.name)}</option>)}</select><ChevronDown size={14} /></label>}

        </div>
      </div>
      <div className={`schedule-hint ${gapPreviewAssignments ? "preview-hint" : ""}`}><GripVertical size={15} /><span>{gapPreviewAssignments ? "هذه معاينة مؤقتة — طبّقها أو ألغها قبل متابعة التعديل" : "اسحب أي حصة إلى خلية أخرى لتعديلها يدوياً"}</span><span className="hint-badge"><Check size={12} />كشف التعارضات مفعّل</span><span className="hint-badge compact-hint"><Check size={12} />الفراغات تُترك لنهاية اليوم</span></div>
      {conflict && <div role="alert" className="conflict-alert" aria-live="assertive"><AlertTriangle size={14} /><span>تعارض في {conflict.day}، الحصة {conflict.slot}: {conflict.message}</span><button className="conflict-alert-dismiss" onClick={() => setConflict(null)} aria-label="إخفاء التنبيه"><X size={14} /></button></div>}
      {lastSolverResult && <div className={`solver-status ${lastSolverResult.complete ? "solver-success" : "solver-partial"}`}><span>{lastSolverResult.complete ? "✓ حل كامل" : "! حل جزئي"}</span><span>{lastSolverResult.placed} موزعة</span><span>{lastSolverResult.unplaced} غير موزعة</span><span>{lastSolverResult.hardViolations} تعارضات صلبة</span><span>كلفة {lastSolverResult.softPenalty}</span><span>{lastSolverResult.exploredNodes.toLocaleString("ar-EG")} عقدة / {lastSolverResult.durationMs}ms</span></div>}
      {optimizationSummary && <div className="optimization-summary"><div><strong>تحسين الجدول</strong><span>قبل {optimizationSummary.beforeQuality}/100 → بعد {optimizationSummary.afterQuality}/100</span></div><div><b>{optimizationSummary.moves}</b><small>تحسينات</small></div><div><b>{Math.max(0, optimizationSummary.before - optimizationSummary.after)}</b><small>انخفاض في الكلفة</small></div><div><b>{optimizationSummary.durationMs}ms</b><small>زمن التنفيذ</small></div></div>}

      {activeView === "master" ? renderMasterGrid() : isMobile ? renderMobileTimetable() : (
        <div className="schedule-scroll">
          <div ref={scheduleGridRef} className="timetable-grid" role="grid" aria-label="الجدول الأسبوعي">
            <div className="grid-corner"><CalendarDays size={16} /><span>الحصة / اليوم</span></div>
            {visibleDays.map((day) => <div className="day-header" key={day}><span>{day}</span><small>{day === "الأحد" ? "Sun" : day === "الإثنين" ? "Mon" : day === "الثلاثاء" ? "Tue" : day === "الأربعاء" ? "Wed" : "Thu"}</small></div>)}
            {timeSlots.map(({ slot, time }) => (
              <div className="grid-row" key={slot} role="row">
                <div className="period-label"><strong>{slot}</strong><span>{time}</span>{slot === 3 && <em>فسحة</em>}</div>
                {visibleDays.map((day) => {
                  const items = cellAssignments(day, slot);
                  const isConflict = conflict?.day === day && conflict.slot === slot;
                  const preview = dragPreview?.day === day && dragPreview.slot === slot ? dragPreview : null;
                  const internalGap = isInternalGap(day, slot);
                  const isFocused = keyboardFocus?.day === day && keyboardFocus?.slot === slot;
                  const isGrabbed = isKeyboardMoving && keyboardMovingAssignment && keyboardFocus?.day === day && keyboardFocus?.slot === slot;
                  return (
                    <div
                      key={`${day}-${slot}`}
                      className={`schedule-cell ${isConflict ? "conflict-cell" : ""} ${internalGap ? "internal-gap-cell" : ""} ${preview ? (preview.valid ? "drop-valid" : "drop-invalid") : ""} ${isFocused ? "keyboard-focused" : ""} ${isGrabbed ? "keyboard-grabbed" : ""}`}
                      role="gridcell"
                      tabIndex={0}
                      aria-selected={isFocused}
                      aria-grabbed={isGrabbed ? "true" : "false"}
                      aria-label={`${day}، الحصة ${slot}${items.length > 0 ? `، ${items.length} حصة${items.length > 1 ? "ص" : ""}` : internalGap ? "، فراغ داخلي" : "، فارغة"}`}
                      onKeyDown={(event) => handleKeyboardNavigation(event, day, slot, items)}
                      onDragOver={(event) => { event.preventDefault(); handleDragEnter(day, slot); }}
                      onDragEnter={() => handleDragEnter(day, slot)}
                      onDrop={() => handleDrop(day, slot)}
                    >
                      {items.length === 0 ? <div className={`empty-slot ${internalGap ? "internal-gap" : ""}`}><span>{internalGap ? "فراغ داخلي" : "—"}</span>{internalGap && <small>اسحب حصة إلى هنا</small>}</div> : <div className="assignments-stack">{items.map((item) => {
                        const style = subjectStyles[item.subject] ?? subjectStyles.اجتماعيات;
                        return <div key={item.id} draggable={!gapPreviewAssignments} onDragStart={() => !gapPreviewAssignments && setDraggedId(item.id)} onDragEnd={() => { setDraggedId(null); clearDragPreview(); }} className={`assignment-card ${draggedId === item.id ? "is-dragging" : ""}`} style={{ backgroundColor: style.soft, borderColor: style.border }}>
                          <div className="assignment-title-row"><strong style={{ color: style.strong }}>{subjectLabel(item.subject)}</strong><span className="class-pill">{item.className}</span></div>
                          <div className="assignment-teacher"><UserRound size={12} />{item.teacher}</div>
                        </div>;
                      })}</div>}
                      {preview && <div className={`drop-hint ${preview.valid ? "valid" : "invalid"}`}><span>{preview.valid ? "متاح" : "ممنوع"}</span><small>{preview.valid ? "يمكن وضع الحصة هنا" : preview.reason}</small></div>}
                      {isConflict && <div className="conflict-bubble"><AlertTriangle size={13} />تعارض</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="schedule-footer"><span><span className="footer-dot success" />تم توزيع {assignments.length} حصة</span><span><span className="footer-dot warning" />{compressionReport.length ? `${compressionReport.length} فصول قابلة للتحسين` : "لا توجد حالات ضغط ظاهرة"}</span><button className="text-btn" onClick={() => goToNav("exports")}>عرض خيارات التصدير <ArrowUpLeft size={14} /></button></div>
    </section>
  );

  const renderDashboard = () => (
    <>
      <section className="workspace-header">
        <div>
          <div className="eyebrow"><CalendarDays size={14} />مساحة العمل اليومية</div>
          <h1>لوحة التحكم</h1>
          <p>أنشئ الجدول، راجع التوزيع، وعالج التعارضات من مكان واحد.</p>
        </div>
        <div className="workspace-header-actions"><button className="outline-btn" onClick={() => setShowQuickAdd(true)}><Plus size={16} />إضافة بيانات</button><button className="primary-btn" onClick={generateSmartSchedule} disabled={isGenerating}><WandSparkles size={16} />{isGenerating ? "جارٍ التوليد…" : "توليد جدول ذكي"}</button></div>
      </section>
      {renderStats()}
      {renderReadinessSummary()}
      {renderScheduleCard()}
      <div className="dashboard-tabs panel-shadow">
        <button className={dashboardTab === "overview" ? "active" : ""} onClick={() => setDashboardTab("overview")}><LayoutDashboard size={15} />نظرة عامة</button>
        <button className={dashboardTab === "analytics" ? "active" : ""} onClick={() => setDashboardTab("analytics")}><SearchCheck size={15} />التحليلات والتنبيهات</button>
      </div>
      {dashboardTab === "analytics" && <section className="saved-summary-panel panel-shadow">
        <div className="saved-summary-heading"><div><div className="eyebrow"><span className="storage-status-dot" />ملخص البيانات المحفوظة</div><h2>نظرة سريعة على مدرستك</h2><p>الأرقام والمخططات التالية تتغير حسب الفلاتر المحددة.</p></div><div className="saved-summary-time"><Clock3 size={14} />{lastSaved ? `آخر حفظ ${lastSaved.toLocaleDateString("ar-SA")} — ${lastSaved.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}` : "لم يتم الحفظ بعد"}</div></div>
        <div className="analytics-filters"><div className="analytics-filter-label"><SlidersHorizontal size={14} />تصفية الإحصائيات</div><label><span>المرحلة</span><select value={analyticsStage} onChange={(event) => { setAnalyticsStage(event.target.value); setAnalyticsClass("all"); }}><option value="all">كل المراحل</option>{stages.map((stage) => <option key={stage} value={stage}>المرحلة {stage}</option>)}</select></label><label><span>الصف / الفصل</span><select value={analyticsClass} onChange={(event) => setAnalyticsClass(event.target.value)}><option value="all">كل الفصول</option>{classes.filter((item) => analyticsStage === "all" || item.startsWith(`${analyticsStage}/`)).map((item) => <option key={item} value={item}>الفصل {item}</option>)}</select></label><button className="filter-reset-btn" onClick={() => { setAnalyticsStage("all"); setAnalyticsClass("all"); }}><RefreshCw size={13} />إعادة ضبط</button></div>
        <div className="saved-summary-grid"><div className="saved-summary-card"><div className="saved-summary-icon teachers"><Users size={18} /></div><div><strong>{analyticsTeacherData.length}</strong><span>المعلمون</span></div><small>ضمن التصفية</small></div><div className="saved-summary-card"><div className="saved-summary-icon classes"><School size={18} /></div><div><strong>{analyticsClass === "all" ? classes.length : 1}</strong><span>الفصول</span></div><small>ضمن التصفية</small></div><div className="saved-summary-card"><div className="saved-summary-icon subjects"><BookOpen size={18} /></div><div><strong>{analyticsSubjectData.length}</strong><span>المواد الدراسية</span></div><small>لها حصص موزعة</small></div><div className="saved-summary-card"><div className="saved-summary-icon lessons"><CalendarDays size={18} /></div><div><strong>{filteredAnalyticsAssignments.length}</strong><span>الحصص الموزعة</span></div><small>في النطاق المحدد</small></div></div>
        <div className="schedule-quality-card">
          <div className="schedule-quality-head">
            <div><div className="eyebrow"><ShieldCheck size={13} /> تقييم جودة الجدول</div><h3>{scheduleQuality.overall}/100 <span>{scheduleQuality.overall >= 90 ? "ممتاز" : scheduleQuality.overall >= 75 ? "جيد" : scheduleQuality.overall >= 55 ? "يحتاج تحسين" : "يحتاج مراجعة"}</span></h3><p>درجة تفسيرية تجمع صحة الجدول واكتماله وتوازن المعلمين والفصول واستغلال الفترات.</p></div>
            <div className="quality-ring"><strong>{scheduleQuality.overall}</strong><small>من 100</small></div>
          </div>
          <div className="quality-bars">
            {[["الصحة والتعارضات", scheduleQuality.conflicts], ["اكتمال التوزيع", scheduleQuality.completion], ["تماسك الفصول", scheduleQuality.classCohesion], ["توازن المعلمين", scheduleQuality.teacherBalance], ["توازن الأيام", scheduleQuality.dayBalance], ["استغلال الفترات", scheduleQuality.schoolUtilization], ["التفضيلات", scheduleQuality.preferences]].map(([label, value]) => <div className="quality-bar-row" key={String(label)}><span>{label}</span><div><i style={{ width: `${value}%` }} /></div><b>{value}%</b></div>)}
          </div>
        </div>
        <div className="analytics-alerts"><div className="analytics-subheading"><div><strong>التنبيهات الفورية</strong><span>تُحدّث تلقائياً مع كل تغيير في الجدول</span></div><span className={analyticsConflicts || analyticsUnassigned || analyticsInternalGaps ? "alert-count warning" : "alert-count success"}>{analyticsConflicts + analyticsUnassigned + analyticsInternalGaps} تنبيهات</span></div><div className="alert-list"><div className={`analytics-alert-item ${analyticsUnassigned ? "warning" : "success"}`}><div>{analyticsUnassigned ? <AlertTriangle size={16} /> : <Check size={16} />}</div><span>{analyticsUnassigned ? `${analyticsUnassigned} حصص تحتاج إلى توزيع ضمن النطاق المحدد` : "لا توجد حصص غير موزعة ضمن النطاق المحدد"}</span></div><div className={`analytics-alert-item ${analyticsConflicts ? "warning" : "success"}`}><div>{analyticsConflicts ? <AlertTriangle size={16} /> : <Check size={16} />}</div><span>{analyticsConflicts ? `${analyticsConflicts} تعارضات محتملة بين المعلمين أو الفصول` : "لا توجد تعارضات محتملة في الجدول الحالي"}</span></div><div className={`analytics-alert-item ${analyticsInternalGaps ? "warning" : "success"}`}><div>{analyticsInternalGaps ? <AlertTriangle size={16} /> : <Check size={16} />}</div><span>{analyticsInternalGaps ? `${analyticsInternalGaps} فراغات داخلية — يفضّل نقلها إلى نهاية اليوم` : "لا توجد فراغات داخلية بين الحصص"}</span></div></div></div>
        <div className="charts-grid"><div className="chart-card"><div className="chart-heading"><div><strong>الحصص حسب المعلم</strong><span>التوزيع في النطاق المحدد</span></div><Users size={16} /></div><div className="chart-area">{analyticsTeacherData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsTeacherData} layout="vertical" margin={{ top: 4, right: 10, left: 8, bottom: 0 }}><CartesianGrid stroke="#eeeaf4" horizontal={false} /><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#aaa5b2", fontSize: 8 }} /><YAxis type="category" dataKey="name" width={52} axisLine={false} tickLine={false} tick={{ fill: "#6f6a7b", fontSize: 8 }} /><ChartTooltip cursor={{ fill: "#f8f6ff" }} contentStyle={{ border: "1px solid #e8e2ff", borderRadius: 8, fontSize: 10 }} formatter={(value) => [`${value} حصص`, "التوزيع"]} /><Bar dataKey="حصص" radius={[0, 5, 5, 0]} barSize={13} fill="#7255d8" /></BarChart></ResponsiveContainer> : <div className="chart-empty">لا توجد حصص في هذا النطاق</div>}</div></div><div className="chart-card"><div className="chart-heading"><div><strong>الحصص حسب المادة</strong><span>مقارنة التوزيع الأسبوعي</span></div><BookOpen size={16} /></div><div className="chart-area">{analyticsSubjectData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsSubjectData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}><CartesianGrid stroke="#eeeaf4" vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#6f6a7b", fontSize: 8 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#aaa5b2", fontSize: 8 }} /><ChartTooltip cursor={{ fill: "#f8f6ff" }} contentStyle={{ border: "1px solid #e8e2ff", borderRadius: 8, fontSize: 10 }} formatter={(value) => [`${value} حصص`, "التوزيع"]} /><Bar dataKey="حصص" radius={[5, 5, 0, 0]} barSize={22}>{analyticsSubjectData.map((entry, index) => <Cell key={entry.name} fill={["#7255d8", "#1fa59b", "#dfa645", "#d87999", "#67b2c7", "#b8a044"][index % 6]} />)}</Bar></BarChart></ResponsiveContainer> : <div className="chart-empty">لا توجد حصص في هذا النطاق</div>}</div></div></div>
        <div className="gap-report-panel"><div className="analytics-subheading"><div><strong>تقرير الفراغات الداخلية</strong><span>ترتيب تفصيلي حسب النطاق المحدد</span></div><span className="report-caption"><AlertTriangle size={13} />{analyticsInternalGaps ? `${analyticsInternalGaps} فراغات تحتاج مراجعة` : "الجدول متماسك"}</span></div><div className="gap-report-grid"><div><div className="report-title"><Users size={14} />أكثر المعلمين فراغاً</div>{analyticsGapReports.teacherReport.length ? analyticsGapReports.teacherReport.slice(0, 5).map((item, index) => <div className="gap-report-row" key={item.name}><span className="report-rank">{index + 1}</span><span>{item.name}</span><strong>{item.gaps} فراغ</strong></div>) : <div className="report-empty">لا توجد فراغات داخلية للمعلمين</div>}</div><div><div className="report-title"><School size={14} />أكثر الفصول فراغاً</div>{analyticsGapReports.classReport.length ? analyticsGapReports.classReport.slice(0, 5).map((item, index) => <div className="gap-report-row" key={item.name}><span className="report-rank">{index + 1}</span><span>الفصل {item.name}</span><strong>{item.gaps} فراغ</strong></div>) : <div className="report-empty">لا توجد فراغات داخلية للفصول</div>}</div></div></div>
      </section>}
      {dashboardTab === "overview" && <section className="dashboard-overview-grid">
        <button className="dashboard-action-card" onClick={() => goToNav("schedule")}><CalendarDays size={22} /><span><strong>فتح الجداول</strong><small>عرض وتعديل الجدول بالسحب والإفلات</small></span><ChevronLeft size={17} /></button>
        <button className="dashboard-action-card" onClick={() => goToNav("classes")}><School size={22} /><span><strong>إدارة الفصول</strong><small>{classes.length} فصول مرتبطة بـ {stages.length} مراحل</small></span><ChevronLeft size={17} /></button>
        <button className="dashboard-action-card" onClick={() => goToNav("settings")}><Settings size={22} /><span><strong>إعدادات المدرسة</strong><small>اسم المدرسة والمراحل والقيود</small></span><ChevronLeft size={17} /></button>
      </section>}
    </>
  );

  const renderTeachers = () => (
    <section className="page-section">
      <div className="page-heading"><div><div className="eyebrow">إدارة البيانات</div><h1>المعلمون والنصاب</h1><p>أدر النصاب الأسبوعي والأيام الممنوعة والحصص الأوف وحدد الحد الأقصى للفراغات لكل معلم.</p></div><div className="page-heading-actions"><button className="danger-outline-btn" onClick={() => setBulkDeleteTarget("teachers")} disabled={!teachers.length}><Trash2 size={15} />حذف جميع المعلمين</button><button className="primary-btn" onClick={() => document.getElementById("teacher-add")?.focus()}><Plus size={16} />إضافة معلم</button></div></div>
      <div className="data-entry-bar"><label htmlFor="teacher-add" className="input-with-icon"><UserRound size={16} /><input id="teacher-add" value={newTeacher} onChange={(event) => setNewTeacher(event.target.value)} placeholder="اسم المعلم الجديد" onKeyDown={(event) => event.key === "Enter" && addTeacher()} /></label><button className="outline-btn" onClick={addTeacher}>إضافة إلى القائمة</button></div>
      <div className="data-table-card panel-shadow"><div className="table-toolbar"><span className="table-count">{teachers.length} معلمين نشطين</span><span className="table-toolbar-note">البيانات المعروضة كاملة</span></div><div className="table-scroll"><table className="data-table"><thead><tr><th>المعلم</th><th>المادة</th><th>النصاب الأسبوعي</th><th>الأيام الممنوعة</th><th>الحصص الأوف</th><th>الحد الأقصى للفراغات</th><th /></tr></thead><tbody>{teachers.map((teacher) => <tr key={teacher.name}><td><div className="person-cell"><div className="avatar small-avatar">{teacher.name.slice(0, 1)}</div><strong>{teacher.name}</strong></div></td><td>{teacher.subject}</td><td><span className="load-badge">{teacher.load} حصة</span></td><td>{teacher.unavailable}</td><td>{teacher.free}</td><td><div className="daily-gap-controls">{days.map((day) => <label key={day} title={`${day} — الحد الأقصى للفراغات`}><span>{day.slice(0, 1)}</span><input aria-label={`${teacher.name} — ${day}`} type="number" min="0" max="6" value={getTeacherGapLimit(teacherGapLimits, teacher.name, day)} onChange={(event) => setTeacherGapLimits((current) => ({ ...current, [teacher.name]: { ...(current[teacher.name] ?? {}), [day]: Math.min(6, Math.max(0, Number(event.target.value) || 0)) } }))} /></label>)}</div></td><td><div className="row-actions"><button className="row-more" title="فتح جدول المعلم" onClick={() => { setSelectedTeacher(teacher.name); setActiveView("teacher"); goToNav("schedule"); }}><CalendarDays size={15} /></button><button className="danger-outline-btn" title="حذف المعلم" onClick={() => removeTeacher(teacher.name)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div></div>
      <div className="slot-limits-panel panel-shadow"><div className="slot-limits-heading"><div><div className="eyebrow">قيود دقيقة</div><h2>حدود الفراغات حسب الحصة</h2><p>استخدم -1 لوراثة حد اليوم، أو حدد قيمة خاصة لكل حصة.</p></div><div className="day-pills">{days.map((day) => <button key={day} className={slotSettingsDay === day ? "active" : ""} onClick={() => setSlotSettingsDay(day)}>{day}</button>)}</div></div><div className="template-library"><div className="template-library-heading"><div><strong>قوالب جاهزة</strong><span>طبّق سياسة شائعة على معلم واحد بسرعة</span></div><select value={templateTeacher} onChange={(event) => setTemplateTeacher(event.target.value)}>{teachers.map((teacher) => <option key={teacher.name} value={teacher.name}>{teacher.name}</option>)}</select></div><div className="template-cards">{gapConstraintTemplates.map((template) => <button className="template-card" key={template.id} onClick={() => applyGapTemplate(template.id)}><div className="template-card-icon"><WandSparkles size={14} /></div><div><strong>{template.name}</strong><span>{template.description}</span></div><ChevronLeft size={14} /></button>)}</div></div><div className="slot-limits-grid">{teachers.map((teacher) => <div className="slot-limit-row" key={teacher.name}><strong>{teacher.name}</strong>{timeSlots.map(({ slot }) => <label key={slot}><span>ح{slot}</span><input type="number" min="-1" max="6" value={getTeacherSlotLimit(teacherSlotLimits, teacher.name, slotSettingsDay, slot)} onChange={(event) => setTeacherSlotLimits((current) => ({ ...current, [teacher.name]: { ...(current[teacher.name] ?? {}), [slotSettingsDay]: { ...(current[teacher.name]?.[slotSettingsDay] ?? {}), [slot]: Math.min(6, Math.max(-1, Number(event.target.value) || -1)) } } }))} /></label>)}</div>)}</div></div>
    </section>
  );

  const renderClasses = () => (
    <section className="page-section"><div className="page-heading"><div><div className="eyebrow">الهيكل الأكاديمي</div><h1>الفصول الدراسية</h1><p>أنشئ الفصول واربطها بالمراحل وعدد الطلاب والمواد المطلوبة.</p></div><div className="page-heading-actions"><button className="danger-outline-btn" onClick={() => setBulkDeleteTarget("classes")} disabled={!classes.length}><Trash2 size={15} />حذف جميع الفصول</button><button className="primary-btn" onClick={() => document.getElementById("class-add")?.focus()}><Plus size={16} />إضافة فصل</button></div></div><div className="data-entry-bar"><label htmlFor="class-add" className="input-with-icon"><School size={16} /><input id="class-add" value={newClass} onChange={(event) => setNewClass(event.target.value)} placeholder="مثال: 3/1" onKeyDown={(event) => event.key === "Enter" && addClass()} /></label><button className="outline-btn" onClick={addClass}>إضافة إلى القائمة</button></div><div className="class-cards-grid">{classes.map((className, index) => <div className="class-card panel-shadow" key={className}><div className="class-card-top"><div className={`class-icon class-tone-${index % 4}`}><School size={19} /></div><div className="row-actions"><button className="row-more" title="فتح جدول الفصل" onClick={() => { setSelectedClass(className); setActiveView("class"); goToNav("schedule"); }}><CalendarDays size={15} /></button><button className="danger-outline-btn" title="حذف الفصل" onClick={() => removeClass(className)}><Trash2 size={14} /></button></div></div><h3>الفصل {className}</h3><p>المرحلة {className.split("/")[0]} <span>•</span> شعبة {className.split("/").slice(1).join("/")}</p><div className="class-card-bottom"><span>{assignments.filter((item) => item.className === className).length || 0} حصص موزعة</span><ChevronLeft size={15} /></div><button className="reorder-class-btn" onClick={() => reorderClassSchedule(className)}><ArrowDownUp size={13} />إعادة ترتيب اليوم</button></div>)}</div></section>
  );

  const renderSubjects = () => (
    <section className="page-section"><div className="page-heading"><div><div className="eyebrow">المحتوى الدراسي</div><h1>المواد الدراسية</h1><p>حدد عدد الحصص الأسبوعية لكل مادة ولكل فصل دراسي.</p></div><div className="page-heading-actions"><button className="danger-outline-btn" onClick={() => setBulkDeleteTarget("subjects")} disabled={!subjects.length}><Trash2 size={15} />حذف جميع المواد</button><button className="primary-btn" onClick={() => document.getElementById("subject-add")?.focus()}><Plus size={16} />إضافة مادة</button></div></div><div className="data-entry-bar"><label htmlFor="subject-add" className="input-with-icon"><BookOpen size={16} /><input id="subject-add" value={newSubject} onChange={(event) => setNewSubject(event.target.value)} placeholder="اسم المادة الجديدة" onKeyDown={(event) => event.key === "Enter" && addSubject()} /></label><button className="outline-btn" onClick={addSubject}>إضافة إلى القائمة</button></div><div className="subject-grid">{subjects.map((subject) => <div className="subject-card panel-shadow" key={subject.name}><div className={`subject-accent tone-${subject.tone}`} /><div className="subject-card-content"><div className="subject-card-head"><div className={`subject-symbol tone-${subject.tone}`}><BookOpen size={17} /></div><div className="row-actions"><button className="row-more" title="فتح جدول المادة" onClick={() => { setSelectedSubject(subject.name); setActiveView("subject"); goToNav("schedule"); }}><CalendarDays size={15} /></button><button className="danger-outline-btn" title="حذف المادة" onClick={() => removeSubject(subject.name)}><Trash2 size={14} /></button></div></div><h3>{subject.name}</h3><div className="subject-metrics"><label><input className="metric-number-input" type="number" min="1" max="20" value={subject.weekly} onChange={(event) => updateSubject(subject.name, Number(event.target.value))} /><span>حصص / أسبوع</span></label><div><strong>{classes.length}</strong><span>فصول مرتبطة</span></div></div><div className="subject-progress"><span style={{ width: `${Math.min(100, subject.weekly * 16 + 12)}%` }} /></div></div></div>)}</div></section>
  );

  const renderExports = () => (
    <section className="page-section"><div className="page-heading"><div><div className="eyebrow">مشاركة واعتماد</div><h1>التصدير والطباعة</h1><p>جهّز الجداول للاعتماد، أضف شعار المدرسة، أو شاركها مع فريق المدرسة.</p></div><div className="export-heading-actions"><button className="outline-btn" onClick={printSchedule}><Printer size={16} />معاينة الطباعة</button><button className="primary-btn" onClick={printAllTeachers}><Printer size={16} />طباعة كل المعلمين</button></div></div><div className="export-hero panel-shadow"><div className="export-hero-icon"><FileDown size={24} /></div><div><h2>كل جداولك، في ملف واحد</h2><p>اختر الصيغة المناسبة، وأضف ترويسة المدرسة قبل التصدير.</p></div><div className="export-status"><Check size={15} />الجدول جاهز للتصدير</div></div><div className="export-grid"><button className="export-card" onClick={downloadCsv}><div className="export-icon csv"><FileText size={22} /></div><div><strong>CSV</strong><span>بيانات مسطحة للتحليل</span></div><Download size={16} /></button><button className="export-card" onClick={downloadExcel}><div className="export-icon excel"><FileSpreadsheet size={22} /></div><div><strong>Excel</strong><span>ملف منسق لكل فصل</span></div><Download size={16} /></button><button className="export-card" onClick={exportPdf}><div className="export-icon pdf"><FileText size={22} /></div><div><strong>PDF</strong><span>مع الشعار والترويسة</span></div><Download size={16} /></button><button className="export-card" onClick={printAllTeachers}><div className="export-icon image"><ImageIcon size={22} /></div><div><strong>جداول المعلمين</strong><span>صفحة PDF منفصلة لكل معلم</span></div><Download size={16} /></button></div><div className="logo-import-bar panel-shadow"><div className="logo-preview">{schoolLogo ? <img src={schoolLogo} alt="شعار المدرسة" /> : <School size={22} />}</div><div className="logo-copy"><strong>شعار المدرسة</strong><span>{schoolLogo ? "تم رفع الشعار — سيظهر في كل صفحات PDF" : "ارفع صورة PNG أو JPG لتظهر في الترويسة"}</span></div><input ref={importInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} /><input ref={backupInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={handleRestoreBackup} /><input className="hidden-file-input" id="logo-file" type="file" accept="image/png,image/jpeg" onChange={handleLogoUpload} /><label className="outline-btn file-label" htmlFor="logo-file"><ImageIcon size={15} />{schoolLogo ? "استبدال الشعار" : "رفع الشعار"}</label><button className="outline-btn" onClick={() => importInputRef.current?.click()}><FileSpreadsheet size={15} />استيراد Excel / CSV</button><button className="outline-btn" onClick={downloadBackup}><Download size={15} />تنزيل نسخة JSON</button><button className="outline-btn" onClick={() => backupInputRef.current?.click()}><RefreshCw size={15} />استعادة نسخة</button><button className="danger-outline-btn" onClick={() => setShowClearConfirm(true)}><X size={15} />مسح التخزين المحلي</button>{importSummary && <span className="import-summary"><Check size={13} />{importSummary}</span>}</div><div className="print-options panel-shadow"><div className="print-options-head"><div><h3>خيارات الترويسة</h3><p>تظهر هذه البيانات في أعلى كل صفحة مطبوعة.</p></div><button className="outline-btn" onClick={persistNow}><Save size={15} />حفظ الإعدادات</button></div><div className="print-fields"><label>اسم المدرسة<input value={schoolName} onChange={(event) => setSchoolName(event.target.value)} /></label><label>الفصل الدراسي<input defaultValue="الفصل الدراسي الأول 1447 هـ" /></label><label>ملاحظات الترويسة<input defaultValue="الجدول الأسبوعي المعتمد" /></label></div></div></section>
  );

const renderSettings = () => {
    const stageList = [...stages].sort((a, b) => a.localeCompare(b, "ar", { numeric: true }));
    const toggleUnavailable = (teacher: string, day: string, slot: number, checked: boolean) => setTeacherAvailability((current) => { const currentTeacher = current[teacher] ?? { teacher, unavailable: [] }; const unavailable = currentTeacher.unavailable ?? []; const exists = unavailable.some((item) => item.day === day && item.slot === slot); const next = checked && !exists ? [...unavailable, { day, slot }] : !checked ? unavailable.filter((item) => !(item.day === day && item.slot === slot)) : unavailable; return { ...current, [teacher]: { ...currentTeacher, unavailable: next } }; });
    const updateRequirement = (index: number, patch: Partial<SubjectRequirement>) => setSubjectRequirements((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    const ensureRequirements = () => { const teacherBySubject = Object.fromEntries(teachers.map((teacher) => [teacher.subject, teacher.name])); const generated = buildCurriculumRequirements(classes, subjects.map((subject) => ({ name: subject.name, weekly: subject.weekly })), teacherBySubject); setSubjectRequirements(generated); showToast(`تم إنشاء ${generated.length} متطلباً من المنهج`); };
    const weightLabels: Array<[keyof SolverWeights, string, string]> = [["internalClassGap", "تماسك جدول الفصل", "تقليل الفراغات الداخلية"],["teacherGap", "تماسك جدول المعلم", "تقليل الفراغات بين حصص المعلم"],["sameSubjectSameDay", "تكرار المادة في اليوم", "يفضل توزيع المادة على أيام مختلفة"],["subjectSpacing", "تباعد حصص المادة", "تحسين المسافات بين حصص المادة"],["dailyLoadImbalance", "توازن الحمل اليومي", "توزيع الحصص بالتساوي على أيام الدراسة الفعلية"],["teacherLoadImbalance", "توازن حمل المعلم", "تقليل تفاوت نصاب المعلم بين الأيام"],["preferenceMiss", "التفضيلات غير المحققة", "عقوبة مخالفة الأيام أو الحصص المفضلة"],["roomChange", "تبديل القاعات", "تقليل انتقال المعلم بين قاعات مختلفة في اليوم"],["schoolSlotCoverage", "امتلاء الحصص على مستوى المدرسة", "يفضل تجميع الحصص في فترات مكتملة بدلاً من توزيعها على فترات جزئية"],["schoolFrontLoad", "تقديم إشغال الفترات", "يفضل ألا تكون الفترات المتأخرة أكثر إشغالاً من الفترات المبكرة"],["classDailyBalance", "توازن أيام الفصل", "تقليل التفاوت الحقيقي بين أحمال أيام الفصل بما فيها الأيام ذات الحمل صفر"]];
    const settingsSections: Array<[typeof settingsTab, string, string]> = [
      ["school", "المدرسة", "اسم المدرسة والهوية"],
      ["schedule", "الجدولة", "المراحل وأيام الدراسة"],
      ["constraints", "القيود", "الإتاحة والمتطلبات والقاعات"],
      ["data", "البيانات", "استيراد ونسخ احتياطي"],
      ["advanced", "متقدم", "التفضيلات الفنية"],
      ["danger", "منطقة خطرة", "مسح وحذف جماعي"],
    ];
    const selectSettingsSection = (section: typeof settingsTab) => {
      setSettingsTab(section);
      window.requestAnimationFrame(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };
    return <section className="page-section settings-page">
      <div className="page-heading"><div><div className="eyebrow">إعدادات المدرسة</div><h1>الإعدادات</h1><p>إدارة هوية المدرسة وأيام العمل والقيود والبيانات من أقسام منفصلة وواضحة.</p></div><div className="page-heading-actions"><button className="primary-btn" onClick={persistNow}><Save size={16} />حفظ الإعدادات</button></div></div>
      <nav className="settings-section-nav" aria-label="أقسام إعدادات المدرسة">{settingsSections.map(([section, label, detail]) => <button type="button" key={section} className={settingsTab === section ? "active" : ""} onClick={() => selectSettingsSection(section)}><strong>{label}</strong><span>{detail}</span></button>)}</nav>
      <div className="constraint-hero panel-shadow"><div className="constraint-hero-icon"><ShieldCheck size={24} /></div><div><strong>قواعد الجدولة الأساسية</strong><span>القواعد الإلزامية تمنع التعارضات، وتفضيلات التحسين تساعد المحرك على اختيار جدول أكثر توازناً.</span></div><label className="constraint-mode"><input type="checkbox" checked={curriculumMode} onChange={(event) => setCurriculumMode(event.target.checked)} /><span><b>وضع المنهج</b><small>{curriculumMode ? "التوليد يعتمد على الحصص الأسبوعية" : "التوليد يعيد توزيع الحصص الحالية"}</small></span></label></div>
      <div id="settings-school" className="settings-card panel-shadow settings-school-card">
        <div className="settings-card-heading"><div className="settings-card-icon"><School size={19} /></div><div><h2>بيانات المدرسة</h2><p>عدّل اسم المدرسة الذي يظهر في الواجهة والترويسة وملفات التصدير.</p></div></div>
        <div className="school-name-editor"><label htmlFor="school-name" className="input-with-icon"><School size={15} /><input id="school-name" value={schoolName} onChange={(event) => setSchoolName(event.target.value)} onBlur={() => showToast("تم حفظ اسم المدرسة")} placeholder="اسم المدرسة" /></label><span><Check size={13} />يُحفظ تلقائياً</span></div>
      </div>
      <div id="settings-schedule" className="settings-card panel-shadow stage-management-card">
        <div className="settings-card-heading"><div className="settings-card-icon violet"><School size={19} /></div><div><h2>إدارة المراحل الدراسية</h2><p>أضف أو عدّل مرحلة. حذف كل المراحل موجود في المنطقة الخطرة حتى لا يختلط بالعمل اليومي.</p></div></div>
        <div className="stage-add-row"><label htmlFor="new-stage" className="input-with-icon"><Plus size={15} /><input id="new-stage" value={newStage} onChange={(event) => setNewStage(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addStage()} placeholder="اسم المرحلة، مثال: 3" /></label><button className="outline-btn" onClick={addStage}><Plus size={14} />إضافة مرحلة</button></div>
        <div className="stage-management-list">{stageList.map((stage) => <div className="stage-management-row" key={stage}>{editingStage === stage ? <><label htmlFor={`edit-stage-${stage}`} className="input-with-icon"><Pencil size={14} /><input id={`edit-stage-${stage}`} autoFocus value={editingStageName} onChange={(event) => setEditingStageName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") saveStageEdit(stage); if (event.key === "Escape") setEditingStage(null); }} /></label><div className="stage-row-actions"><button className="outline-btn" onClick={() => saveStageEdit(stage)}>حفظ</button><button className="danger-outline-btn" onClick={() => setEditingStage(null)}>إلغاء</button></div></> : <><div><strong>المرحلة {stage}</strong><span>{classes.filter((item) => item.startsWith(`${stage}/`)).length} فصول · {stageDailySlots[stage] ?? timeSlots.length} حصص يومياً</span></div><div className="stage-row-actions"><button className="icon-btn small" title="تعديل المرحلة" onClick={() => { setEditingStage(stage); setEditingStageName(stage); }}><Pencil size={15} /></button><button className="danger-outline-btn" title="حذف المرحلة" onClick={() => removeStage(stage)}><Trash2 size={14} /></button></div></>}</div>)}</div>
      </div>
      <div className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon"><Clock3 size={19} /></div><div><h2>المرحلة وأيام الدراسة</h2><p>تمنع إنشاء حصص خارج أيام الدراسة أو فوق سعة اليوم.</p></div></div><div className="stage-slots-grid">{stageList.map((stage) => <label className="stage-slot-control" key={stage}><span>المرحلة {stage}</span><small>من 1 إلى {timeSlots.length} حصص يومياً</small><div><input type="number" min="1" max={timeSlots.length} value={stageDailySlots[stage] ?? timeSlots.length} onChange={(event) => setStageDailySlots((current) => ({ ...current, [stage]: Math.min(timeSlots.length, Math.max(1, Number(event.target.value) || 1)) }))} /><span>حصة يومياً</span></div><small className="study-days-label">أيام الدراسة الفعلية</small><div className="stage-day-checks">{days.map((day) => <label key={day}><input type="checkbox" checked={getStageStudyDays(stageStudyDays, `${stage}/1`).includes(day)} onChange={(event) => setStageStudyDays((current) => { const selected = current[stage] ?? [...days]; const next = event.target.checked ? Array.from(new Set([...selected, day])) : selected.filter((item) => item !== day); return { ...current, [stage]: next.length ? next : selected }; })} /><span>{day.slice(0, 1)}</span></label>)}</div></label>)}</div></div>
      <div id="settings-constraints" className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon violet"><LockKeyhole size={19} /></div><div><h2>إتاحة المعلمين</h2><p>حدد الخانات التي لا يستطيع المعلم التدريس فيها. الجدول لن يضع حصصاً في هذه الخانات.</p></div></div><div className="availability-toolbar"><span>اضغط على الخانة لتبديل «غير متاح»</span><b>{teachers.length} معلمين · {days.length * timeSlots.length} خانة</b></div><div className="availability-table-wrap"><table className="constraint-table"><thead><tr><th>المعلم</th>{days.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{teachers.map((teacher) => <tr key={teacher.name}><td><strong>{teacher.name}</strong><small>{teacher.subject}</small></td>{days.map((day) => <td key={day}><div className="slot-mini-grid">{timeSlots.map(({ slot }) => { const unavailable = (teacherAvailability[teacher.name]?.unavailable ?? []).some((item) => item.day === day && item.slot === slot); return <button type="button" key={slot} className={unavailable ? "unavailable" : "available"} title={`${day} — حصة ${slot}`} onClick={() => toggleUnavailable(teacher.name, day, slot, !unavailable)}>{slot}</button>; })}</div></td>)}</tr>)}</tbody></table></div></div>
      <div className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon"><BookOpen size={19} /></div><div><h2>المتطلبات الأسبوعية للمادة</h2><p>عدد الحصص الأسبوعية، الحد اليومي، التباعد، والحصص المتتالية لكل فصل.</p></div><button className="outline-btn settings-inline-btn" onClick={ensureRequirements}>توليد من المنهج</button></div>{subjectRequirements.length === 0 ? <div className="empty-constraint">لا توجد متطلبات محفوظة. استخدم «توليد من المنهج» لبنائها من المواد والمعلمين.</div> : <div className="requirements-grid">{subjectRequirements.map((requirement, index) => <div className="requirement-card" key={`${requirement.className}-${requirement.subject}-${index}`}><div className="requirement-title"><strong>{requirement.subject}</strong><span>الفصل {requirement.className}</span></div><label>المعلم<select value={requirement.teacher} onChange={(event) => updateRequirement(index, { teacher: event.target.value })}>{teachers.map((teacher) => <option key={teacher.name} value={teacher.name}>{teacher.name}</option>)}</select></label><label>القاعة (اختياري)<select value={requirement.room ?? ""} onChange={(event) => updateRequirement(index, { room: event.target.value || undefined })}><option value="">بدون قاعة محددة</option>{rooms.map((room) => <option key={room} value={room}>{room}</option>)}</select></label><div className="requirement-fields"><label>أسبوعياً<input type="number" min="1" max="20" value={requirement.weeklyLessons} onChange={(event) => updateRequirement(index, { weeklyLessons: Math.max(1, Number(event.target.value) || 1) })} /></label><label>أقصى/يوم<input type="number" min="1" max="7" value={requirement.maxPerDay ?? 1} onChange={(event) => updateRequirement(index, { maxPerDay: Math.max(1, Number(event.target.value) || 1) })} /></label><label>التباعد<input type="number" min="0" max="6" value={requirement.minGapBetweenSameSubject ?? 0} onChange={(event) => updateRequirement(index, { minGapBetweenSameSubject: Math.max(0, Number(event.target.value) || 0) })} /></label></div><label className="check-row"><input type="checkbox" checked={Boolean(requirement.consecutive)} onChange={(event) => updateRequirement(index, { consecutive: event.target.checked })} /><span>حصص متتالية ككتلة</span></label></div>)}</div>}</div>
      <div className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon"><DoorOpen size={19} /></div><div><h2>القاعات والموارد</h2><p>عرّف القاعات المتخصصة وحدد أوقات عدم توفرها. ربط القاعة بالمتطلب يجعلها قاعدة إلزامية.</p></div></div><div className="resource-toolbar"><label htmlFor="new-room" className="input-with-icon"><DoorOpen size={15} /><input id="new-room" value={newRoom} onChange={(event) => setNewRoom(event.target.value)} placeholder="اسم القاعة أو المختبر" onKeyDown={(event) => event.key === "Enter" && addRoom()} /></label><button className="outline-btn" onClick={addRoom}><Plus size={14} />إضافة قاعة</button></div><div className="room-list">{rooms.map((room) => <div className="room-card" key={room}><div><strong>{room}</strong><span>{(roomAvailability[room] ?? []).length} خانات غير متاحة</span></div><button className="danger-outline-btn" onClick={() => removeRoom(room)}><X size={13} /></button></div>)}</div>{rooms.length ? <div className="room-availability-wrap"><div className="availability-toolbar"><span>اضغط على الخانة لتبديل عدم الإتاحة</span><b>تؤثر مباشرة على الجدول</b></div><table className="constraint-table"><thead><tr><th>القاعة</th>{days.map((day) => <th key={day}>{day}</th>)}</tr></thead><tbody>{rooms.map((room) => <tr key={room}><td><strong>{room}</strong></td>{days.map((day) => <td key={day}><div className="slot-mini-grid">{timeSlots.map(({ slot }) => { const unavailable = (roomAvailability[room] ?? []).some((item) => item.day === day && item.slot === slot); return <button type="button" key={slot} className={unavailable ? "unavailable" : "available"} onClick={() => toggleRoomUnavailable(room, day, slot, !unavailable)}>{slot}</button>; })}</div></td>)}</tr>)}</tbody></table></div> : null}</div>
      <div id="settings-data" className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon"><FileSpreadsheet size={19} /></div><div><h2>إدارة البيانات</h2><p>استورد بيانات المدرسة أو احتفظ بنسخة احتياطية يمكن استعادتها لاحقاً.</p></div></div><div className="settings-action-grid"><button className="outline-btn" onClick={() => importInputRef.current?.click()}><FileSpreadsheet size={15} />استيراد Excel / CSV</button><button className="outline-btn" onClick={downloadBackup}><Download size={15} />تنزيل نسخة JSON</button><button className="outline-btn" onClick={() => backupInputRef.current?.click()}><RefreshCw size={15} />استعادة نسخة</button></div>{importSummary && <div className="settings-note"><Check size={14} />{importSummary}</div>}</div>
      <div className="settings-card panel-shadow preflight-card"><div className="settings-card-heading"><div className="settings-card-icon violet"><SearchCheck size={19} /></div><div><h2>تشخيص قابلية الحل</h2><p>لا يكتفي بالفحص؛ يحدد سبب المشكلة ويقترح القيد الذي يستحق التخفيف أولاً.</p></div><button className="outline-btn settings-inline-btn" onClick={() => setPreflightOpen((value) => !value)}>{preflightOpen ? "إخفاء التشخيص" : "عرض التشخيص"}</button></div><div className={`preflight-banner ${diagnostics.some((i) => i.severity === "hard") ? "warning" : diagnostics.length ? "warning" : "success"}`}><div>{diagnostics.some((i) => i.severity === "hard") ? <AlertTriangle size={17} /> : diagnostics.length ? <SearchCheck size={17} /> : <Check size={17} />}</div><strong>{diagnostics.some((i) => i.severity === "hard") ? `${diagnostics.filter((i) => i.severity === "hard").length} مشاكل إلزامية` : diagnostics.length ? `${diagnostics.length} ملاحظات تحسين` : "لا توجد مؤشرات بنيوية مقلقة"}</strong><span>{diagnostics.length ? "ابدأ بالمشاكل الأعلى تأثيراً قبل تشغيل المحرك." : "الإعدادات الحالية تبدو قابلة للحل مبدئياً."}</span></div>{preflightOpen && <div className="diagnostic-list">{diagnostics.length ? diagnostics.map((issue) => <div className={`diagnostic-item ${issue.severity}`} key={issue.id}><div className="diagnostic-badge">{issue.severity === "hard" ? "إلزامي" : issue.severity === "warning" ? "تحذير" : "معلومة"}</div><div className="diagnostic-body"><strong>{issue.title}</strong><span>{issue.detail}</span>{issue.action && <small>الاقتراح: <b>{issue.action.label}</b> — {issue.action.reason}</small>}</div></div>) : <div className="empty-constraint">لم يجد التشخيص مشاكل بنيوية واضحة. تبقى جودة الحل مرتبطة بأوزان التفضيلات وتوزيع الموارد.</div>}</div>}</div>
      <div id="settings-advanced" className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon violet"><SlidersHorizontal size={19} /></div><div><h2>أوزان التفضيلات</h2><p>كلما ارتفع الوزن أصبح المحرك أكثر حرصاً على تحقيق الهدف.</p></div></div><div className="weight-grid">{weightLabels.map(([key, label, description]) => <label className="weight-row" key={key}><span><b>{label}</b><small>{description}</small></span><input type="range" min="0" max="100" value={solverWeights[key]} onChange={(event) => setSolverWeights((current) => ({ ...current, [key]: Number(event.target.value) }))} /><strong>{solverWeights[key]}</strong></label>)}</div><div className="settings-note"><Check size={14} />هذه الأوزان لا تغيّر صحة القواعد الإلزامية؛ إنها تغيّر جودة وترتيب الحلول.</div></div>
      <div className="settings-card panel-shadow"><div className="settings-card-heading"><div className="settings-card-icon"><ShieldCheck size={19} /></div><div><h2>ملخص القيود الفعالة</h2><p>مؤشرات سريعة قبل تشغيل التوليد.</p></div></div><div className="constraint-summary-grid"><div><strong>{teachers.length}</strong><span>معلم تحت القيود</span></div><div><strong>{subjectRequirements.length}</strong><span>متطلب أسبوعي</span></div><div><strong>{Object.values(teacherAvailability).reduce((n, item) => n + (item.unavailable?.length ?? 0), 0)}</strong><span>خانة عدم إتاحة</span></div><div><strong>{Object.values(solverWeights).filter((value) => value > 0).length}</strong><span>أهداف محسّنة</span></div></div></div>
      <div id="settings-danger" className="settings-card panel-shadow danger-zone-card"><div className="settings-card-heading"><div className="settings-card-icon danger"><AlertTriangle size={19} /></div><div><h2>منطقة خطرة</h2><p>هذه العمليات تحذف بيانات أو تغيّر بنية المدرسة. راجع التأثير قبل التنفيذ.</p></div></div><div className="danger-action-list"><button className="danger-outline-btn" onClick={() => setShowClearScheduleConfirm(true)}><Trash2 size={15} />مسح بيانات الجدول فقط</button><button className="danger-outline-btn" onClick={() => setBulkDeleteTarget("stages")} disabled={!stages.length}><Trash2 size={15} />حذف جميع المراحل والفصول</button><button className="danger-outline-btn" onClick={() => setShowClearConfirm(true)}><X size={15} />مسح التخزين المحلي</button></div></div>
    </section>;
  };
  const renderNotifications = () => {
    const reviewGroups = [
      {
        key: "critical",
        title: "يمنع اعتماد الجدول",
        empty: "لا توجد مشاكل تمنع الاعتماد.",
        items: [
          ...(analyticsConflicts > 0 ? [{ title: "تعارضات في الجدول", text: `${analyticsConflicts} خانات تحتاج إلى فصل معلم أو فصل عن خانة مشغولة.`, target: "schedule" as NavKey }] : []),
          ...diagnostics.filter((issue) => issue.severity === "hard").map((issue) => ({ title: issue.title, text: `${issue.detail}${issue.action ? ` الإجراء المقترح: ${issue.action.label}.` : ""}`, target: "settings" as NavKey })),
        ],
      },
      {
        key: "warning",
        title: "يحتاج مراجعة",
        empty: "لا توجد تنبيهات تحتاج متابعة.",
        items: [
          ...(analyticsUnassigned > 0 ? [{ title: "حصص غير موزعة", text: `${analyticsUnassigned} حصص تحتاج إلى توزيع قبل مشاركة الجدول النهائي.`, target: "schedule" as NavKey }] : []),
          ...(analyticsInternalGaps > 0 ? [{ title: "فراغات داخلية", text: `${analyticsInternalGaps} فراغات بين الحصص تجعل اليوم أقل تماسكاً للمعلم أو الفصل.`, target: "schedule" as NavKey }] : []),
          ...diagnostics.filter((issue) => issue.severity === "warning").map((issue) => ({ title: issue.title, text: `${issue.detail}${issue.action ? ` الإجراء المقترح: ${issue.action.label}.` : ""}`, target: "settings" as NavKey })),
        ],
      },
      {
        key: "info",
        title: "معلومات",
        empty: "كل المؤشرات المعلوماتية مستقرة.",
        items: diagnostics.filter((issue) => issue.severity === "info").map((issue) => ({ title: issue.title, text: issue.detail, target: "settings" as NavKey })),
      },
    ];
    const totalIssues = reviewGroups.reduce((sum, group) => sum + group.items.length, 0);

    return (
      <section className="page-section notifications-page">
        <div className="page-heading">
          <div><div className="eyebrow">مراجعة الجدول</div><h1>المراجعة والتشخيص</h1><p>افصل مشاكل الاعتماد عن ملاحظات التحسين، ثم افتح المكان الصحيح لمعالجتها.</p></div>
          <div className="page-heading-actions"><span className="load-badge">{totalIssues} عناصر مراجعة</span></div>
        </div>
        <div className="review-status-grid">
          {reviewGroups.map((group) => (
            <section className={`review-group review-${group.key} panel-shadow`} key={group.key}>
              <div className="review-group-heading"><strong>{group.title}</strong><span>{group.items.length}</span></div>
              <div className="review-list">
                {group.items.length ? group.items.map((reviewItem) => (
                  <button className="review-card" key={`${group.key}-${reviewItem.title}`} onClick={() => goToNav(reviewItem.target)}>
                    <div className="review-card-icon">{group.key === "critical" ? <AlertTriangle size={18} /> : group.key === "warning" ? <SearchCheck size={18} /> : <Bell size={18} />}</div>
                    <span><strong>{reviewItem.title}</strong><small>{reviewItem.text}</small></span>
                    <ChevronLeft size={16} />
                  </button>
                )) : <div className="review-empty"><Check size={16} />{group.empty}</div>}
              </div>
            </section>
          ))}
        </div>
      </section>
    );
  };

  const renderContent = () => {
    if (activeNav === "dashboard") return renderDashboard();
    if (activeNav === "schedule") return <section className="page-section schedule-page"><div className="page-heading"><div><div className="eyebrow">المحرك الذكي</div><h1>الجداول المدرسية</h1><p>راجع كل الجداول وعدّلها يدوياً مع حماية كاملة من التعارضات.</p></div><div className="schedule-page-actions"><button className="outline-btn" onClick={persistNow}>حفظ الآن</button><button className="outline-btn" onClick={improveCurrentSchedule} disabled={isGenerating}><Sparkles size={16} />تحسين الجدول</button><button className="primary-btn" onClick={generateSmartSchedule} disabled={isGenerating}><WandSparkles size={16} />{isGenerating ? "جارٍ التوليد…" : "توليد جديد"}</button></div></div>{renderReadinessSummary()}{renderScheduleCard()}</section>;
    if (activeNav === "teachers") return renderTeachers();
    if (activeNav === "classes") return renderClasses();
    if (activeNav === "subjects") return renderSubjects();
    if (activeNav === "notifications") return renderNotifications();
    if (activeNav === "settings") return renderSettings();
    return renderExports();
  };

  return (
    <div className="app-shell" dir="rtl">
      {renderSidebar()}
      <div className="app-main"><div className="background-orb orb-a" /><div className="background-orb orb-b" />{renderHeader()}<main className="main-content">{renderContent()}</main></div>
      <input ref={importInputRef} className="hidden-file-input" type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
      <input ref={backupInputRef} className="hidden-file-input" type="file" accept="application/json,.json" onChange={handleRestoreBackup} />
      {mobileMenu && <button className="mobile-overlay" onClick={() => setMobileMenu(false)} aria-label="إغلاق القائمة" />}
      {toast && <div className="toast-message" role="status" aria-live="polite"><div className="toast-check"><Check size={14} /></div><span>{toast}</span><button aria-label="إغلاق التنبيه" onClick={() => setToast(null)}><X size={14} /></button></div>}
      {showQuickAdd && <div className="modal-backdrop" onClick={() => setShowQuickAdd(false)}><div className="quick-modal" role="dialog" aria-modal="true" aria-labelledby="quick-add-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">إعداد سريع</div><h2 id="quick-add-title">ابدأ بإضافة بياناتك</h2><p>اختر القسم الذي تريد تحديثه الآن.</p></div><button className="icon-btn" aria-label="إغلاق الإعداد السريع" onClick={() => setShowQuickAdd(false)}><X size={18} /></button></div><div className="quick-options"><button onClick={() => { setShowQuickAdd(false); goToNav("classes"); }}><div className="quick-option-icon purple"><School size={19} /></div><span><strong>الفصول</strong><small>أضف الصفوف والشعب</small></span><ChevronLeft size={16} /></button><button onClick={() => { setShowQuickAdd(false); goToNav("teachers"); }}><div className="quick-option-icon teal"><Users size={19} /></div><span><strong>المعلمون</strong><small>أدخل النصاب والأيام الممنوعة</small></span><ChevronLeft size={16} /></button><button onClick={() => { setShowQuickAdd(false); goToNav("subjects"); }}><div className="quick-option-icon amber"><BookOpen size={19} /></div><span><strong>المواد</strong><small>حدد الحصص الأسبوعية</small></span><ChevronLeft size={16} /></button></div><div className="modal-footer"><span><CircleHelpIcon />يمكنك تعديل كل شيء لاحقاً</span></div></div></div>}
      {bulkDeleteTarget && <div className="modal-backdrop" onClick={() => setBulkDeleteTarget(null)}><div className="quick-modal confirm-modal" onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><Trash2 size={22} /></div><div className="modal-header"><div><div className="eyebrow">حذف جماعي</div><h2>{bulkDeleteTarget === "teachers" ? "حذف جميع المعلمين؟" : bulkDeleteTarget === "classes" ? "حذف جميع الفصول؟" : bulkDeleteTarget === "subjects" ? "حذف جميع المواد الدراسية؟" : "حذف جميع المراحل؟"}</h2><p>{bulkDeleteTarget === "stages" ? "سيتم حذف جميع المراحل والفصول المرتبطة بها والمتطلبات الخاصة بها." : "سيتم حذف جميع العناصر من هذه القائمة وبيانات القيود المرتبطة بها. يجب أن يكون الجدول فارغاً قبل التنفيذ."}</p></div><button className="icon-btn" onClick={() => setBulkDeleteTarget(null)}><X size={18} /></button></div><div className="confirm-actions"><button className="outline-btn" onClick={() => setBulkDeleteTarget(null)}>إلغاء</button><button className="danger-btn" onClick={() => bulkDelete(bulkDeleteTarget)}><Trash2 size={15} />نعم، احذف الكل</button></div></div></div>}
      {showClearScheduleConfirm && <div className="modal-backdrop" onClick={() => setShowClearScheduleConfirm(false)}><div className="quick-modal confirm-modal" onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><Trash2 size={22} /></div><div className="modal-header"><div><div className="eyebrow">مسح الجدول فقط</div><h2>مسح كافة بيانات الجدول؟</h2><p>سيتم حذف الحصص الموزعة ونتيجة آخر توليد فقط، مع الاحتفاظ باسم المدرسة والمراحل والمعلمين والمواد والمتطلبات والقيود.</p></div><button className="icon-btn" onClick={() => setShowClearScheduleConfirm(false)}><X size={18} /></button></div><div className="confirm-actions"><button className="outline-btn" onClick={() => setShowClearScheduleConfirm(false)}>إلغاء</button><button className="danger-btn" onClick={clearScheduleOnly}><Trash2 size={15} />نعم، امسح الجدول</button></div></div></div>}
      {showClearConfirm && <div className="modal-backdrop" onClick={() => setShowClearConfirm(false)}><div className="quick-modal confirm-modal" onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><AlertTriangle size={22} /></div><div className="modal-header"><div><div className="eyebrow">إجراء لا يمكن التراجع عنه</div><h2>مسح التخزين المحلي؟</h2><p>سيتم حذف الجداول والبيانات المستوردة والشعار من هذا المتصفح، ثم إعادة البيانات الافتراضية.</p></div><button className="icon-btn" onClick={() => setShowClearConfirm(false)}><X size={18} /></button></div><div className="confirm-actions"><button className="outline-btn" onClick={() => setShowClearConfirm(false)}>إلغاء</button><button className="danger-btn" onClick={clearAllLocalData}><X size={15} />نعم، امسح البيانات</button></div></div></div>}
      {conflict && <div role="alert" className="conflict-alert" aria-live="assertive"><div className="conflict-alert-icon"><AlertTriangle size={18} /></div><div><strong>تعذر نقل الحصة</strong><span>{conflict.message}</span></div><button onClick={() => setConflict(null)} aria-label="إخفاء التنبيه"><X size={15} /></button></div>}
      {showPrintPreview && <div className="modal-backdrop print-preview-backdrop" onClick={() => setShowPrintPreview(false)}><div className="print-preview-modal" onClick={(event) => event.stopPropagation()}><div className="print-preview-toolbar"><div><div className="eyebrow">معاينة قبل الطباعة</div><strong>الجدول العام — A4 أفقي</strong></div><div className="print-preview-actions"><button className="outline-btn" onClick={() => setShowPrintPreview(false)}><X size={15} />إغلاق</button><button className="primary-btn" onClick={() => { setShowPrintPreview(false); window.setTimeout(() => window.print(), 180); }}><Printer size={15} />فتح نافذة الطباعة</button></div></div><div className="print-preview-canvas">{renderMasterGrid()}</div></div></div>}
      {showCompressionReport && <div className="modal-backdrop" onClick={() => setShowCompressionReport(false)}><div className="quick-modal compression-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">مراجعة يدوية</div><h2>فصول تعذر ضغط حصصها</h2><p>هذه الفصول تحتاج إلى تعديل يدوي بسبب تزاحم المعلمين أو محدودية الخانات المتاحة.</p></div><button className="icon-btn" onClick={() => setShowCompressionReport(false)}><X size={18} /></button></div><div className="compression-report-list">{compressionReport.map((entry) => <div className="compression-report-row" key={entry.className}><div className="compression-class-icon"><School size={17} /></div><div><strong>الفصل {entry.className}</strong><span>{entry.gapsByDay.length ? entry.gapsByDay.map((day) => `${day.day}: ${day.gaps} فراغ`).join(" • ") : "تعارض معلم محتمل"}</span></div><b>{entry.conflictCount ? `${entry.conflictCount} تعارض` : "فراغات داخلية"}</b></div>)}</div><div className="modal-footer"><span><AlertTriangle size={14} />استخدم السحب والإفلات أو «إعادة ترتيب اليوم» لمعالجة الحالات.</span><button className="outline-btn" onClick={() => { setShowCompressionReport(false); goToNav("classes"); }}>فتح الفصول</button></div></div></div>}
    </div>
  );
}

function CircleHelpIcon() {
  return <span className="help-icon">?</span>;
}
