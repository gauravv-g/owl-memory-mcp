# OWL Secure Protocol (OSP) v1.0

> A metadata-resistant, end-to-end encrypted messaging protocol.
> No phone numbers. No server trust. No metadata leakage. No backdoors.
> Ever.

---

## 1. Threat Model

### Adversary capabilities:
- **Full network control**: Can observe all network traffic, perform traffic analysis, timing attacks, and correlation attacks
- **Server compromise**: Any relay/server node may be fully compromised by the adversary
- **Endpoint compromise**: One party's device may be compromised (we provide post-compromise security via ratcheting)
- **Quantum adversary**: Adversary may have quantum computers in the future (harvest-now-decrypt-later attacks)
- **Passive + active**: Adversary can both observe and inject/modify/drop messages

### What we protect against:
1. **Message confidentiality**: No party except sender and intended recipient(s) can read message content
2. **Message integrity**: Any tampering is detected
3. **Forward secrecy**: Compromising long-term keys does not reveal past messages
4. **Post-compromise security**: Security recovers after a key compromise (via ratcheting)
5. **Identity misbinding**: No man-in-the-middle without detection
6. **Metadata resistance**: Server/relay cannot determine who talks to whom, when, or how often
7. **Deniability**: Messages cannot be cryptographically attributed to a sender after the fact

### What we do NOT claim to protect:
- Traffic timing/correlation attacks at the network level (mitigated but not eliminated by mixnet-like design)
- Compromised endpoints (no cryptography fixes a hacked phone)
- Physical access to unlocked devices

---

## 2. Design Principles

1. **NO phone numbers** — Identity = public key only
2. **NO central servers** — Federated relay network, any node
3. **NO metadata on servers** — Sealed sender, onion-routed, padded
4. **Post-quantum by default** — Hybrid classical + PQ from day one
5. **Minimal trust** — Zero trust in relays, zero trust in identity servers
6. **Provable security** — Every primitive is formally analyzed, no home-brewed crypto
7. **Deniability** — No signatures that can be shown to third parties

---

## 3. Cryptographic Primitives

### 3.1 Key Agreement (Hybrid PQ)
- **Classical**: X25519 (Curve25519 ECDH)
- **Post-Quantum**: ML-KEM-768 (CRYSTALS-Kyber, NIST FIPS 203)
- **Combination**: Concatenate shared secrets from both, derive via HKDF-SHA3-256

### 3.2 Digital Signatures (for identity only, NOT for messages)
- **Ed25519** for long-term identity key signing
- **ML-DSA-65** (CRYSTALS-Dilithium, NIST FIPS 204) for PQ identity
- Messages use MAC-based authentication (deniable), NOT signatures

### 3.3 Symmetric Encryption
- **AEAD**: AES-256-GCM-SIV (nonce-misuse resistant) OR ChaCha20-Poly1305
- **Key derivation**: HKDF-SHA3-256
- **Hash**: SHA3-256 throughout (not SHA-2 — future-proofing)

### 3.4 Ratchet
- **Double Ratchet** (same construction as Signal) with SHA3-256
- **Post-Quantum Ratchet**: ML-KEM-768 key encapsulation on every ratchet step
- Combined: "Triple Ratchet" — DH ratchet + symmetric ratchet + PQ ratchet

### 3.5 Randomness
- OS CSPRNG (CryptGenRandom on Windows, /dev/urandom on Linux)
- All keys generated fresh, never reused

---

## 4. Identity System

### 4.1 Identity Key Pair (long-term)
```
IdentityKey = (Ed25519_keypair, ML-DSA-65_keypair)
```
- Generated once per user, stored securely on device
- Public key IS the user's address (no phone number, no username registry)
- Address = Base58( SHA3-256(Ed25519_pubkey || ML-DSA_pubkey) )

### 4.2 Pre-keys (medium-term, rotated weekly)
```
SignedPreKey = Ed25519_sign( X25519_pubkey || ML-KEM_pubkey )
OneTimePreKeys = [ (X25519_keypair, ML-KEM_keypair) ] × 100
```
- Uploaded to relay network (see Section 6)
- Consumed on first use, then deleted
- Signed by identity key for authenticity

