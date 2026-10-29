# E-commerce shop

A Kybernos theme for an online shop. Data only: JSON and Markdown, no code; the only pictures are the cover and the sample photographs (`demo/photos/`, invented, made by `scripts/theme-photos.mjs` from the plans in `docs/dev/theme-photos/`).

| What | Words and content |
|---|---|
| Business rows | Customers, Products, Orders |
| Contacts | customers and trade customers, suppliers and their contacts |
| Catalog | one kind of item, the product, with live, draft and out of stock, and a low-stock flag |
| Pipeline | one board, Orders: new, paid, packed, shipped, delivered |
| Dashboards | one overview dashboard: revenue from paid orders, orders to ship, low stock, customers, orders by status, products by category, products to reorder, top products |
| Kit | 2 skills, 1 team, 2 automations (created switched off), 4 goals taken from the `com` pack |
| Style | the warm light "e-commerce" preset |

`demo/sample.json` holds the sample rows of an invented shop ("Fern & Cove"): 16 people and 6 companies (tagged, with their city, total spent and last order), 16 products each with its photograph, category, material, badge and rating, 18 orders with a source, a priority, a due date and tags, 8 notes. Every name, address and message is made up; e-mail addresses are on `example.com`.

See `docs/dev/shipped-themes.md` for the folder shape and how to add another theme.
