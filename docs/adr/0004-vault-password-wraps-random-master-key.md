# One vault password wraps a random master key; no recovery in v1

Everything on the Store is encrypted client-side with a randomly generated master key. A single Vault password, run through Argon2id, wraps that key, so changing the password re-wraps one small blob instead of re-encrypting the Vault. We chose one shared key over per-device keys for simplicity, and accepted the consequences openly: a weak password weakens the whole Vault (the ciphertext sits on a third party and can be attacked offline), forgetting it loses the data, and there is no recovery phrase in v1. QR or manual entry is only used to move the Store connection settings to a new Device, not the key.

## Consequences

- The Server peer needs the key to read data: by default it is unlocked at startup and kept in memory only; an opt-in key file allows unattended restarts.
- Revoking a lost Device is not possible without rotating the master key, which is deferred.
- A Device may be set to stay unlocked: the master key is then kept in the app's own storage so the password is not asked at every launch. This trades protection against someone with the unlocked device for convenience; the web build never does it. The server peer can also unlock from `ERGONOTES_PASSWORD` for unattended restarts.
