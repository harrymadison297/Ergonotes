---
title: "M5: Server peer and web UI"
labels: [milestone:m5, type:feature]
blocked_by: [06]
---

- Headless Node/Bun peer running the same TypeScript core; serves the web build and an agent-facing HTTP endpoint (MCP later).
- Unlock at start-up by default (key in RAM only); optional key file for unattended restart.
- Web login with the vault password, rate limiting, HTTPS required except on localhost.
- Web picks the desktop or mobile shell by screen size and input type.
- Acts as a normal sync peer: appears under `devices/`, takes part in compaction gating.
