# One vault password wraps a random master key; no recovery in v1

Everything on the Store is encrypted client-side with a randomly generated master key. A single Vault password, run through Argon2id, wraps that key, so changing the password re-wraps one small blob instead of re-encrypting the Vault. We chose one shared key over per-device keys for simplicity, and accepted the consequences openly: a weak password weakens the whole Vault (the ciphertext sits on a third party and can be attacked offline), forgetting it loses the data, and there is no recovery phrase in v1. QR or manual entry is only used to move the Store connection settings to a new Device, not the key.

## Consequences

- The Server peer needs the key to read data: it is unlocked at the first sign-in and kept in memory only; `ERGONOTES_PASSWORD` is an opt-in way to unlock at start-up for unattended restarts.
- A password changed on one Device is written to `vault.json` on the Store first; another Device that fails to unlock with the new password re-reads that file before giving up. The master key itself never changes, so already unlocked Devices keep working.
- Revoking a lost Device is not possible without rotating the master key, which is deferred.
- A Device may be set to stay unlocked: the master key is then kept in the app's own storage so the password is not asked at every launch. This trades protection against someone with the unlocked device for convenience; the web build never does it. The server peer can also unlock from `ERGONOTES_PASSWORD` for unattended restarts.
