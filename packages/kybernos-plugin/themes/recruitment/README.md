# Recruitment firm

A Kybernos theme for a recruitment firm. Data only: JSON and Markdown, no code; the only pictures are the cover and the sample pictures (`demo/photos/`: photographs of the items and portraits of the people, invented, made by `scripts/theme-photos.mjs` from the plans in `docs/dev/theme-photos/`).

| What | Words and content |
|---|---|
| Tables | five ready Tables: Contacts, Jobs, Candidates, Client missions and Notes, linked to one another (a candidate points to a job and a contact) |
| Views | a gallery of jobs, boards by status and by stage for candidates and client missions, calendars of interviews and due dates |
| Dashboards | one overview dashboard: open jobs, candidates in play, placements, the oldest open job, candidates and client missions by stage, where candidates come from |
| Kit | 2 skills, 1 team, 4 automations (created switched off), 4 goals taken from the former `recrutement` pack |
| Style | the dark indigo "recrutement-ssii" preset |

`demo/db-sample.json` holds the sample rows of an invented firm ("Northgate Talent"): 22 contacts (candidates, hiring managers and client companies), 14 jobs each with its photograph, 10 candidates, 9 client missions, 8 notes. Every name, address and message is made up; e-mail addresses are on `example.com`.

See `docs/dev/shipped-themes.md` for the folder shape and how to add another theme.
