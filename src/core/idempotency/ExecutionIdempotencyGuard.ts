import { randomUUID } from "crypto";

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

type TrackedEntry = {
  id: string;
  expiresAt: number;
};

/**
 * Prevents duplicate execution of the same intent by tracking unique execution IDs.
 * Uses a bounded in-memory set with TTL-based expiry.
 */
export class ExecutionIdempotencyGuard {
  private readonly entries = new Map<string, TrackedEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private cleanupCounter = 0;
  private readonly cleanupInterval = 50;

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Generate a new unique execution ID.
   */
  generateId(): string {
    return randomUUID();
  }

  /**
   * Attempt to acquire a lock for the given execution ID.
   * Returns `true` on the first call for a given ID (execution allowed).
   * Returns `false` if the ID has already been acquired (duplicate blocked).
   */
  acquire(executionId: string): boolean {
    this.maybeCleanup();

    const existing = this.entries.get(executionId);
    if (existing && existing.expiresAt > Date.now()) {
      return false;
    }

    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(executionId, {
      id: executionId,
      expiresAt: Date.now() + this.ttlMs
    });

    return true;
  }

  /**
   * Check whether an execution ID has already been acquired (without acquiring it).
   */
  has(executionId: string): boolean {
    const existing = this.entries.get(executionId);
    if (!existing) {
      return false;
    }

    if (existing.expiresAt <= Date.now()) {
      this.entries.delete(executionId);
      return false;
    }

    return true;
  }

  /**
   * Returns the number of active (non-expired) tracked entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Remove all tracked entries.
   */
  clear(): void {
    this.entries.clear();
  }

  private maybeCleanup(): void {
    this.cleanupCounter += 1;
    if (this.cleanupCounter < this.cleanupInterval) {
      return;
    }

    this.cleanupCounter = 0;
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
      }
    }
  }

  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestExpiry = Infinity;

    for (const [id, entry] of this.entries) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.entries.delete(oldestId);
    }
  }
}
