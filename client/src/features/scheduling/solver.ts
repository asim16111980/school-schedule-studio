import { evaluateSchedule, placementViolations, dailyLimitFor, studyDaysFor } from "./constraints";
import type { Assignment, SchedulingConfig, SolverResult } from "./model";

export type SolverOptions = Pick<SchedulingConfig, "maxNodes" | "timeLimitMs"> & {
  /** Number of independent randomized starts sharing the total time/node budget. */
  multiStart?: number;
  /** Optional seed for reproducible randomized starts. */
  seed?: number;
};

type Candidate = { day: string; slot: number };

const objective = (evaluation: ReturnType<typeof evaluateSchedule>, placed: number, total: number) =>
  evaluation.hardViolations * 1_000_000_000 + (total - placed) * 10_000_000 + evaluation.softPenalty;

const compare = (
  a: ReturnType<typeof evaluateSchedule>,
  b: ReturnType<typeof evaluateSchedule>,
  placedA: number,
  placedB: number,
  total: number,
) => objective(a, placedA, total) - objective(b, placedB, total);

const candidateValues = (item: Assignment, config: SchedulingConfig): Candidate[] => {
  const values: Candidate[] = [];
  for (const day of studyDaysFor(config, item.className)) {
    for (let slot = 1; slot <= dailyLimitFor(config, item.className); slot += 1) values.push({ day, slot });
  }
  return values;
};

const requirementForItem = (item: Assignment, config: SchedulingConfig) =>
  config.requirements?.find((r) => r.className === item.className && r.subject === item.subject && r.teacher === item.teacher);

/**
 * Static pressure score used before MRV. Higher pressure means "schedule this first".
 * This deliberately favors scarce resources and structurally difficult requirements.
 */
const requirementDifficulty = (item: Assignment, config: SchedulingConfig) => {
  const requirement = requirementForItem(item, config);
  const days = studyDaysFor(config, item.className);
  const slotsPerDay = dailyLimitFor(config, item.className);
  const rawCapacity = Math.max(1, days.length * slotsPerDay);
  let score = 0;

  // Structural constraints.
  if (requirement?.consecutive) score += 180;
  if ((requirement?.maxPerDay ?? 1) === 1) score += 55;
  if ((requirement?.minGapBetweenSameSubject ?? 0) > 0) score += 45 + (requirement?.minGapBetweenSameSubject ?? 0) * 8;
  if (requirement?.preferredDays?.length) score += 25;
  if (requirement?.preferredSlots?.length) score += 25;

  // Scarcity of legal calendar space.
  const preferredDayRatio = requirement?.preferredDays?.length ? requirement.preferredDays.length / Math.max(1, days.length) : 1;
  const preferredSlotRatio = requirement?.preferredSlots?.length ? requirement.preferredSlots.length / Math.max(1, slotsPerDay) : 1;
  score += Math.round((1 - Math.min(1, preferredDayRatio * preferredSlotRatio)) * 90);

  // A high weekly requirement consumes a larger share of the class calendar.
  const weekly = Math.max(1, Math.floor(requirement?.weeklyLessons ?? 1));
  score += Math.round(Math.min(100, (weekly / rawCapacity) * 180));

  // Teacher scarcity: fewer available slots => higher priority.
  const unavailable = item.teacher && config.teacherAvailability?.[item.teacher]?.unavailable?.length
    ? config.teacherAvailability[item.teacher].unavailable?.filter((x) => days.includes(x.day) && x.slot <= slotsPerDay).length ?? 0
    : 0;
  const teacherCapacity = Math.max(1, rawCapacity - unavailable);
  score += Math.round((unavailable / rawCapacity) * 110);
  if (teacherCapacity <= weekly + 1) score += 90;

  // Fixed room + room unavailability makes a requirement more constrained.
  if (item.room) {
    const unavailableRoomSlots = config.roomAvailability?.[item.room]?.filter((x) => days.includes(x.day) && x.slot <= slotsPerDay).length ?? 0;
    score += Math.round((unavailableRoomSlots / rawCapacity) * 80);
    score += 20;
  }

  return score;
};

