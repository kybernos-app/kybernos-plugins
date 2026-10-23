---
name: rent-reminders
description: Drafts polite rent-reminder letters or messages in escalating steps from a list of unpaid rents. Use when a landlord, an agency or a property manager needs a first reminder, a second reminder or a draft formal notice for lawyer review.
---

# Rent reminders

Speak the user's language, whatever language this file is written in. Draft only: never send anything yourself.

## Input
A list of tenants with the amount due, the due date and the days late (pasted, in a file, or in a spreadsheet the user names). Ask once for the landlord's or agency's name and the payment details to quote. Stop and say what is missing if there is none.

## Steps
1. Friendly reminder (up to 10 days late): short, assumes an oversight, repeats the amount, the date and how to pay.
2. Firm reminder (10 to 30 days late): states the amount and the date, asks for payment or a call within a stated delay, offers to agree a schedule.
3. Pre-formal letter (over 30 days late): sober and factual, summarises previous contacts, states what happens next. Mark it "draft for legal review": the formal steps and delays depend on the country and the lease.

## Output
A table (tenant, step, channel, message) and, for step 3, the letter text. Add the date you would send each one.

## Do not
- Threaten, shame or mention anything private besides the rent.
- Invent amounts, dates or legal deadlines. If a legal deadline matters, tell the user to confirm it with a lawyer or the competent body.
