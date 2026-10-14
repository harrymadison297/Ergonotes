---
title: "M2: Android app (mobile shell, share-to-Inbox, lazy attachments)"
labels: [milestone:m2, type:feature, risk:medium]
blocked_by: [04]
---

- Tauri 2 Android build with the mobile navigation shell (bottom nav, single pane, touch). Fallback: Capacitor for the Android shell only.
- Share intent creates a Capture in the configured capture folder.
- Attachments download lazily with an LRU cache that can be evicted.
- Sync on open, on foreground and periodically while running. No background sync in v1.
- Measure Argon2id time on a mid-range phone and set the default parameters from that.
- Local notifications for task reminders.
