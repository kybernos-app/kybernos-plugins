---
name: web-brief
description: Researches a topic on the web and writes a one-page brief. Use when someone asks for a quick, sourced overview of a company, a market or a question.
---

# Web brief

Write a sourced one-page brief on the topic the person gives you.

## Before you start

This skill uses the Searchly service: the person needs a Searchly account and its API key in `SEARCHLY_API_KEY`. If the key is missing, say so in one sentence and stop. To turn the brief into a Word file at the end you also need the `pandoc` command-line tool; if it is not installed, give the brief as Markdown instead.

## Steps

1. Restate the topic in one sentence and list three questions the brief must answer.
2. Run `searchly search "<question>" --limit 8` for each question. Keep only results from the last two years unless the topic is historical.
3. Open the five most relevant pages and note the claim, the figure and the page address of each. Never keep a claim you cannot trace to a page.
4. Write the brief: a three-line summary, one short section per question, and a list of sources with their addresses. Mark any figure that two sources disagree on.
5. When asked for a document, convert it with `pandoc brief.md -o brief.docx`.

## Rules

- Quote figures exactly and give the date of the page they come from.
- Do not present an opinion as a fact. If the evidence is thin, say so in the summary.
- For a pricing or legal question, read the vendor's public documentation page named in the answer before you write.
- See also: [deep-research](../deep-research/SKILL.md) for a long multi-source report. It is optional: this skill is complete for a one-page brief.
