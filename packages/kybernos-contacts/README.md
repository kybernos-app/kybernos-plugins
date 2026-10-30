# kybernos-contacts

The people and companies of your work in one list, with notes, search, and the kinds and fields your theme speaks of. Free, local, nothing is sent anywhere.

It is one of the three business plugins (Contacts, Catalog, Pipeline) built on the shared business base of the core (`docs/dev/business-base.md`). Its row sits in the collapsible
**Business** group of the menu (`docs/dev/business-menu.md`).

## For the person

| | |
|---|---|
| Where | In the menu, under Business: Contacts (the theme may rename the row: « Clients », « Candidates »…) |
| The page | the product's own bar in the header row (search by name or email, the view switch Cards / List, filters and sort, « New contact »), People / Companies with their counts, the theme's types as coloured chips, the tags and the period as filters in the bar's menu, « Show archived », a rich list or a grid of cards (a page is the 500 rows the host gives), a side panel that slides in, a dialog to add or change |
| A panel | a tinted header (avatar, type, company, Email, Edit), fields in the theme's words, coloured tags, the company (or the people of a company), the cards of a board that point at the contact, the notes as a timeline, Archive / Restore |
| Motion | rows and cards come in one after the other, a card lifts on hover, a row shows its actions (write, edit) on hover or focus, a chosen tag pops, the panel slides in and out; all of it stops under `prefers-reduced-motion` |
| What is kept | the view, the sort and its direction stay in this browser (the core's own toolbar hook); the search, the filters and the period are not kept. Nothing new is written on the server. A contact has no favourite, so the bar has no star |
| Notes | added, never edited or deleted: they are the history of the contact |
| Archive | hides a contact without deleting it; « Show archived » brings it back, Restore undoes it |
| Sample rows | a theme brings a few rows marked « demo »; « Clear sample data » removes them in one go (the base holds one set for the three plugins, so it clears Catalog and Pipeline samples too; what you added stays) |
| Agents | `contacts_find` reads (free). `contacts_upsert` adds or changes a contact: **you approve every call**, and the journal says `agent` |
| Where it lives | `<DSH home>/kybernos/business/donnees.sqlite`, one file for the three plugins, private (0600) |

## For a theme

A theme tells Contacts its words through the point `kybernos/contacts#schema` (`contacts-schema.mjs`, checked by `node scripts/plugin-check.mjs <theme folder>`): kinds of contact
(`person` or `company`, each type with a label), custom fields (`text`, `number`, `money`, `date`, `choice`, `email`, `url`), and the usual tags. The registry hands back what the
**active** themes gave; the host merges it (the first theme to name a key keeps it; a kind with no type of its own gets the plain `person` / `company`) and serves it at
`/kybernos-contacts/schema`. With no theme installed the words are plain English: Person, Company, no field, no tag. A row keeps the key of its type: remove the theme and its rows
are drawn as a plain person or company, nothing is lost. With several themes installed only the **active** one speaks (`docs/dev/business-visuals.md`): the schema, the list, the counts and the sample data
are that template's; the others wait, installed.

## For the code

| File | What |
|---|---|
| `index.js` | host: tells the registry its point, mounts the nine routes (behind the host fence and the session guard), registers the two tools, answers `tools/pre-execute` with `ask` for `contacts_upsert` |
| `contacts-api.mjs` | what the routes and the tools do, with the base and the words passed in as ports (`base()`, `schema()`: looked up when a request comes, never at boot). No disk, no network |
| `contacts-input.mjs` | what a contact may carry, checked against the theme's words (type belongs to the kind, every custom field is the theme's and of its kind) |
| `contacts-words.mjs` | the merged words of the active themes, the plain defaults, the vocabulary an agent needs |
| `contacts-tools.mjs` | `contacts_find`, `contacts_upsert`, the approval gate |
| `contacts-schema.mjs` | the point `kybernos/contacts#schema` (bounded, pure) |
| `session-guard.mjs`, `lib-session-test.mjs` | copies of the shared guard (`node scripts/test-session-guard.mjs` keeps them equal) |
| `client.js` | the page, the menu row (declared inside `apply`, waited for if the core has not published its registry yet, taken back by the cleanup), the slot `main.kybernos-business` with the key `contacts`. The page draws the core's `KbToolbar` when the core hands it over (`props.toolbar`), a plain bar of its own otherwise; its coloured tags, avatars and motion classes come from the shared kit `window.__KB_BIZ_KIT__`, read when it renders (plain chips and initials without it). The facets, the period and the sort are done on the rows the host gave |

### Routes (all under `/kybernos-contacts`)

Every route, reads included, needs DSH's signed session cookie (a contact is personal data and plugin routes are served before DSH's own sign-in); a write also needs the strict origin and is
refused when it comes through the phone link. The actor of a write is never read from a request: the page's routes say `person`, the tools say `agent`.

| Route | |
|---|---|
| `GET schema` | the merged words |
| `GET list?q=&kind=&type=&tag=&company_id=&archived=1&limit=&offset=` | at most 500 rows (100 by default), `total`, `demo` (how many sample rows), the company name on each row. A tag filter is made here (the base cannot), reading up to 10,000 contacts |
| `GET get?id=` | the contact, its notes (newest first), its company, the people of a company, the cards that point at it |
| `POST create`, `update` (`{ id, …fields }`), `archive`, `restore` (`{ id }`), `note` (`{ id, text }`) | answers `{ ok, contact }` or `{ ok: false, error, detail }`; 400 for a refused value, 404 for a row that is not there, 503 when the base is not |
| `POST clear-demo` (`{ confirm: true }`) | removes the sample rows of the business plugins |

A base that is not there (`globalThis[Symbol.for('kybernos.business')]`) answers `base_missing` (503), a registry that is not there gives the plain words, and nothing ever stops DSH from starting.

### Tests

```
node packages/kybernos-contacts/test-host.mjs          # words, input rules, the routes over a real SQLite file, the tools, the approval
node packages/kybernos-contacts/test-write-guard.mjs   # every route against no origin, a foreign origin, no/forged/expired cookie, the phone link
node packages/kybernos-contacts/test-client.mjs        # registration, every state of the page as a tree, languages, DSH's tokens only
source scripts/sandbox/env.sh && node scripts/check-contacts-live.mjs [--shots <dir>]   # sandbox only: the real GUI, a real mouse and keyboard
```
