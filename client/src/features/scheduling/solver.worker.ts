/**
 * Web Worker entry point for the scheduling solver.
 * This runs the CPU-intensive search off the main thread.
 */
import { solveSchedule, optimizeSchedule, expandRequirements } from "./solver";
import type { Assignment, SchedulingConfig, SolverResult } from "./model";
import type { SolverOptions, OptimizeScheduleOptions } from "./solver";

// Message types for worker communication
type WorkerMessage =
  | { type: "SOLVE"; payload: { input: Assignment[]; config: SchedulingConfig; options?: SolverOptions }; requestId: number }
  | { type: "OPTIMIZE"; payload: { assignments: Assignment[]; config: SchedulingConfig; options?: OptimizeScheduleOptions }; requestId: number }
  | { type: "EXPAND"; payload: { requirements: SchedulingConfig["requirements"] }; requestId: number };

type WorkerResponse =
  | { type: "SOLVE_RESULT"; result: SolverResult; requestId: number }
  | { type: "OPTIMIZE_RESULT"; result: SolverResult; requestId: number }
  | { type: "EXPAND_RESULT"; result: Assignment[]; requestId: number }
  | { type: "ERROR"; error: string; requestId: number };

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, payload, requestId } = event.data;

  try {
    switch (type) {
      case "SOLVE": {
        const result = solveSchedule(payload.input, payload.config, payload.options);
        self.postMessage({ type: "SOLVE_RESULT", result, requestId } satisfies WorkerResponse);
        break;
      }
      case "OPTIMIZE": {
        const result = optimizeSchedule(payload.assignments, payload.config, payload.options);
        self.postMessage({ type: "OPTIMIZE_RESULT", result, requestId } satisfies WorkerResponse);
        break;
      }
      case "EXPAND": {
        const result = expandRequirements(payload.requirements);
        self.postMessage({ type: "EXPAND_RESULT", result, requestId } satisfies WorkerResponse);
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      error: error instanceof Error ? error.message : "Unknown solver error",
      requestId,
    } satisfies WorkerResponse);
  }
};

export {}; // Make this a module