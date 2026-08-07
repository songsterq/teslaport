# Security Policy

## Scope

TeslaPort is an end-to-end encrypted link relay. The server is meant to move
opaque ciphertext only; the pairing seed and content key never leave the
devices.

## Reporting a vulnerability

Please report security issues privately — for example by emailing the
maintainer listed on [GitHub](https://github.com/songsterq) or by opening a
[private security advisory](https://github.com/songsterq/teslaport/security/advisories/new)
on this repository.

Include:

- A clear description of the issue and impact
- Steps to reproduce, or a minimal proof of concept
- Whether the issue is in client crypto, the wire protocol, the Worker/Durable
  Object, or deployment defaults

## What is in scope

- Client-side crypto mistakes (HKDF inputs, AES-GCM misuse, key handling)
- Pairing seed leakage (e.g. fragment accidentally sent to the server)
- Room isolation failures or cross-room delivery
- Abuse paths that defeat rate limits or availability of a room in ways
  worse than the documented threat model
- XSS or injection that leaks keys or history from a paired device

## What is out of scope

- The server learning `roomId`, connection counts, or ciphertext length/timing
  (see the design doc — this is intentional residual metadata)
- Social engineering of someone who scans a stranger’s QR code
- Issues only on abandoned forks or unofficial deployments
- Denial of service against Cloudflare’s edge in general

## Response

Maintainer acknowledges actionable reports when possible and patches critical
issues before or alongside public disclosure. Credit is given if you want it.
