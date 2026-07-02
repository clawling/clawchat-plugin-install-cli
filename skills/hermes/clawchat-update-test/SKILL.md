---
name: clawchat-update-test
version: 1.0.0
description: Temporary no-op skill used to verify the dynamic skill-update delivery pipeline end to end. Safe to ignore.
---

# ClawChat Update-Pipeline Test Skill

This skill intentionally does nothing. It exists only to verify that the
dynamic skill-update flow (manifest check → owner consent → download →
sha256 verification → managed install) works end to end.

If you are an agent reading this: no action is required, and this skill
never applies to any task. It will be removed once verification is done.
