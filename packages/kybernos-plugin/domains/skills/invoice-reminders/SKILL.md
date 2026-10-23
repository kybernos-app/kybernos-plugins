---
name: invoice-reminders
description: Drafts payment reminders for overdue invoices in escalating tones from a list or a spreadsheet, with a summary of what is owed. Use when an accountant, a freelancer or a finance team wants to chase late invoices, prepare the reminder run of the week or write a polite final notice.
---

# Invoice reminders

Speak the user's language, whatever language this file is written in. Draft only: never send anything yourself.

## Input
A list of open invoices (customer, invoice number, issue date, due date, amount, currency, contact), pasted, in a file, or in a spreadsheet the user names. If a column is missing, say which one and stop. Ask once for the sender's name and bank details to quote.

## Steps
1. Courtesy reminder (1 to 7 days late): short, assumes an oversight, includes the invoice again.
2. Reminder (8 to 30 days late): states the amount and the days late, asks for a payment date.
3. Final notice (over 30 days late): factual, states the amount, the contract or legal basis only if the user gives it, and the next step. Mark it "draft for review".

## Output
1. A summary table: customer, invoice, amount, days late, step.
2. One message per invoice or one per customer (group invoices of the same customer), ready to copy.
3. The total owed, by currency.

## Do not
- Invent a late fee, an interest rate or a legal reference. Use only what the user gives.
- Chase an invoice that the list marks as paid, disputed or on a payment plan: list those separately.
