/**
 * Client-side wrapper for the scheduling solver Web Worker.
 * Provides the same API as the direct solver but runs in a background thread.
 */
import type { Assignment, SchedulingConfig, SolverResult } from "./model";
import type { SolverOptions, OptimizeScheduleOptions } from "./solver";

type WorkerMessage =
  | { type: "SOLVE"; payload: { input: Assignment[]; config: SchedulingConfig; options?: SolverOptions }; requestId: number }
  | { type: "OPTIMIZE"; payload: { assignments: Assignment[]; config: SchedulingConfig; options?: OptimizeScheduleOptions }; requestId: number }
  | { type: "EXPAND"; payload: { requirements: SchedulingConfig["requirements"] }; requestId: number };

type WorkerResponse =
  | { type: "SOLVE_RESULT"; result: SolverResult; requestId: number }
  | { type: "OPTIMIZE_RESULT"; result: SolverResult; requestId: number }
  | { type: "EXPAND_RESULT"; result: Assignment[]; requestId: number }
  | { type: "ERROR"; error: string; requestId: number };

class SolverWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private getWorker(): Worker {
    if (!this.worker) {
      // Use dynamic import to create the worker
      this.worker = new Worker(new URL("./solver.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        const pending = this.pending.get(data.requestId);
        if (!pending) return;

        if (data.type === "ERROR") {
          pending.reject(new Error(data.error));
        } else if (data.type === "SOLVE_RESULT" || data.type === "OPTIMIZE_RESULT") {
          pending.resolve(data.result);
        } else if (data.type === "EXPAND_RESULT") {
          pending.resolve(data.result);
        }
        this.pending.delete(data.requestId);
      };
      this.worker.onerror = (error) => {
        console.error("Solver worker error:", error);
        // Reject all pending requests
        for (const [, { reject }] of this.pending) {
          reject(new Error("Worker error: " + error.message));
        }
        this.pending.clear();
        this.worker = null;
        this.initialized = false;
      };
    }
    return this.worker;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const worker = this.getWorker();
      // Send a dummy expand request to warm up the worker
      const requestId = ++this.requestId;
      this.pending.set(requestId, { resolve: () => {}, reject });
      worker.postMessage({ type: "EXPAND", payload: { requirements: [] }, requestId });

      // Give it a moment to initialize
      setTimeout(() => {
        this.initialized = true;
        resolve();
      }, 50);
    });

    return this.initPromise;
  }

  async solve(input: Assignment[], config: SchedulingConfig, options?: SolverOptions): Promise<SolverResult> {
    await this.ensureInitialized();
    const requestId = ++this.requestId;
    return new Promise<SolverResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      this.getWorker().postMessage({ type: "SOLVE", payload: { input, config, options }, requestId });
    });
  }

  async optimize(assignments: Assignment[], config: SchedulingConfig, options?: OptimizeScheduleOptions): Promise<SolverResult> {
    await this.ensureInitialized();
    const requestId = ++this.requestId;
    return new Promise<SolverResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      this.getWorker().postMessage({ type: "OPTIMIZE", payload: { assignments, config, options }, requestId });
    });
  }

  async expand(requirements: SchedulingConfig["requirements"] = []): Promise<Assignment[]> {
    await this.ensureInitialized();
    const requestId = ++this.requestId;
    return new Promise<Assignment[]>((resolve, reject) => {
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      this.getWorker().postMessage({ type: "EXPAND", payload: { requirements }, requestId });
    });
  }

  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.initialized = false;
      this.initPromise = null;
      for (const [, { reject }] of this.pending) {
        reject(new Error("Worker terminated"));
      }
      this.pending.clear();
    }
  }
}

// Singleton instance
export const solverWorker = new SolverWorkerClient();

// Re-export the types and functions for compatibility
export { solveSchedule, optimizeSchedule, expandRequirements } from "./solver";
export type { SolverOptions, OptimizeScheduleOptions } from "./solver";