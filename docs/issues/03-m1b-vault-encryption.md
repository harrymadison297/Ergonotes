---
title: "M1b: Vault creation, password, master key wrapping, object encryption"
labels: [milestone:m1, type:feature, security]
blocked_by: [01]
---

## Goal
Implement ADR 0004: random master key, wrapped by an Argon2id-derived key; AES-256-GCM per object.

## Requirements
- Argon2id parameters stored in `vault.json` so they can be raised later; default around 64 MiB, 3 passes (about 0.2 s on a desktop; **measure on a real Android device before fixing the default**).
- Wrong password must fail by tag verification, not by a plaintext check.
- Changing the password re-wraps only the key blob; no object is re-encrypted.
- Minimum length / strength check at creation; clear "forgotten password = data lost" warning. No recovery phrase in v1.
- Random 12-byte IV per object is acceptable for a personal vault; note the 2^32-objects-per-key bound in the code comment, and keep a key `epoch` field so rotation can be added.

## Acceptance
- Round trip, wrong password, tamper detection, password change tests.
- Nothing readable (names, titles, tags) appears in the Store listing.