const orderByDifficulty = (items: Assignment[], config: SchedulingConfig) => [...items].sort((a, b) => {
  const ca = candidateValues(a, config).length;
  const cb = candidateValues(b, config).length;
  if (ca !== cb) return ca - cb;
  const da = requirementDifficulty(a, config);
  const db = requirementDifficulty(b, config);
  return db - da || a.teacher.localeCompare(b.teacher) || a.className.localeCompare(b.className) || a.id.localeCompare(b.id);
});

const buildCandidates = (item: Assignment, placed: Assignment[], config: SchedulingConfig) =>
  candidateValues(item, config).filter((candidate) => placementViolations(item, candidate, placed, config).length === 0);

/**
 * Constraint solver using MRV + forward checking + branch ordering + bounded search.
 * Hard constraints are rejected incrementally; soft objectives are compared only at leaves.
 */
type SingleRunOptions = SolverOptions & { seed: number };

const mulberry32 = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const runSingleStart = (
  input: Assignment[],
  config: SchedulingConfig,
  options: SingleRunOptions,
): SolverResult => {
  const started = performance.now();
  const lockedIds = new Set(config.lockedAssignmentIds ?? input.filter((x) => x.locked).map((x) => x.id));
  const locked = input.filter((x) => lockedIds.has(x.id));
  const movable = input.filter((x) => !lockedIds.has(x.id));
  const maxNodes = options.maxNodes ?? config.maxNodes ?? Math.max(100_000, input.length * 10_000);
  const timeLimitMs = options.timeLimitMs ?? config.timeLimitMs ?? Math.min(12_000, Math.max(2_000, input.length * 45));
  // Reserve a meaningful slice of the run for post-solve local improvement.
  const searchDeadline = started + Math.max(100, Math.floor(timeLimitMs * 0.72));
  const deadline = started + timeLimitMs;
  const rng = mulberry32(options.seed);

  const lockedEval = evaluateSchedule(locked, config);
  if (lockedEval.hardViolations) {
    return {
      assignments: locked,
      unplaced: movable,
      violations: lockedEval.violations,
      metrics: {
        hardViolations: lockedEval.hardViolations,
        softPenalty: lockedEval.softPenalty,
        internalClassGaps: lockedEval.internalClassGaps,
        teacherGaps: lockedEval.teacherGaps,
        sameSubjectSameDay: lockedEval.sameSubjectSameDay,
        subjectSpacingViolations: lockedEval.subjectSpacingViolations,
        dailyLoadImbalance: lockedEval.dailyLoadImbalance,
        teacherLoadImbalance: lockedEval.teacherLoadImbalance,
        preferenceMisses: lockedEval.preferenceMisses,
        schoolSlotCoverage: lockedEval.schoolSlotCoverage,
        schoolFrontLoad: lockedEval.schoolFrontLoad,
        classDailyBalance: lockedEval.classDailyBalance,
        placed: locked.length,
        unplaced: movable.length,
      },
      complete: false,
      exploredNodes: 0,
      durationMs: Math.round(performance.now() - started),
      reason: "الحصص المثبتة تحتوي تعارضات صلبة.",
    };
  }

  // Randomized tie-breaking creates genuinely different search neighborhoods while
  // preserving the deterministic difficulty/MRV priorities.
  const order = orderByDifficulty(movable, config).map((item, index) => ({
    item,
    index,
    jitter: rng(),
  })).sort((a, b) => {
    const da = requirementDifficulty(a.item, config);
    const db = requirementDifficulty(b.item, config);
    if (da !== db) return db - da;
    return a.jitter - b.jitter || a.index - b.index;
  }).map(({ item }) => item);
  const remaining = new Set(order.map((x) => x.id));
  const itemById = new Map(order.map((x) => [x.id, x]));
  const working = [...locked];
  let best = [...locked];
  let bestEval = lockedEval;
  let exploredNodes = 0;

  const canContinue = () => performance.now() < searchDeadline && exploredNodes < maxNodes;

  const forwardCheck = () => {
    for (const id of remaining) {
      const item = itemById.get(id)!;
      if (buildCandidates(item, working, config).length === 0) return false;
    }
    return true;
  };

  const selectMRV = () => {
    let selected: Assignment | undefined;
    let values: Candidate[] = [];
    for (const id of remaining) {
      const item = itemById.get(id)!;
      const legal = buildCandidates(item, working, config);
      if (!selected || legal.length < values.length || (legal.length === values.length && requirementDifficulty(item, config) > requirementDifficulty(selected, config))) {
        selected = item;
        values = legal;
      }
      if (values.length === 0) break;
    }
    return { selected, values };
  };

  const updateBest = () => {
    const evaluation = evaluateSchedule(working, config);
    if (compare(evaluation, bestEval, working.length, best.length, input.length) < 0) {
      best = [...working];
      bestEval = evaluation;
    }
  };

  const search = () => {
    if (!canContinue()) return;
    exploredNodes += 1;

    // Keep the best partial schedule too. This prevents a timed-out run from
    // returning only locked assignments when it has already placed useful work.
    if (working.length > best.length) updateBest();

    if (remaining.size === 0) {
      updateBest();
      return;
    }

    const { selected, values: legalValues } = selectMRV();
    if (!selected) return;

    if (!legalValues.length) {
      remaining.delete(selected.id);
      search();
      remaining.add(selected.id);
      return;
    }

    const candidateJitter = new Map(legalValues.map((candidate) => [`${candidate.day}::${candidate.slot}`, rng()]));

    // Pre-compute scores for all legal values ONCE before sorting.
    // This avoids O(n^2) calls to evaluateSchedule and rebuildCandidates inside the comparator.
    const scoreMap = new Map<string, { softPenalty: number; scarcityScore: number; jitter: number }>();

    for (const value of legalValues) {
      const candidate = { ...selected, ...value };
      const evaluation = evaluateSchedule([...working, candidate], config);

      // Compute scarcity score once per candidate
      let scarcity = 0;
      let checked = 0;
      for (const id of remaining) {
        if (id === selected.id) continue;
        const item = itemById.get(id);
        if (!item) continue;
        const domain = buildCandidates(item, [...working, candidate], config).length;
        scarcity += domain <= 1 ? 120 : domain <= 3 ? 45 : domain <= 6 ? 15 : 0;
        checked += 1;
        if (checked >= 8) break;
      }

      scoreMap.set(`${value.day}::${value.slot}`, {
        softPenalty: evaluation.softPenalty,
        scarcityScore: scarcity,
        jitter: candidateJitter.get(`${value.day}::${value.slot}`) ?? 0,
      });
    }

    legalValues.sort((a, b) => {
      const keyA = `${a.day}::${a.slot}`;
      const keyB = `${b.day}::${b.slot}`;
      const scoreA = scoreMap.get(keyA)!;
      const scoreB = scoreMap.get(keyB)!;

      const computedA = scoreA.softPenalty * 1000 + scoreA.scarcityScore * 10 + scoreA.jitter;
      const computedB = scoreB.softPenalty * 1000 + scoreB.scarcityScore * 10 + scoreB.jitter;
      if (computedA !== computedB) return computedA - computedB;
      return (config.days.indexOf(a.day) - config.days.indexOf(b.day)) || (a.slot - b.slot);
    });

    for (const value of legalValues) {
      if (!canContinue()) break;
      const next = { ...selected, ...value };
      working.push(next);
      remaining.delete(selected.id);

      if (forwardCheck()) search();

      remaining.add(selected.id);
      working.pop();
    }
  };

  search();

  /**
   * Post-solve local improvement. Starting from the best feasible schedule found by
   * the constraint search, try small neighborhoods (single moves and pair swaps).
   * A move is accepted only when it preserves all hard constraints and improves the
   * school-wide objective. This is deliberately bounded by the remaining run budget.
   */
  const improveLocally = () => {
    if (!best.length || performance.now() >= deadline || exploredNodes >= maxNodes) return;
    const lockedSet = lockedIds;
    let current = [...best];
    let currentEval = bestEval;
    const movablePlaced = () => current.filter((x) => !lockedSet.has(x.id));
    const score = (evaluation: ReturnType<typeof evaluateSchedule>) =>
      objective(evaluation, current.length, input.length);

    // A bounded number of passes keeps large school schedules responsive.
    for (let pass = 0; pass < 6 && performance.now() < deadline && exploredNodes < maxNodes; pass += 1) {
      let improved = false;
      const items = movablePlaced();

      // 1) Relocate one lesson to a better legal slot.
      for (const item of items) {
        if (performance.now() >= deadline || exploredNodes >= maxNodes) break;
        const others = current.filter((x) => x.id !== item.id);
        const candidates = candidateValues(item, config);
        let bestCandidate: Assignment | undefined;
        let bestCandidateEval: ReturnType<typeof evaluateSchedule> | undefined;
        let bestCandidateScore = score(currentEval);

        for (const candidate of candidates) {
          if (candidate.day === item.day && candidate.slot === item.slot) continue;
          exploredNodes += 1;
          const violations = placementViolations(item, candidate, others, config);
          if (violations.length) continue;
          const nextItem = { ...item, ...candidate };
          const evaluation = evaluateSchedule([...others, nextItem], config);
          if (evaluation.hardViolations !== 0) continue;
          const candidateScore = objective(evaluation, current.length, input.length);
          if (candidateScore < bestCandidateScore) {
            bestCandidateScore = candidateScore;
            bestCandidate = nextItem;
            bestCandidateEval = evaluation;
          }
        }

        if (bestCandidate && bestCandidateEval) {
          current = [...others, bestCandidate];
          currentEval = bestCandidateEval;
          improved = true;
          break;
        }
      }
      if (improved) continue;

      // 2) Swap two movable lessons. This is especially useful for fixing isolated
      // teacher/class gaps without opening a new time slot.
      const swapItems = movablePlaced();
      outer: for (let i = 0; i < swapItems.length; i += 1) {
        if (performance.now() >= deadline || exploredNodes >= maxNodes) break;
        for (let j = i + 1; j < swapItems.length; j += 1) {
          if (performance.now() >= deadline || exploredNodes >= maxNodes) break outer;
          const a = swapItems[i];
          const b = swapItems[j];
          // Swapping identical slots is a no-op; otherwise each lesson inherits the
          // other's day/slot while retaining its own teacher/class/subject/room.
          if (a.day === b.day && a.slot === b.slot) continue;
          const rest = current.filter((x) => x.id !== a.id && x.id !== b.id);
          exploredNodes += 1;
          const aNext = { ...a, day: b.day, slot: b.slot };
          const bNext = { ...b, day: a.day, slot: a.slot };
          if (placementViolations(a, { day: aNext.day, slot: aNext.slot }, rest, config).length) continue;
          if (placementViolations(b, { day: bNext.day, slot: bNext.slot }, [...rest, aNext], config).length) continue;
          const evaluation = evaluateSchedule([...rest, aNext, bNext], config);
          if (evaluation.hardViolations !== 0) continue;
          if (objective(evaluation, current.length, input.length) < score(currentEval)) {
            current = [...rest, aNext, bNext];
            currentEval = evaluation;
            improved = true;
            break outer;
          }
        }
      }
      if (!improved) break;
    }

    best = [...current];
    bestEval = currentEval;
  };

  improveLocally();

  const placedIds = new Set(best.map((x) => x.id));
  const unplaced = input.filter((x) => !placedIds.has(x.id));
  const finalEval = evaluateSchedule(best, config);
  return {
    assignments: [...best].sort((a, b) => a.id.localeCompare(b.id)),
    unplaced,
    violations: finalEval.violations,
    metrics: {
      hardViolations: finalEval.hardViolations,
      softPenalty: finalEval.softPenalty,
      internalClassGaps: finalEval.internalClassGaps,
      teacherGaps: finalEval.teacherGaps,
      sameSubjectSameDay: finalEval.sameSubjectSameDay,
      subjectSpacingViolations: finalEval.subjectSpacingViolations,
      dailyLoadImbalance: finalEval.dailyLoadImbalance,
      teacherLoadImbalance: finalEval.teacherLoadImbalance,
      preferenceMisses: finalEval.preferenceMisses,
      schoolSlotCoverage: finalEval.schoolSlotCoverage,
      schoolFrontLoad: finalEval.schoolFrontLoad,
      classDailyBalance: finalEval.classDailyBalance,
      placed: best.length,
      unplaced: unplaced.length,
    },
    complete: unplaced.length === 0 && finalEval.hardViolations === 0,
    exploredNodes,
    durationMs: Math.round(performance.now() - started),
    reason: unplaced.length ? `تعذر توزيع ${unplaced.length} حصة ضمن الموارد والقيود الحالية.` : undefined,
  };
};


