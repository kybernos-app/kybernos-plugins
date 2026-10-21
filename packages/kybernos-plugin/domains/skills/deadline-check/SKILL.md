---
name: deadline-check
description: Lists the legal, procedural and contractual deadlines coming up in the next days from the files and calendar the user points to, with the date computation shown. Use when a lawyer, a paralegal or a legal team wants to know what is due this week, or to compute a limitation, appeal or filing date.
---

# Deadline check

Speak the user's language, whatever language this file is written in. You help to spot and compute dates; the lawyer decides and verifies them.

## Input
The folder, the matters list or the calendar to read (ask once if not given), the window to look at (default 7 days), and the date of today.

## For each deadline
- Matter, what is due, the due date, the days left, and where you found it (file and line, or calendar entry).
- If you computed it: the starting event and date, the rule you applied (statute, procedural rule or contract clause as written in the files), the delay, and how you counted (calendar days or working days, holidays, weekends). Show the computation in one line.
- A confidence mark: confirmed (the date is written in a document), computed (you applied a rule), or to verify (a rule or a starting date is unclear).

## Rules
- Never invent a deadline or a rule. When the rule is not in the files, say "rule to confirm" and do not compute.
- Sort by date, past-due first. Put "to verify" items in their own section at the end.
- End with the three items most urgent, in one line each.
