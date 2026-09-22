import type { Assignment, ConstraintViolation, SchedulingConfig, SolverWeights, SubjectRequirement } from "./model";

export const DEFAULT_WEIGHTS: SolverWeights = {
  internalClassGap: 35,
  teacherGap: 25,
  sameSubjectSameDay: 40,
  subjectSpacing: 45,
  dailyLoadImbalance: 8,
  preferenceMiss: 12,
  teacherLoadImbalance: 4,
  roomChange: 2,
  schoolSlotCoverage: 7,
  schoolFrontLoad: 10,
  classDailyBalance: 6,
};

export const stageOf = (className: string) => className.split("/")[0];
export const dailyLimitFor = (config: SchedulingConfig, className: string) => {
  const stage = stageOf(className);
  if (Object.prototype.hasOwnProperty.call(config.stageDailySlots, stage)) {
    return Math.min(config.timeSlots.length, Math.max(0, config.stageDailySlots[stage] ?? 0));
  }
  return config.timeSlots.length;
};

export const studyDaysFor = (config: SchedulingConfig, className: string) => {
  const stage = stageOf(className);
  if (Object.prototype.hasOwnProperty.call(config.stageStudyDays, stage)) return config.stageStudyDays[stage] ?? [];
  return config.days;
};
export const teacherSlotLimitFor = (config: SchedulingConfig, teacher: string, day: string, slot: number) => config.teacherSlotLimits[teacher]?.[day]?.[slot] ?? -1;
export const teacherGapLimitFor = (config: SchedulingConfig, teacher: string, day: string) => config.teacherGapLimits[teacher]?.[day] ?? 0;

export const gapsOf = (slots: number[]) => {
  const unique = [...new Set(slots)].sort((a, b) => a - b);
  return unique.length < 2 ? 0 : Math.max(0, unique.at(-1)! - unique[0] + 1 - unique.length);
};

const requirementFor = (config: SchedulingConfig, item: Assignment): SubjectRequirement | undefined =>
  config.requirements?.find((r) => r.className === item.className && r.subject === item.subject && r.teacher === item.teacher);

const teacherUnavailable = (config: SchedulingConfig, teacher: string, day: string, slot: number) =>
  config.teacherAvailability?.[teacher]?.unavailable?.some((x) => x.day === day && x.slot === slot) ?? false;

const roomUnavailable = (config: SchedulingConfig, room: string | undefined, day: string, slot: number) =>
  room ? config.roomAvailability?.[room]?.some((x) => x.day === day && x.slot === slot) ?? false : false;

const dayIndex = (config: SchedulingConfig, day: string) => config.days.indexOf(day);

const sameSubjectItems = (assignment: Assignment, placed: Assignment[]) =>
  placed.filter((x) => x.className === assignment.className && x.subject === assignment.subject);

const consecutiveBlockValid = (assignment: Assignment, candidate: Pick<Assignment, "day" | "slot">, placed: Assignment[], config: SchedulingConfig, requirement?: SubjectRequirement) => {
  if (!requirement?.consecutive) return true;
  const existing = sameSubjectItems(assignment, placed);
  if (!existing.length) return true;
  if (existing.some((x) => x.day !== candidate.day)) return false;

  const slots = [...existing.map((x) => x.slot), candidate.slot].sort((a, b) => a - b);
  return slots.every((value, index) => index === 0 || value === slots[index - 1] + 1) &&
    slots.length <= dailyLimitFor(config, assignment.className);
};

