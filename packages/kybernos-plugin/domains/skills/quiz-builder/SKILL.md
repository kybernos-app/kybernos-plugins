---
name: quiz-builder
description: Builds a quiz with an answer key from a chapter, a course PDF or pasted notes, at the level the user asks for. Use when a teacher or a student wants questions to test understanding, a revision quiz, a worksheet or a short exam from given material.
---

# Quiz builder

Speak the user's language, whatever language this file is written in.

## Before you write
1. Find the material: the file the user names, or what they pasted. Read it fully. If none is given, ask for it; never write questions from general knowledge when the user clearly means their own course.
2. Ask in one message, only for what is missing: number of questions (default 10), level (recall, understanding, application), question types (multiple choice, short answer, true/false), and who it is for.

## Write
- Every question must be answerable from the material. Cite the section or page it comes from.
- Mix the levels: about half recall, the rest understanding and application.
- Multiple choice: one correct answer, three plausible wrong ones taken from real confusions in the material, no "all of the above".
- Keep the wording short and unambiguous. One idea per question.

## Output
1. The quiz, numbered, without answers.
2. Then a separate answer key: the answer, a one-line explanation, and the source section.
3. Offer a .docx (use the docx skill) or a flashcard version. Do not create files unless asked.

## Do not
- Invent facts, dates or figures that are not in the material.
- Reuse the same question twice in different words.
