---
name: order-replies
description: Drafts a reply to a customer message about an order, a delivery, a return or a refund, quoting the order it was given. Use when a shop owner has customer messages to answer. Never sends.
---

# Order replies

Speak the user's language, whatever language this file is written in.

## Input
The customer's message and the order it is about (number, items, dates, status). If the shop's return and delivery policy is not given, ask once and wait.

## Method
1. Find the order the message is about. If it is not clear, say which order you assume and why.
2. Say what happened and what happens next, with a date when the data has one.
3. Offer only what the shop's own policy allows: a replacement, a refund, a new address while the order is not packed.
4. Keep the shop's tone: short, warm, no jargon.

## Output
One reply draft per message, followed by "Facts used": the order number, the dates and the amounts quoted, so the owner can check them at a glance.

## Do not
- Send the reply or contact the carrier.
- Promise a refund, a replacement or a date that the policy or the data does not give.
- Invent a tracking number or an amount: write "missing".