export const placementViolations = (
  assignment: Assignment,
  candidate: Pick<Assignment, "day" | "slot">,
  placed: Assignment[],
  config: SchedulingConfig,
): ConstraintViolation[] => {
  const { day, slot } = candidate;
  const violations: ConstraintViolation[] = [];
  const requirement = requirementFor(config, assignment);

  if (!studyDaysFor(config, assignment.className).includes(day)) {
    violations.push({ code: "CLASS_STUDY_DAY", severity: "hard", assignmentId: assignment.id, message: `الفصل ${assignment.className} لا يدرس يوم ${day}`, day, slot, penalty: 10000 });
  }
  if (slot < 1 || slot > dailyLimitFor(config, assignment.className)) {
    violations.push({ code: "CLASS_DAILY_LIMIT", severity: "hard", assignmentId: assignment.id, message: `الحصة ${slot} تتجاوز الحد اليومي للفصل ${assignment.className}`, day, slot, penalty: 10000 });
  }
  if (teacherUnavailable(config, assignment.teacher, day, slot)) {
    violations.push({ code: "TEACHER_UNAVAILABLE", severity: "hard", assignmentId: assignment.id, message: `المعلم ${assignment.teacher} غير متاح في ${day} / ${slot}`, day, slot, penalty: 15000 });
  }
  if (roomUnavailable(config, assignment.room, day, slot)) {
    violations.push({ code: "ROOM_UNAVAILABLE", severity: "hard", assignmentId: assignment.id, message: `الغرفة ${assignment.room} غير متاحة`, day, slot, penalty: 15000 });
  }

  if (placed.some((x) => x.className === assignment.className && x.day === day && x.slot === slot)) {
    violations.push({ code: "CLASS_COLLISION", severity: "hard", assignmentId: assignment.id, message: `الفصل ${assignment.className} مشغول بالفعل`, day, slot, penalty: 20000 });
  }
  if (placed.some((x) => x.teacher === assignment.teacher && x.day === day && x.slot === slot)) {
    violations.push({ code: "TEACHER_COLLISION", severity: "hard", assignmentId: assignment.id, message: `المعلم ${assignment.teacher} مشغول بالفعل`, day, slot, penalty: 20000 });
  }
  if (assignment.room && placed.some((x) => x.room === assignment.room && x.day === day && x.slot === slot)) {
    violations.push({ code: "ROOM_COLLISION", severity: "hard", assignmentId: assignment.id, message: `الغرفة ${assignment.room} مشغولة بالفعل`, day, slot, penalty: 18000 });
  }

  const teacherDaySlots = placed.filter((x) => x.teacher === assignment.teacher && x.day === day).map((x) => x.slot);
  const teacherSlotLimits = [...placed.filter((x) => x.teacher === assignment.teacher && x.day === day), assignment]
    .map((x) => teacherSlotLimitFor(config, assignment.teacher, day, x.slot))
    .filter((x) => x >= 0);
  const allowedGaps = teacherSlotLimits.length ? Math.min(...teacherSlotLimits) : teacherGapLimitFor(config, assignment.teacher, day);
  if (gapsOf([...teacherDaySlots, slot]) > allowedGaps) {
    violations.push({ code: "TEACHER_GAPS", severity: "hard", assignmentId: assignment.id, message: `فراغات المعلم ${assignment.teacher} تتجاوز الحد`, day, slot, penalty: 5000 });
  }

  const classDay = placed.filter((x) => x.className === assignment.className && x.day === day);
  const sameSubjectCount = classDay.filter((x) => x.subject === assignment.subject).length;
  const maxPerDay = Math.max(1, requirement?.maxPerDay ?? 1);
  if (sameSubjectCount >= maxPerDay) {
    violations.push({ code: "SUBJECT_DAILY_LIMIT", severity: "hard", assignmentId: assignment.id, message: `المادة ${assignment.subject} تجاوزت الحد اليومي للفصل`, day, slot, penalty: 9000 });
  }

  const existingSubject = sameSubjectItems(assignment, placed);
  const minGap = Math.max(0, requirement?.minGapBetweenSameSubject ?? 0);
  const candidateDayIndex = dayIndex(config, day);
  if (minGap > 0 && existingSubject.some((x) => {
    if (x.day === day) return true;
    const existingDayIndex = dayIndex(config, x.day);
    return existingDayIndex >= 0 && candidateDayIndex >= 0 && Math.abs(existingDayIndex - candidateDayIndex) <= minGap;
  })) {
    violations.push({ code: "SUBJECT_SPACING", severity: "hard", assignmentId: assignment.id, message: `المادة ${assignment.subject} تحتاج مسافة أكبر بين الحصص`, day, slot, penalty: 7000 });
  }

  if (!consecutiveBlockValid(assignment, candidate, placed, config, requirement)) {
    violations.push({ code: "CONSECUTIVE_BLOCK", severity: "hard", assignmentId: assignment.id, message: `حصص ${assignment.subject} للفصل ${assignment.className} يجب أن تكون كتلة متتالية واحدة`, day, slot, penalty: 12000 });
  }

  return violations;
};

const weight = (config: SchedulingConfig) => ({ ...DEFAULT_WEIGHTS, ...(config.weights ?? {}) });

