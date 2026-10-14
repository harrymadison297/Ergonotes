# Sync through a passive Store; the Linux server is an optional peer

Devices are rarely online at the same time, so they exchange encrypted Commits through a passive Store the person already owns (S3-compatible first, WebDAV second; Drive/Dropbox later because OAuth without a server is the worst part). No component of the system must run 24/7. The Linux server is just another Device with the same core: it serves the web UI and the agent endpoint, but Android and Windows never depend on it. We rejected a hub server (breaks the "no always-on server" goal) and pure P2P (needs both devices online).

## How Devices find new Commits

Each push also writes a small marker `inbox/<time>-<device>-<commit>` next to the Commit objects. A Device remembers the newest marker time it has seen and lists only keys after it, minus a 30-minute safety margin. A full listing remains as a manual / daily reconcile (the Sync button).

`<time>` is the Store's time, not the Device's. A Device learns its own offset from the Store (LastModified of an object it just wrote, or the Date header) and applies it, so a wrong phone clock cannot hide a Commit.

Considered and rejected: list-and-diff on every poll. With 20 000 Commits it is about 21 LIST requests per poll against 1-2 for the cursor. Keys stamped with the Device clock silently missed Commits once clock skew exceeded the margin (+-3 h skew, 30 min margin).

## Consequences

- The web UI has no offline mode; it only exists when the Server peer is reachable.
- Every pushed Commit costs two PUTs (object + marker); bundling several Commits per PUT is the mitigation if request count matters.
- `overlays/` and `gc/` (ADR 0006) must be announced through the same inbox, otherwise they need a full listing on every poll. The spike still listed them in full, so this is unproven.
