/**
 * Deterministic pseudo-random helpers for the seeder.
 *
 * WHY not Math.random()? Because the seeder must be REPEATABLE: running
 * `npm run db:seed` twice should produce the exact same database, so the
 * lesson outputs in this repo always match what the student sees locally.
 * A seeded generator gives "random-looking" but reproducible data.
 */

/** mulberry32 — tiny, fast, seeded PRNG. Returns a function like Math.random. */
export function createRandom(seed = 42) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer between min and max (both inclusive). */
export function randomInt(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

/** Pick one element from an array. */
export function pick(random, array) {
  return array[Math.floor(random() * array.length)];
}

/** Pick `count` DISTINCT elements from an array. */
export function pickMany(random, array, count) {
  const copy = [...array];
  const result = [];
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i += 1) {
    const index = Math.floor(random() * copy.length);
    result.push(copy.splice(index, 1)[0]);
  }
  return result;
}

/** True with the given probability (0..1). */
export function chance(random, probability) {
  return random() < probability;
}

/** A Date between `daysAgoMax` and `daysAgoMin` days before `now`. */
export function dateWithinDays(random, daysAgoMax, daysAgoMin = 0, now = Date.now()) {
  const spanMs = (daysAgoMax - daysAgoMin) * 24 * 60 * 60 * 1000;
  const offsetMs = daysAgoMin * 24 * 60 * 60 * 1000 + random() * spanMs;
  return new Date(now - offsetMs);
}
