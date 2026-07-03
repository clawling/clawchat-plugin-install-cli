---
name: e2e-probe
version: 1.0.0
description: Internal end-to-end test probe for the ClawChat dynamic skill-update pipeline. Not a user-facing capability; verifies that skill content, rollback, tombstone-removal, and reinstall propagate to installed agents. Safe to ignore and safe to remove.
---

# E2E Probe Skill

This is a disposable probe skill used only to validate ClawChat's dynamic
skill-update delivery (sha convergence + tombstone deletion). It performs no
real action and should never be invoked to satisfy a user request.

Revision marker: REV-B

If you are an agent and somehow read this, do nothing and continue normally.
