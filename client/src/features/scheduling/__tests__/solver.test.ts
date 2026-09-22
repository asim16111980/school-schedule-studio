import { describe, expect, it } from "vitest";
import { evaluateSchedule, expandRequirements, solveSchedule } from "@/features/scheduling";
import type { Assignment, SchedulingConfig } from "@/features/scheduling";

const base: SchedulingConfig = {
  days: ["الأحد", "الإثنين", "الثلاثاء"],
  timeSlots: [{ slot: 1, time: "1" }, { slot: 2, time: "2" }, { slot: 3, time: "3" }],
  classes: ["1/1"],
  stageDailySlots: { "1": 3 },
  stageStudyDays: { "1": ["الأحد", "الإثنين", "الثلاثاء"] },
  teacherGapLimits: { T: { "الأحد": 0, "الإثنين": 0, "الثلاثاء": 0 } },
  teacherSlotLimits: { T: { "الأحد": { 1: -1, 2: -1, 3: -1 }, "الإثنين": { 1: -1, 2: -1, 3: -1 }, "الثلاثاء": { 1: -1, 2: -1, 3: -1 } } },
};

const lesson = (id: string, subject = "رياضيات", teacher = "T"): Assignment => ({ id, subject, teacher, className: "1/1", day: "الأحد", slot: 1 });

