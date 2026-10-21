---
name: patient-reminders
description: Drafts short appointment reminder messages (SMS, messaging app or e-mail) from a list of appointments, in the practice's tone and without medical details. Use when the user wants reminders for tomorrow's or next week's appointments, a confirmation request or a message to a patient who missed a visit.
---

# Patient reminders

Speak the user's language, whatever language this file is written in. Draft only: never send anything yourself.

## Input
A list of appointments (name, date, time, type, practitioner), pasted, in a file, or read from a calendar the user has connected. If it is missing, say what you need and stop.

## Write
- One message per patient, 300 characters at most for SMS and messaging apps, a few lines for e-mail.
- Include: who, when, where (if known), how to cancel or move it, and the practice's name. Nothing medical: no reason for the visit, no result, no treatment.
- Tone: warm, brief, polite. Use the form of address the practice uses; ask once if unknown.
- Three kinds: reminder the day before, confirmation request, gentle follow-up after a missed appointment (no blame).
- End with an opt-out line when the user says patients must be able to refuse reminders.

## Output
A table with one row per patient (name, channel, message), ready to copy. List at the top any appointment you could not draft (missing contact, missing time).

## Do not
- Put a diagnosis, a drug name or a reason for visit in a message.
- Guess a phone number, an address or a time.
