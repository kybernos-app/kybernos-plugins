# Real estate agency

A Kybernos theme for an estate agency. Data only: JSON and Markdown, no code; the only pictures are the cover and the sample pictures (`demo/photos/`: photographs of the properties and portraits of the people, invented, made by `scripts/theme-photos.mjs` from the plans in `docs/dev/theme-photos/`).

| What | Words and content |
|---|---|
| Tables | five ready Tables: Contacts, Properties, Lettings, Sales and Notes, linked to one another (a sale points to its property and its buyer) |
| Views | a gallery with a cover picture and a map of the properties, boards by status, sales and lettings pipelines, calendars of closings and move-ins |
| Dashboards | one overview dashboard: active listings, open sales value, viewings to run, mandates ending soon, properties by status, the sales pipeline by stage, leads by source |
| Kit | 2 skills, 1 team, 3 automations (created switched off), 4 goals taken from the `immo` pack |
| Style | the warm light "immobilier-locatif" preset |

`demo/db-sample.json` holds the sample rows of an invented agency ("Harbor & Pine Realty"): 27 contacts (people and companies), 16 properties, 8 lettings, 11 sales, 11 notes. Every name, address and message is made up; e-mail addresses are on `example.com`.

See `docs/dev/shipped-themes.md` for the folder shape and how to add another theme.