export type OptimizeScheduleOptions = {
  timeLimitMs?: number;
  maxNodes?: number;
  seed?: number;
};

/**
 * Improve an already generated timetable without rebuilding it from scratch.
 * Locked lessons remain untouched. Every accepted move preserves all hard constraints.
 */
export function optimizeSchedule(
  assignments: Assignment[],
  config: SchedulingConfig,
  options: OptimizeScheduleOptions = {},
): SolverResult {
  const started = performance.now();
  const deadline = started + Math.max(250, options.timeLimitMs ?? 3500);
  const maxNodes = Math.max(500, options.maxNodes ?? 15000);
  const lockedIds = new Set(config.lockedAssignmentIds ?? assignments.filter((x) => x.locked).map((x) => x.id));
  let current = [...assignments];
  let currentEval = evaluateSchedule(current, config);
  let exploredNodes = 0;
  let improvedMoves = 0;

  const score = (evaluation: ReturnType<typeof evaluateSchedule>) =>
    objective(evaluation, current.length, current.length);

  const rng = mulberry32(options.seed ?? 0x7a11c0de);
  const movable = () => current.filter((x) => !lockedIds.has(x.id));

  for (let pass = 0; pass < 8 && performance.now() < deadline && exploredNodes < maxNodes; pass += 1) {
    let improved = false;
    const items = movable().sort(() => rng() - 0.5);

    // Prefer moving lessons that currently contribute to soft penalties.
    for (const item of items) {
      if (performance.now() >= deadline || exploredNodes >= maxNodes) break;
      const rest = current.filter((x) => x.id !== item.id);
      let bestItem: Assignment | undefined;
      let bestEval = currentEval;
      let bestScore = score(currentEval);
      const candidates = candidateValues(item, config).sort(() => rng() - 0.5);

      for (const candidate of candidates) {
        if (candidate.day === item.day && candidate.slot === item.slot) continue;
        exploredNodes += 1;
        const violations = placementViolations(item, candidate, rest, config);
        if (violations.length) continue;
        const nextItem = { ...item, ...candidate };
        const evaluation = evaluateSchedule([...rest, nextItem], config);
        if (evaluation.hardViolations !== 0) continue;
        const nextScore = objective(evaluation, current.length, current.length);
        if (nextScore < bestScore) {
          bestScore = nextScore;
          bestItem = nextItem;
          bestEval = evaluation;
        }
      }

      if (bestItem) {
        current = [...rest, bestItem];
        currentEval = bestEval;
        improved = true;
        improvedMoves += 1;
        break;
      }
    }

    if (improved) continue;

    // Try swaps as a second neighborhood. Useful when no single move improves the score.
    const itemsForSwap = movable();
    outer: for (let i = 0; i < itemsForSwap.length; i += 1) {
      if (performance.now() >= deadline || exploredNodes >= maxNodes) break outer;
      for (let j = i + 1; j < itemsForSwap.length; j += 1) {
        if (performance.now() >= deadline || exploredNodes >= maxNodes) break outer;
        const a = itemsForSwap[i];
        const b = itemsForSwap[j];
        if (a.day === b.day && a.slot === b.slot) continue;
        const rest = current.filter((x) => x.id !== a.id && x.id !== b.id);
        const aNext = { ...a, day: b.day, slot: b.slot };
        const bNext = { ...b, day: a.day, slot: a.slot };
        exploredNodes += 1;
        if (placementViolations(a, { day: aNext.day, slot: aNext.slot }, rest, config).length) continue;
        if (placementViolations(b, { day: bNext.day, slot: bNext.slot }, [...rest, aNext], config).length) continue;
        const evaluation = evaluateSchedule([...rest, aNext, bNext], config);
        if (evaluation.hardViolations !== 0) continue;
        if (objective(evaluation, current.length, current.length) < score(currentEval)) {
          current = [...rest, aNext, bNext];
          currentEval = evaluation;
          improvedMoves += 1;
          improved = true;
          break outer;
        }
      }
    }

    if (!improved) break;
  }

  const finalEval = evaluateSchedule(current, config);
  return {
    assignments: [...current].sort((a, b) => a.id.localeCompare(b.id)),
    unplaced: [],
    violations: finalEval.violations,
    metrics: {
      hardViolations: finalEval.hardViolations,
      softPenalty: finalEval.softPenalty,
      internalClassGaps: finalEval.internalClassGaps,
      teacherGaps: finalEval.teacherGaps,
      sameSubjectSameDay: finalEval.sameSubjectSameDay,
      subjectSpacingViolations: finalEval.subjectSpacingViolations,
      dailyLoadImbalance: finalEval.dailyLoadImbalance,
      teacherLoadImbalance: finalEval.teacherLoadImbalance,
      preferenceMisses: finalEval.preferenceMisses,
      schoolSlotCoverage: finalEval.schoolSlotCoverage,
      schoolFrontLoad: finalEval.schoolFrontLoad,
      classDailyBalance: finalEval.classDailyBalance,
      placed: current.length,
      unplaced: 0,
    },
    complete: finalEval.hardViolations === 0,
    exploredNodes,
    durationMs: Math.round(performance.now() - started),
    reason: improvedMoves ? `تم تنفيذ ${improvedMoves} تحسينات محلية.` : "لم يجد التحسين المحلي حركة أفضل.",
  };
}

