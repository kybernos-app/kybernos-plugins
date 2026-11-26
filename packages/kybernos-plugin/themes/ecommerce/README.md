# E-commerce shop

A Kybernos theme for an online shop. Data only: JSON and Markdown, no code; the only pictures are the cover and the sample pictures (`demo/photos/`: photographs of the items and portraits of the people, invented, made by `scripts/theme-photos.mjs` from the plans in `docs/dev/theme-photos/`).

| What | Words and content |
|---|---|
| Tables | four ready Tables: Contacts, Products, Orders and Notes, linked to one another (an order points to its customer and its products) |
| Views | a gallery of products, a board by status, an orders pipeline and a calendar of due dates |
| Dashboards | one overview dashboard: revenue from paid orders, orders to ship, low stock, customers, orders by status, products by category, products to reorder, top products |
| Kit | 2 skills, 1 team, 2 automations (created switched off), 4 goals taken from the `com` pack |
| Style | the warm light "e-commerce" preset |

`demo/db-sample.json` holds the sample rows of an invented shop ("Fern & Cove"): 22 contacts (customers, trade customers and suppliers), 16 products each with its photograph, category and rating, 18 orders, 8 notes. Every name, address and message is made up; e-mail addresses are on `example.com`.

See `docs/dev/shipped-themes.md` for the folder shape and how to add another theme.
