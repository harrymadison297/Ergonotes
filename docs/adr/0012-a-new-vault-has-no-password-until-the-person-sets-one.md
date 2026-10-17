# A new vault has no password until the person sets one

Amends ADR 0004 (one password wraps a random master key). The master key, the encrypted Store and the sealed `.ergonotes/` stay; only the password becomes optional.

A first launch used to stop at a screen asking for a password of 12 characters or more, then ran Argon2id (64 MB) on the main thread before anything showed. For a notes app whose notes are plain Markdown on the person's own disk (ADR 0010) that gate protects little on a single computer and costs the first minute.

## Decision

- A Vault created on **desktop and Android** has no password: `vault.json` says `kdf: none` and holds the master key unwrapped, so opening it runs no key derivation. The app goes straight to the UI. **Web and the Server peer** still ask for a password at setup, because they are reached over a network.
- A password can be **set** or **removed** later in Settings. Both only re-wrap the one master key; nothing is re-encrypted.
- A no-password Vault **may** connect to a Store, and the password may be removed while a Store is connected. The person was told that the data on the Store is then protected only by a blank password and chose to allow it.
- Because that is a weaker state than ADR 0004 promised, the app says so: a one-time warning with a "Set password" button on the first Store connection, the first AI API key saved and "Remove password", and "Vault has no password" in Settings.
- With a password, Argon2id runs in a Web Worker so the interface does not freeze.

## Consequences

- A device that opens a Vault whose `vault.json` says `kdf: none` never prompts. When another Device sets a password, the existing rule of ADR 0004 applies: a Device that fails to open re-reads `vault.json` from the Store.
- AI settings and their API keys inside `.ergonotes/` are readable by anyone who can read the folder, on such a Vault.
- The first-run screen, the Gate's creation form and the "at least 12 characters" rule apply only to Web and the Server peer, and to a person setting a password later.