/**
 * School-wide multi-start solver. Independent seeded runs share the total budget;
 * the best complete solution wins, otherwise the best partial solution is returned.
 */
export function solveSchedule(input: Assignment[], config: SchedulingConfig, options?: SolverOptions): SolverResult {
  const totalNodes = options?.maxNodes ?? config.maxNodes ?? Math.max(100_000, input.length * 10_000);
  const totalTime = options?.timeLimitMs ?? config.timeLimitMs ?? Math.min(12_000, Math.max(2_000, input.length * 45));
  const requestedStarts = Math.max(1, Math.floor(options?.multiStart ?? 4));
  const starts = Math.min(requestedStarts, Math.max(1, input.length > 80 ? 4 : 6));
  const perStartNodes = Math.max(2_000, Math.floor(totalNodes / starts));
  const perStartTime = Math.max(250, Math.floor(totalTime / starts));
  const seedBase = options?.seed ?? 0x51ced00d;
  const overallStart = performance.now();

  let best: SolverResult | undefined;
  let exploredNodes = 0;
  for (let i = 0; i < starts; i += 1) {
    const result = runSingleStart(input, config, {
      ...options,
      maxNodes: perStartNodes,
      timeLimitMs: perStartTime,
      seed: (seedBase + Math.imul(i + 1, 0x9e3779b9)) >>> 0,
    });
    exploredNodes += result.exploredNodes;
    const resultScore = result.metrics.hardViolations * 1_000_000_000 + result.metrics.unplaced * 10_000_000 + result.metrics.softPenalty;
    const bestScore = best ? best.metrics.hardViolations * 1_000_000_000 + best.metrics.unplaced * 10_000_000 + best.metrics.softPenalty : Number.POSITIVE_INFINITY;
    if (!best || resultScore < bestScore || (resultScore === bestScore && result.assignments.length > best.assignments.length)) best = result;
    if (result.complete) {
      // Keep searching other starts: a complete solution can still have a much lower soft penalty.
    }
  }

  if (!best) throw new Error("تعذر تشغيل محرك الجدولة.");
  return {
    ...best,
    exploredNodes,
    durationMs: Math.round(performance.now() - overallStart),
    reason: best.complete ? undefined : best.reason,
  };
}

/** Expand curriculum requirements into weekly lesson variables. */
export function expandRequirements(requirements: SchedulingConfig["requirements"] = []): Assignment[] {
  return requirements.flatMap((r, requirementIndex) => Array.from({ length: Math.max(0, Math.floor(r.weeklyLessons)) }, (_, i) => ({
    id: r.id ? `${r.id}-${i + 1}` : `req-${requirementIndex + 1}-${i + 1}`,
    subject: r.subject,
    teacher: r.teacher,
    className: r.className,
    day: "",
    slot: 0,
    room: r.room,
  })));
}