const preferenceMissCount = (items: Assignment[], config: SchedulingConfig) => {
  let misses = 0;
  for (const item of items) {
    const requirement = requirementFor(config, item);
    if (requirement?.preferredDays?.length && !requirement.preferredDays.includes(item.day)) misses += 1;
    if (requirement?.preferredSlots?.length && !requirement.preferredSlots.includes(item.slot)) misses += 1;
    const preferred = config.teacherAvailability?.[item.teacher]?.preferred;
    if (preferred?.length && !preferred.some((x) => x.day === item.day && x.slot === item.slot)) misses += 1;
  }
  return misses;
};

const roomChangeCount = (assignments: Assignment[]) => {
  const byTeacherDay = new Map<string, Assignment[]>();
  for (const item of assignments) {
    if (!item.room) continue;
    const key = `${item.teacher}::${item.day}`;
    byTeacherDay.set(key, [...(byTeacherDay.get(key) ?? []), item]);
  }
  let changes = 0;
  for (const items of byTeacherDay.values()) {
    const sorted = [...items].sort((a, b) => a.slot - b.slot);
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i - 1].room !== sorted[i].room) changes += 1;
  }
  return changes;
};

const schoolCoverageMetrics = (assignments: Assignment[], config: SchedulingConfig) => {
  let schoolSlotCoverage = 0;
  let schoolFrontLoad = 0;
  const classSet = config.classes.length ? config.classes : [...new Set(assignments.map((x) => x.className))];

  for (const day of config.days) {
    const eligibleClasses = classSet.filter((className) => studyDaysFor(config, className).includes(day));
    if (!eligibleClasses.length) continue;
    const occupied = config.timeSlots.map(({ slot }) => {
      const classesAtSlot = new Set(assignments
        .filter((x) => x.day === day && x.slot === slot && eligibleClasses.includes(x.className))
        .map((x) => x.className));
      return classesAtSlot.size;
    });

    occupied.forEach((count) => {
      // A partially filled period is less desirable than a full period. This is not a
      // simple "empty cells" count (which would be constant for a fixed number of lessons);
      // it rewards packing the school into well-utilized periods.
      if (count > 0 && count < eligibleClasses.length) schoolSlotCoverage += 1;
    });

    // Prefer a school-wide timetable whose occupancy is concentrated in earlier periods.
    // A later period having more occupied classes than the previous period is a soft defect.
    for (let i = 1; i < occupied.length; i += 1) {
      schoolFrontLoad += Math.max(0, occupied[i] - occupied[i - 1]);
    }
  }

  return { schoolSlotCoverage, schoolFrontLoad };
};

const balancedDeviation = (loads: number[]) => {
  if (loads.length < 2) return 0;
  const average = loads.reduce((sum, value) => sum + value, 0) / loads.length;
  return loads.reduce((sum, value) => sum + Math.abs(value - average), 0);
};