### 4.3 No Central Registry
- No server maps identities to addresses
- Users exchange addresses via QR code, NFC, or manual comparison
- Optional: DHT-based discovery (see Section 6)

---

## 5. Session Establishment (X3DH + PQXDH Hybrid)

### 5.1 Initial Handshake (Alice → Bob)

Alice retrieves Bob's pre-key bundle from relay:
```
Bundle = { IdentityKey_B, SignedPreKey_B, OneTimePreKey_B }
```

Alice generates ephemeral keys:
```
EphemeralKey_A = (X25519_keypair, ML-KEM_keypair)
```

Alice computes 5 DH/PQ shared secrets:
```
DH1 = X25519(IdentityKey_A, SignedPreKey_B)
DH2 = X25519(EphemeralKey_A, IdentityKey_B)
DH3 = X25519(EphemeralKey_A, SignedPreKey_B)
DH4 = X25519(EphemeralKey_A, OneTimePreKey_B)
PQ1 = ML-KEM-768.Encaps(SignedPreKey_B.PQ_pubkey)
```

Master secret:
```
SK = HKDF-SHA3-256(DH1 || DH2 || DH3 || DH4 || PQ1, salt="OSP-v1-session")
```

### 5.2 Authentication
- Users verify identity keys via out-of-band channel (QR code scan, safety number comparison)
- No certificate authority, no phone number verification
- Trust-on-first-use with key change notifications

---

## 6. Transport Layer (Metadata Resistance)

### 6.1 Relay Network Architecture
- **No central server** — anyone can run a relay node
- **Onion routing** — messages pass through 3 relay hops (like Tor, but lighter)
- **Store-and-forward** — relays hold encrypted messages for offline recipients
- **No logs** — relays are designed to not know sender, recipient, or content

### 6.2 Message Format (on wire)
```
OSP_WireMessage {
    version:        u8      = 0x01
    header:         OnionHeader   // 3-layer encrypted routing header
    payload:        EncryptedPayload  // AEAD encrypted, relay can't read
    padding:        [u8]      // Random padding, total size = fixed 4KB
}
```

### 6.3 Onion Routing
- Each message is wrapped in 3 layers of encryption (one per relay hop)
- Each relay peels one layer, learns only the next hop
- No relay knows both sender and recipient
- Fixed 4KB message size prevents size-based traffic analysis

### 6.4 Padding & Traffic Shaping
- ALL messages padded to exactly 4096 bytes
- Dummy messages sent at random intervals (cover traffic)
- Constant-rate option: send dummy messages at fixed intervals to mask real activity

### 6.5 Recipient Addressing
- Recipient address is encrypted inside the onion layers
- Relays route based on onion header, NOT on visible recipient address
- Store-and-forward: relay holds message until recipient polls (via onion route)

---

## 7. Message Encryption (Double + PQ Ratchet)

### 7.1 Sending a message
```
1. Advance symmetric ratchet: CK_new = HKDF-SHA3-256(CK_old, "chain")
2. Derive message key: MK = HKDF-SHA3-256(CK_new, "message")
3. If PQ ratchet step (every 10 messages):
   a. Generate new ML-KEM keypair
   b. Encapsulate to recipient's last PQ public key
   c. Mix PQ shared secret into root key
4. Encrypt: ciphertext = AES-256-GCM-SIV(MK, plaintext, associated_data)
5. Include DH ratchet public key if it's a DH ratchet step
6. Pad to 4096 bytes
7. Wrap in onion routing layers
8. Send to entry relay
```

### 7.2 Receiving a message
```
1. Decrypt onion layers (if last hop)
2. Remove padding
3. Decrypt AEAD ciphertext
4. Advance ratchet state
5. If new DH public key included: perform DH ratchet step
6. If new PQ public key included: perform PQ ratchet step
```

