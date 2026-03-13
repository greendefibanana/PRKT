import { ExecutionIdempotencyGuard } from "../../src/core/idempotency/ExecutionIdempotencyGuard";

describe("ExecutionIdempotencyGuard", () => {
    it("generates unique execution IDs", () => {
        const guard = new ExecutionIdempotencyGuard();
        const id1 = guard.generateId();
        const id2 = guard.generateId();

        expect(id1).not.toBe(id2);
        expect(id1).toMatch(
            /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u
        );
    });

    it("allows first acquire and blocks duplicate", () => {
        const guard = new ExecutionIdempotencyGuard();
        const id = guard.generateId();

        expect(guard.acquire(id)).toBe(true);
        expect(guard.acquire(id)).toBe(false);
    });

    it("allows re-acquire after TTL expiry", () => {
        const guard = new ExecutionIdempotencyGuard({ ttlMs: 0 });
        const id = guard.generateId();

        expect(guard.acquire(id)).toBe(true);
        // TTL of 0ms means entry expires immediately on next check
        expect(guard.acquire(id)).toBe(true);
    });

    it("tracks entries with has() without acquiring", () => {
        const guard = new ExecutionIdempotencyGuard();
        const id = guard.generateId();

        expect(guard.has(id)).toBe(false);
        guard.acquire(id);
        expect(guard.has(id)).toBe(true);
    });

    it("evicts oldest entry when max capacity is reached", () => {
        const guard = new ExecutionIdempotencyGuard({ maxEntries: 2 });
        const id1 = guard.generateId();
        const id2 = guard.generateId();
        const id3 = guard.generateId();

        guard.acquire(id1);
        guard.acquire(id2);
        expect(guard.size).toBe(2);

        guard.acquire(id3);
        expect(guard.size).toBe(2);
        // oldest (id1) should have been evicted
        expect(guard.has(id1)).toBe(false);
        expect(guard.has(id2)).toBe(true);
        expect(guard.has(id3)).toBe(true);
    });

    it("clear() removes all entries", () => {
        const guard = new ExecutionIdempotencyGuard();
        guard.acquire(guard.generateId());
        guard.acquire(guard.generateId());

        expect(guard.size).toBe(2);
        guard.clear();
        expect(guard.size).toBe(0);
    });

    it("blocks duplicate even with different guard state sizes", () => {
        const guard = new ExecutionIdempotencyGuard({ maxEntries: 100 });
        const ids = Array.from({ length: 50 }, () => guard.generateId());

        for (const id of ids) {
            expect(guard.acquire(id)).toBe(true);
        }

        // All should be blocked on second acquire
        for (const id of ids) {
            expect(guard.acquire(id)).toBe(false);
        }
    });
});
