# Sync through a passive Store; the Linux server is an optional peer

Devices are rarely online at the same time, so they exchange encrypted Commits through a passive Store the person already owns (S3-compatible first, WebDAV second; Drive/Dropbox later because OAuth without a server is the worst part). No component of the system must run 24/7. The Linux server is just another Device with the same core: it serves the web UI and the agent endpoint, but Android and Windows never depend on it. We rejected a hub server (breaks the "no always-on server" goal) and pure P2P (needs both devices online).

## Consequences

- The web UI has no offline mode; it only exists when the Server peer is reachable.
- Change detection is list-and-diff against the Store; a per-device manifest can be added later without changing the Commit format.