### 7.3 Ratchet stepping
- **DH ratchet**: Every message (X25519 key exchange)
- **PQ ratchet**: Every 10 messages (ML-KEM encapsulation)
- **Symmetric ratchet**: Every message (KDF chain)

---

## 8. Group Messaging

### 8.1 Design
- Groups use pairwise Double Ratchet between all members
- Group key for efficient broadcast (Sender Keys model, like Signal)
- Group membership changes trigger full key rotation

### 8.2 Group Operations
- **Create**: Creator generates group key, sends to all members via pairwise channels
- **Add member**: All existing members send group key to new member
- **Remove member**: Full group key rotation, new key sent to remaining members
- **Leave**: Same as remove (self-initiated)

### 8.3 Metadata Protection for Groups
- Group messages routed through onion network (same as 1:1)
- Relay cannot determine group membership
- Group size hidden by padding

---

## 9. Security Properties Summary

| Property | Mechanism | Status |
|----------|-----------|--------|
| Confidentiality | AES-256-GCM-SIV + ML-KEM | ✅ |
| Integrity | AEAD + ratchet MAC | ✅ |
| Forward Secrecy | Double Ratchet + per-message keys | ✅ |
| Post-Compromise Security | Triple Ratchet (DH + symmetric + PQ) | ✅ |
| Deniability | MAC-based auth (no signatures on messages) | ✅ |
| Metadata Resistance | Onion routing + padding + cover traffic | ✅ |
| Post-Quantum Security | ML-KEM-768 + ML-DSA-65 | ✅ |
| No Phone Numbers | Public key = identity | ✅ |
| No Central Server | Federated relay network | ✅ |
| Group E2EE | Sender Keys + pairwise ratchet | ✅ |

---

## 10. Comparison with Existing Protocols

| Feature | OSP | Signal | WhatsApp | Telegram |
|---------|-----|--------|----------|----------|
| E2EE default | ✅ | ✅ | ✅ | ❌ |
| E2EE groups | ✅ | ✅ | ✅(weak) | ❌ |
| Metadata resistant | ✅ | ❌ | ❌ | ❌ |
| Post-quantum | ✅ | ✅(2023+) | ❌ | ❌ |
| No phone number | ✅ | ❌ | ❌ | ❌ |
| No central server | ✅ | ❌ | ❌ | ❌ |
| Open source server | ✅ | ✅ | ❌ | ❌ |
| Deniable messages | ✅ | ✅ | ✅ | ❌ |
| Onion routing | ✅ | ❌ | ❌ | ❌ |
| Cover traffic | ✅ | ❌ | ❌ | ❌ |

---

## 11. Implementation Roadmap

### Phase 1: Core Protocol (Week 1-2)
- [x] Protocol specification
- [ ] Reference implementation (Python)
- [ ] Unit tests for all crypto operations
- [ ] Test vectors

### Phase 2: Transport Layer (Week 3-4)
- [ ] Relay node implementation
- [ ] Onion routing
- [ ] Store-and-forward
- [ ] Padding and cover traffic

### Phase 3: Client Library (Week 5-6)
- [ ] Python client SDK
- [ ] Session management
- [ ] Message send/receive
- [ ] Group messaging

### Phase 4: Security Audit (Week 7-8)
- [ ] Formal verification of protocol
- [ ] Third-party cryptanalysis
- [ ] Penetration testing
- [ ] Bug bounty

---

## 12. References

1. Marlinspike, M. & Perrin, T. — The Signal Protocol (2013-2025)
2. NIST FIPS 203 — ML-KEM (CRYSTALS-Kyber)
3. NIST FIPS 204 — ML-DSA (CRYSTALS-Dilithium)
4. Jakobsen, J. & Orlandi, C. — "On the CCA (in)security of MTProto" (2015)
5. Rösler, P., Mainka, C., Schwenk, J. — "More is Less" (2017)
6. Cohn-Gordon, K. et al. — "A Formal Security Analysis of the Signal Protocol" (2017)
7. Signal Foundation — PQXDH Specification (2023)
8. Signal Foundation — Triple Ratchet (2025)
