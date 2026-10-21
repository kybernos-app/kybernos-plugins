---
name: stock-check
description: Reads a stock file or export and lists the items that are low, out of stock or overstocked, with a reorder proposal. Use when a shop owner or an operations manager wants a daily or weekly stock check, a reorder list or the items that will run out soon.
---

# Stock check

Speak the user's language, whatever language this file is written in.

## Input
The stock file or export (spreadsheet, CSV, a connected shop). Look for: item, quantity on hand, and if available the minimum level, the daily or weekly sales and the supplier lead time. Ask once for the threshold rule if there is none (a minimum level, or days of cover).

## Method
1. Out of stock: quantity 0.
2. Low: below the minimum level, or fewer days of cover than the supplier lead time plus a margin the user agrees to.
3. Overstock: more than 90 days of cover (say how you computed it).
4. Proposed reorder quantity for the low items: enough for the cover the user wants, rounded to the supplier's pack size when given.

## Output
Three short tables (out, low, overstock) and a reorder list grouped by supplier. State the assumptions at the end (threshold, sales period used). Offer a spreadsheet (use the xlsx skill) if asked.

## Do not
- Place an order or contact a supplier.
- Guess sales or lead times that are not in the data: mark the line "to confirm".
