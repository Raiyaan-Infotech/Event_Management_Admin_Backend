/**
 * A tiny in-process TTL cache for reads that are hit on EVERY request and
 * change only when an admin edits something.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Production is roughly 200–374ms per database round trip (Render → Aiven), and
 * the mobile app is a guest-facing event app where one screen open can chain a
 * dozen of them. Plan gating is the worst offender: which menus a subscription
 * plan grants is read on every event open, every event-options call and every
 * list, is the same answer for every guest of that host, and changes only when
 * someone saves the plan in the admin panel. Caching it for a minute removes
 * two round trips from the hot path; re-reading it every time buys nothing.
 *
 * ── DELIBERATELY IN-PROCESS ──────────────────────────────────────────────────
 * No Redis, no new dependency, no deployment change. The consequence, stated
 * rather than discovered: with more than one server process each keeps its own
 * copy, so an invalidation only reaches the process that served the write. That
 * is why every cached value here must also be SAFE WHEN STALE for its TTL —
 * entitlements are, money and sessions are NOT. Never cache authentication,
 * authorisation of a specific person, balances or anything a user can see
 * change and expect to have changed.
 */

/** Keeps the map from growing without bound if keys are unexpectedly varied. */
const MAX_ENTRIES = 500;

class TtlCache {
    /** @param {number} ttlMs How long an entry stays fresh. */
    constructor(ttlMs) {
        this.ttlMs = ttlMs;
        /** @type {Map<string, { value: unknown, expires: number }>} */
        this.store = new Map();
    }

    /**
     * The cached value, or `undefined` when absent or stale. `undefined` is
     * therefore not cacheable — use [wrap] rather than get/set by hand.
     */
    get(key) {
        const hit = this.store.get(key);
        if (!hit) return undefined;
        if (hit.expires <= Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return hit.value;
    }

    set(key, value) {
        if (this.store.size >= MAX_ENTRIES) {
            // Oldest insertion first — Map preserves insertion order. Crude, and
            // correct: everything in here is re-derivable from the database.
            const oldest = this.store.keys().next().value;
            if (oldest !== undefined) this.store.delete(oldest);
        }
        this.store.set(key, { value, expires: Date.now() + this.ttlMs });
        return value;
    }

    /**
     * Cache-aside around an async producer.
     *
     * A REJECTION IS NOT CACHED: a failed query must not be remembered as the
     * answer for the next minute.
     */
    async wrap(key, produce) {
        const hit = this.get(key);
        if (hit !== undefined) return hit;
        const value = await produce();
        if (value !== undefined) this.set(key, value);
        return value;
    }

    /** One key, or everything when called with no argument. */
    invalidate(key) {
        if (key === undefined) this.store.clear();
        else this.store.delete(key);
    }

    /** Every key that starts with [prefix] — for "this plan, all platforms". */
    invalidatePrefix(prefix) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix)) this.store.delete(key);
        }
    }
}

module.exports = { TtlCache };