export const evaluateSchedule = (assignments: Assignment[], config: SchedulingConfig) => {
  const violations: ConstraintViolation[] = [];
  const byTeacherDay = new Map<string, Assignment[]>();
  const byClassDay = new Map<string, Assignment[]>();
  const occupancy = new Map<string, Assignment[]>();
  const bySubject = new Map<string, Assignment[]>();

  for (const item of assignments) {
    const teacherKey = `${item.teacher}::${item.day}`;
    const classKey = `${item.className}::${item.day}`;
    const cellKey = `${item.day}::${item.slot}`;
    const subjectKey = `${item.className}::${item.subject}`;
    byTeacherDay.set(teacherKey, [...(byTeacherDay.get(teacherKey) ?? []), item]);
    byClassDay.set(classKey, [...(byClassDay.get(classKey) ?? []), item]);
    occupancy.set(cellKey, [...(occupancy.get(cellKey) ?? []), item]);
    bySubject.set(subjectKey, [...(bySubject.get(subjectKey) ?? []), item]);

    if (!studyDaysFor(config, item.className).includes(item.day)) violations.push({ code: "CLASS_STUDY_DAY", severity: "hard", assignmentId: item.id, message: `الفصل ${item.className} مجدول في يوم غير دراسي`, day: item.day, slot: item.slot, penalty: 10000 });
    if (item.slot < 1 || item.slot > dailyLimitFor(config, item.className)) violations.push({ code: "CLASS_DAILY_LIMIT", severity: "hard", assignmentId: item.id, message: `الحصة تتجاوز الحد اليومي للفصل ${item.className}`, day: item.day, slot: item.slot, penalty: 10000 });
    if (teacherUnavailable(config, item.teacher, item.day, item.slot)) violations.push({ code: "TEACHER_UNAVAILABLE", severity: "hard", assignmentId: item.id, message: `المعلم ${item.teacher} غير متاح`, day: item.day, slot: item.slot, penalty: 15000 });
    if (roomUnavailable(config, item.room, item.day, item.slot)) violations.push({ code: "ROOM_UNAVAILABLE", severity: "hard", assignmentId: item.id, message: `الغرفة ${item.room} غير متاحة`, day: item.day, slot: item.slot, penalty: 15000 });
  }

  for (const [cell, items] of occupancy) {
    const classes = new Set(items.map((x) => x.className));
    const teachers = new Set(items.map((x) => x.teacher));
    const rooms = items.filter((x) => x.room).map((x) => x.room!);
    if (classes.size !== items.length) violations.push({ code: "CLASS_COLLISION", severity: "hard", message: `تعارض فصل في ${cell}`, penalty: 20000 });
    if (teachers.size !== items.length) violations.push({ code: "TEACHER_COLLISION", severity: "hard", message: `تعارض معلم في ${cell}`, penalty: 20000 });
    if (rooms.length && new Set(rooms).size !== rooms.length) violations.push({ code: "ROOM_COLLISION", severity: "hard", message: `تعارض غرفة في ${cell}`, penalty: 18000 });
  }

  let teacherGaps = 0;
  let internalClassGaps = 0;
  let sameSubjectSameDay = 0;
  let subjectSpacingViolations = 0;
  let dailyLoadImbalance = 0;
  let teacherLoadImbalance = 0;
  let classDailyBalance = 0;

  for (const [key, items] of byTeacherDay) {
    const [teacher, day] = key.split("::");
    const gaps = gapsOf(items.map((x) => x.slot));
    teacherGaps += gaps;
    const explicit = items.map((x) => teacherSlotLimitFor(config, teacher, day, x.slot)).filter((x) => x >= 0);
    const limit = explicit.length ? Math.min(...explicit) : teacherGapLimitFor(config, teacher, day);
    if (gaps > limit) violations.push({ code: "TEACHER_GAPS", severity: "hard", message: `المعلم ${teacher} لديه ${gaps} فراغات يوم ${day}`, penalty: 5000 + gaps * 100 });
  }

  for (const [key, items] of byClassDay) {
    const gaps = gapsOf(items.map((x) => x.slot));
    internalClassGaps += gaps;
    const subjectCounts = new Map<string, number>();
    items.forEach((x) => subjectCounts.set(x.subject, (subjectCounts.get(x.subject) ?? 0) + 1));
    for (const [subject, count] of subjectCounts) if (count > 1) sameSubjectSameDay += count - 1;
    const max = items.length ? dailyLimitFor(config, items[0].className) : 0;
    if (items.length > max) violations.push({ code: "CLASS_DAILY_LIMIT", severity: "hard", message: `الحمل اليومي للفصل ${items[0].className} مرتفع`, penalty: 10000 });
  }

  for (const [key, items] of bySubject) {
    const [className, subject] = key.split("::");
    const requirement = config.requirements?.find((r) => r.className === className && r.subject === subject);
    const minGap = Math.max(0, requirement?.minGapBetweenSameSubject ?? 0);
    const sortedByDay = [...items].sort((a, b) => dayIndex(config, a.day) - dayIndex(config, b.day) || a.slot - b.slot);

    if (requirement?.consecutive && items.length > 1) {
      const firstDay = sortedByDay[0].day;
      const slots = sortedByDay.filter((x) => x.day === firstDay).map((x) => x.slot).sort((a, b) => a - b);
      const hasBlock = slots.length === items.length && slots.every((slot, i) => i === 0 || slot === slots[i - 1] + 1);
      if (!hasBlock) violations.push({ code: "CONSECUTIVE_BLOCK", severity: "hard", message: `حصص ${subject} للفصل ${className} يجب أن تكون متتالية`, penalty: 12000 });
    }

    const days = sortedByDay.map((x) => dayIndex(config, x.day)).filter((x) => x >= 0);
    for (let i = 1; i < days.length; i += 1) if (days[i] - days[i - 1] <= minGap) subjectSpacingViolations += 1;
  }

  const classDayLoads = new Map<string, number[]>();
  for (const item of assignments) {
    const allowedDays = studyDaysFor(config, item.className);
    const loads = classDayLoads.get(item.className) ?? allowedDays.map(() => 0);
    const i = allowedDays.indexOf(item.day);
    if (i >= 0) loads[i] += 1;
    classDayLoads.set(item.className, loads);
  }
  for (const loads of classDayLoads.values()) if (loads.length) {
    dailyLoadImbalance += Math.max(...loads) - Math.min(...loads);
    classDailyBalance += balancedDeviation(loads);
  }

  const teacherDayLoads = new Map<string, number[]>();
  for (const item of assignments) {
    const loads = teacherDayLoads.get(item.teacher) ?? config.days.map(() => 0);
    const i = config.days.indexOf(item.day);
    if (i >= 0) loads[i] += 1;
    teacherDayLoads.set(item.teacher, loads);
  }
  for (const loads of teacherDayLoads.values()) if (loads.length) teacherLoadImbalance += Math.max(...loads) - Math.min(...loads);

  const preferenceMisses = preferenceMissCount(assignments, config);
  const roomChanges = roomChangeCount(assignments);
  const { schoolSlotCoverage, schoolFrontLoad } = schoolCoverageMetrics(assignments, config);
  const w = weight(config);
  const softPenalty =
    internalClassGaps * w.internalClassGap +
    teacherGaps * w.teacherGap +
    sameSubjectSameDay * w.sameSubjectSameDay +
    subjectSpacingViolations * w.subjectSpacing +
    dailyLoadImbalance * w.dailyLoadImbalance +
    preferenceMisses * w.preferenceMiss +
    teacherLoadImbalance * w.teacherLoadImbalance +
    roomChanges * w.roomChange +
    schoolSlotCoverage * w.schoolSlotCoverage +
    schoolFrontLoad * w.schoolFrontLoad +
    classDailyBalance * w.classDailyBalance;

  return {
    violations,
    softPenalty,
    hardViolations: violations.filter((x) => x.severity === "hard").length,
    teacherGaps,
    internalClassGaps,
    sameSubjectSameDay,
    subjectSpacingViolations,
    dailyLoadImbalance,
    teacherLoadImbalance,
    preferenceMisses,
    schoolSlotCoverage,
    schoolFrontLoad,
    classDailyBalance,
    roomChanges,
  };
};

