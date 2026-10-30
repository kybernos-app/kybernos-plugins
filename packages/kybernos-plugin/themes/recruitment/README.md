# Recruitment firm

A Kybernos theme for a recruitment firm. Data only: JSON and Markdown, no code; the only pictures are the cover and the sample pictures (`demo/photos/`: photographs of the items and portraits of the people, invented, made by `scripts/theme-photos.mjs` from the plans in `docs/dev/theme-photos/`).

| What | Words and content |
|---|---|
| Business rows | Candidates and clients, Jobs, Placements |
| Contacts | candidates, client contacts and client companies |
| Catalog | one kind of item, the job, with open, on hold, filled and draft |
| Pipeline | two boards: Candidates (sourced to placed) and Client missions (brief to placed) |
| Dashboards | one overview dashboard: open jobs, candidates in play, placements, the oldest open job, candidates and client missions by stage, where candidates come from |
| Kit | 2 skills, 1 team, 4 automations (created switched off), 4 goals taken from the former `recrutement` pack |
| Style | the dark indigo "recrutement-ssii" preset |

`demo/sample.json` holds the sample rows of an invented firm ("Northgate Talent"): 17 people (12 candidates, 5 hiring managers) and 5 client companies (tagged, with their location, seniority and availability), 14 jobs each with its photograph, department, seniority, location and contract, 19 cards on the two boards with a source, a priority, a due date and tags, 8 notes. Every name, address and message is made up; e-mail addresses are on `example.com`.

See `docs/dev/shipped-themes.md` for the folder shape and how to add another theme.
