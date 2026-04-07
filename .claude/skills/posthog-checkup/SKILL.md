---
name: posthog-checkup
description: Weekly PostHog analytics checkup for LoomWays/MineLoops game. Fetches last 7 days of activity and reports on DAUs, domain split, geography, and progress funnel with actionable recommendations.
user-invocable: true
---

Perform a brief PostHog analytics checkup for the LoomWays game. Follow these steps exactly.

## Context

The game runs on two domains:
- **www.mineloops.com** — public, open to all
- **www.loomways.com** — password protected

The progress funnel tracks player advancement:
`run-started → First construction → Score 100 → Score 500`

Full milestone ladder (from PRD):
`first-building-house → first-building-factory → first-building-storage → first-road-highway → score-100 → score-500`

Even with low traffic, funnel dropoff always warrants analysis.

## Steps

### 1. Fetch the "Main dash" dashboard

Use `mcp__posthog__dashboard-get` with id `596222`. Extract results from all 5 tiles:
- **Progress funnel** (insight 3705649) — step counts
- **Daily active users** (insight 3689091) — daily data array + labels
- **Users by country** (insight 3754676) — aggregated_value per country
- **Unique users per domain** (insight 3754674) — count per domain breakdown
- **Score: fresh vs demo city** (insight 3705702) — aggregated scores

### 2. Parse and report

Output a concise report in this structure:

---

**PostHog Checkup — Last 7 Days** _(refreshed: <date>)_

**Traffic**
- Total unique users: X (mineloops: X | loomways: X)
- DAU range: X–X/day, peak: X on <date>
- Top countries: list top 5 with counts

**Progress Funnel**

| Step | Users | Conv. from prev | Conv. from start |
|------|-------|-----------------|-----------------|
| run-started | X | — | 100% |
| First construction | X | XX% | XX% |
| Score 100 | X | XX% | XX% |
| Score 500 | X | XX% | XX% |

**Score: Fresh vs Demo City**
- Fresh city avg: X | Demo city avg: X

**Recommendations**

Give 2–4 concrete, specific recommendations based on the data. Be direct. Focus on:
- The biggest funnel dropoff step (where % loss is highest)
- If run-started count is low (< 20), note that traffic needs to grow before funnel data is statistically meaningful, but still analyze the pattern
- If construction dropoff is high: suggest improving first-session clarity (road placement hints, tutorial)
- If Score 100 dropoff is high: the early game scoring loop may be unclear — suggest clearer score feedback
- If Score 500 dropoff is high: mid-game retention issue — suggest adding more variety or challenge before that milestone
- Geographic concentration: if US >60%, consider whether the game is discoverable in other regions
- Domain split: if loomways >> mineloops, the public domain needs marketing

Keep recommendations tied to the actual numbers — no generic advice.

---

### 3. Format rules
- Use the exact table format above for the funnel
- Round all percentages to 1 decimal place
- If a data value is 0 or null, show "0" not "N/A"
- Keep the whole report under 40 lines
- Do not mention which MCP tools you used