export type ScheduleQualityBreakdown = {
  overall: number;
  conflicts: number;
  completion: number;
  classCohesion: number;
  teacherBalance: number;
  dayBalance: number;
  schoolUtilization: number;
  preferences: number;
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Human-readable quality score for the generated timetable.
 * This is deliberately separate from the solver objective: it explains the result
 * to the user without exposing raw penalty units. Hard violations dominate the score.
 */
export const scoreScheduleQuality = (
  evaluation: ReturnType<typeof evaluateSchedule>,
  placed: number,
  total: number,
): ScheduleQualityBreakdown => {
  const conflicts = evaluation.hardViolations === 0 ? 100 : clampScore(100 - evaluation.hardViolations * 25);
  const completion = total > 0 ? clampScore((placed / total) * 100) : 100;
  const classCohesion = clampScore(100 - evaluation.internalClassGaps * 12 - evaluation.sameSubjectSameDay * 7);
  const teacherBalance = clampScore(100 - evaluation.teacherGaps * 10 - evaluation.teacherLoadImbalance * 8);
  const dayBalance = clampScore(100 - evaluation.dailyLoadImbalance * 8 - evaluation.classDailyBalance * 3);
  const schoolUtilization = clampScore(100 - evaluation.schoolSlotCoverage * 5 - evaluation.schoolFrontLoad * 4);
  const preferences = clampScore(100 - evaluation.preferenceMisses * 8 - evaluation.subjectSpacingViolations * 6 - evaluation.roomChanges * 2);

  const overall = clampScore(
    conflicts * 0.25 +
    completion * 0.20 +
    classCohesion * 0.14 +
    teacherBalance * 0.12 +
    dayBalance * 0.10 +
    schoolUtilization * 0.12 +
    preferences * 0.07,
  );

  return { overall, conflicts, completion, classCohesion, teacherBalance, dayBalance, schoolUtilization, preferences };
};
