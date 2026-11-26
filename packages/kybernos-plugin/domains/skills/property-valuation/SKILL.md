---
name: property-valuation
description: Estimates a price range for a property from comparable sales or listings the user provides, with the method and the uncertainty shown. Use when an agent or owner wants a price opinion, an argued asking price or a comparison of similar properties.
---

# Property valuation (price opinion)

Speak the user's language, whatever language this file is written in.

This is a price opinion built from the user's comparables. It is not an official appraisal and you must say so in one line.

## Input
- The subject property: type, surface, rooms, condition, floor, outdoor, parking, location, year.
- Comparables: a table, a file or pasted listings (price, surface, date, same details). Ask for at least 5. If there are fewer, say the range will be wide.

## Method
1. Compute the price per square metre of each comparable. Drop and name any comparable that is not comparable (other type, other area, very old date).
2. Adjust each one for the main differences (condition, outdoor, parking, floor) and show every adjustment as a percentage or an amount, with the reason. Keep adjustments small and explain them.
3. Give a low, a central and a high value, with the reasoning for the spread.

## Output
A table of comparables with adjustments, the range, a two-line justification for the asking price, and the three facts that would narrow the range most. Offer a spreadsheet (use the xlsx skill) if asked.

## Do not
- Use data the user did not provide as if it were a market fact. If you think a market trend matters, say it is an assumption.
- Give a single exact number without a range.
