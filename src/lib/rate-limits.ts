// Floor for the per-hole pacing rate. src/lib/wait-time.ts's queue-pacing
// formula assumes every party ahead in line contributes a positive number
// of minutes — a zero or negative rate would make the queue stop advancing
// (or run backwards) for everyone behind the front. 1 min/hole is the
// lowest pace that still means something as a golf pace. Shared by
// add-time/subtract-time's clamp and PUT /api/settings's validation so the
// two can never drift apart.
export const MIN_RATE = 1