describe("constraint solver", () => {
  it("prevents class and teacher collisions", () => {
    const result = solveSchedule([lesson("a"), lesson("b", "علوم")], base);
    expect(result.metrics.hardViolations).toBe(0);
    expect(new Set(result.assignments.map((x) => `${x.day}:${x.slot}`)).size).toBe(result.assignments.length);
  });

  it("preserves locked placements", () => {
    const locked = { ...lesson("locked"), locked: true, day: "الإثنين", slot: 2 };
    const result = solveSchedule([locked, lesson("movable")], base);
    expect(result.assignments.find((x) => x.id === "locked")?.day).toBe("الإثنين");
    expect(result.assignments.find((x) => x.id === "locked")?.slot).toBe(2);
  });

  it("does not claim completion when capacity is impossible", () => {
    const config = { ...base, days: ["الأحد"], stageStudyDays: { "1": ["الأحد"] }, teacherGapLimits: { T: { "الأحد": 0 } } };
    const result = solveSchedule([lesson("a"), lesson("b", "علوم"), lesson("c", "إنجليزي"), lesson("d", "نشاط")], config);
    expect(result.complete).toBe(false);
    expect(result.unplaced.length).toBeGreaterThan(0);
  });

  it("supports weekly curriculum expansion", () => {
    const items = expandRequirements([{ className: "1/1", subject: "رياضيات", teacher: "T", weeklyLessons: 5 }]);
    expect(items).toHaveLength(5);
    expect(new Set(items.map((x) => x.id)).size).toBe(5);
  });

  it("reports preference misses as soft cost", () => {
    const config = { ...base, requirements: [{ className: "1/1", subject: "رياضيات", teacher: "T", weeklyLessons: 1, preferredDays: ["الثلاثاء"] }] };
    const evaluation = evaluateSchedule([{ ...lesson("a") }], config);
    expect(evaluation.preferenceMisses).toBe(1);
  });

  it("applies subject spacing by day, not by slot number across different days", () => {
    const config = { ...base, requirements: [{ className: "1/1", subject: "رياضيات", teacher: "T", weeklyLessons: 2, minGapBetweenSameSubject: 1 }] };
    const evaluation = evaluateSchedule([
      { ...lesson("a"), day: "الأحد", slot: 1 },
      { ...lesson("b"), day: "الثلاثاء", slot: 2 },
    ], config);
    expect(evaluation.subjectSpacingViolations).toBe(0);
  });

  it("uses teacher load imbalance in the soft objective", () => {
    const config = { ...base, weights: { teacherLoadImbalance: 50 } };
    const evaluation = evaluateSchedule([
      { ...lesson("a"), day: "الأحد", slot: 1 },
      { ...lesson("b"), day: "الأحد", slot: 2 },
      { ...lesson("c"), day: "الإثنين", slot: 1 },
    ], config);
    expect(evaluation.teacherLoadImbalance).toBe(2);
    expect(evaluation.softPenalty).toBeGreaterThanOrEqual(100);
  });

  it("treats an explicitly empty study-day configuration as empty", () => {
    const config = { ...base, stageStudyDays: { "1": [] } };
    const result = solveSchedule([lesson("a")], config);
    expect(result.complete).toBe(false);
    expect(result.unplaced).toHaveLength(1);
  });

  it("treats an explicitly zero daily limit as zero capacity", () => {
    const config = { ...base, stageDailySlots: { "1": 0 } };
    const result = solveSchedule([lesson("a")], config);
    expect(result.complete).toBe(false);
    expect(result.unplaced).toHaveLength(1);
  });

  it("supports a consecutive block without allowing a second day", () => {
    const config = { ...base, requirements: [{ className: "1/1", subject: "رياضيات", teacher: "T", weeklyLessons: 2, maxPerDay: 2, consecutive: true }] };
    const result = solveSchedule(expandRequirements(config.requirements), config);
    expect(result.complete).toBe(true);
    expect(new Set(result.assignments.map((x) => x.day)).size).toBe(1);
    expect(new Set(result.assignments.map((x) => x.slot)).size).toBe(2);
  });
  it("penalizes school-wide underutilization of available slots", () => {
    const config = { ...base, classes: ["1/1", "1/2"] };
    const evaluation = evaluateSchedule([
      { ...lesson("a"), className: "1/1", day: "الأحد", slot: 1 },
    ], config);
    expect(evaluation.schoolSlotCoverage).toBeGreaterThan(0);
  });

  it("prefers full school periods over partially filled periods", () => {
    const config = { ...base, classes: ["1/1", "1/2"] };
    const packed = evaluateSchedule([
      { ...lesson("a"), className: "1/1", day: "الأحد", slot: 1 },
      { ...lesson("b"), className: "1/2", day: "الأحد", slot: 1 },
    ], config);
    const split = evaluateSchedule([
      { ...lesson("a"), className: "1/1", day: "الأحد", slot: 1 },
      { ...lesson("b"), className: "1/2", day: "الأحد", slot: 2 },
    ], config);
    expect(packed.schoolSlotCoverage).toBeLessThan(split.schoolSlotCoverage);
  });

  it("penalizes a later-period occupancy spike", () => {
    const config = { ...base, classes: ["1/1", "1/2"] };
    const evaluation = evaluateSchedule([
      { ...lesson("a"), className: "1/1", day: "الأحد", slot: 1 },
      { ...lesson("b"), className: "1/2", day: "الأحد", slot: 2 },
    ], config);
    expect(evaluation.schoolFrontLoad).toBeGreaterThan(0);
  });

  it("measures class daily balance against the average, including zero-load study days", () => {
    const config = { ...base, classes: ["1/1"] };
    const evaluation = evaluateSchedule([
      { ...lesson("a"), day: "الأحد", slot: 1 },
      { ...lesson("b"), day: "الأحد", slot: 2 },
      { ...lesson("c"), day: "الإثنين", slot: 1 },
    ], config);
    expect(evaluation.classDailyBalance).toBeGreaterThan(0);
  });

  it("supports multi-start search without changing the public result shape", () => {
    const result = solveSchedule([lesson("a"), lesson("b", "علوم"), lesson("c", "إنجليزي")], base, { multiStart: 3, seed: 1234, timeLimitMs: 1200, maxNodes: 12000 });
    expect(result.assignments.length).toBe(3);
    expect(result.complete).toBe(true);
    expect(result.exploredNodes).toBeGreaterThan(0);
  });

  it("keeps useful partial placements when the search budget expires", () => {
    const config = { ...base, days: ["الأحد"], stageStudyDays: { "1": ["الأحد"] }, stageDailySlots: { "1": 2 } };
    const result = solveSchedule([lesson("a"), lesson("b", "علوم"), lesson("c", "إنجليزي")], config, { multiStart: 2, seed: 7, timeLimitMs: 250, maxNodes: 4000 });
    expect(result.complete).toBe(false);
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.unplaced.length).toBeGreaterThan(0);
  });

});
