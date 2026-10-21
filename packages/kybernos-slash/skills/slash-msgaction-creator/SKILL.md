---
name: slash-msgaction-creator
description: Interview the user, then draft one Entry — a slash command or a message action — with its template and its conditional fields, and write it where the kybernos slash plugin reads it.
whenToUse: Load when the user asks to create a slash command or a message action for kybernos, or says "I want a command that…", "add a button under the message that…". Ask the interview questions before writing anything.
---

# Creating a slash command or a message action

A slash command and a message action are **the same object**. Only `kind`
changes: `slash` lives in the `/` palette, `action` is a button under a received
message. One entry, two surfaces. Never write an entry before the interview: an
entry built from a one-line guess is a button nobody presses.

## 1. The shape you are filling

```json
{
  "version": 1,
  "id": "standup", "kind": "slash", "slug": "standup",
  "label": "Team standup", "description": "Asks three framed questions",
  "icon": "list", "order": 2, "active": true, "hiddenInToolbar": false,
  "template": "Daily standup — {scope}.\nDone: {done}{blockers}",
  "fields": [
    { "key": "scope", "label": "Scope", "type": "select", "required": true,
      "default": "day", "options": [{ "value": "day", "label": "Today" }] },
    { "key": "bullets", "label": "How many bullets", "type": "number",
      "showIf": [{ "field": "format", "op": "=", "value": "bullets" }], "required": true },
    { "key": "blockers", "label": "Which ones", "type": "textarea",
      "showIf": [{ "field": "hasBlockers", "op": "=", "value": true }] }
  ]
}
```

| Field | Rule |
|---|---|
| `kind` | `slash` (palette) or `action` (button under a message) |
| `id`, `slug` | kebab-case, unique; `id` identifies the entry |
| `template` | `{key}` is replaced by the value; `{message}` is the targeted message (actions only); `{{key}}` is also accepted |
| `fields` | empty → the template is inserted as-is; non-empty → an inline form opens |
| `type` | `text` (default), `textarea`, `number`, `select`, `checkbox`, `date` |
| `showIf` / `hideIf` | list of `{field, op, value}`; **all** must hold (AND) |
| `requireIf` | same shape: the field becomes required only then |
| `required` | blocks submission while the value is empty |
| `order` | ascending |
| `active: false` | removes the entry from the palette and the button row |
| `hiddenInToolbar` | puts an action in the `…` menu instead of the row |

Operators: `=` `!=` `>` `<` `>=` `<=` `in` `contains` `empty` `notEmpty`.

Two rules that decide most of the design:

- **A hidden field is never required.** Hiding a field disarms its `required`.
- **An empty value disappears cleanly** — no leftover space, no stray line. Write
  the template so it reads correctly with the optional parts removed.

## 2. Interview first — do not skip

Ask these, in plain language, and wait. Group them in one message so the user
answers once:

1. **What should it do?** The outcome, in the user's words. Push for the exact
   text they want to end up with: "a standup block with today's scope" beats
   "help me with standups".
2. **Command or button?** `/` in the box, or a button under a received message?
   If they hesitate: a command is something they *start*, an action is something
   they *do to a message*.
3. **Does it need inputs?** What varies between two uses. Each real variable
   becomes one field; anything constant goes into the template as plain text.
4. **Which inputs depend on others?** This is where `showIf` earns its place —
   and it is the question the user has never been asked before, so ask it with
   an example: "if you tick *blockers*, do you want to name them?"
5. **Where should it sit in the list?** Only if they already have entries.

Do **not** ask for `id`, `slug`, `version` or `run`: derive them and say what you
chose. `run` is never written by hand — it is inferred from `fields`.

## 3. Propose, then confirm

Before writing, show the **complete JSON** in a fenced block, and above it one
sentence per decision a human would want to challenge:

```
Scope is a select (today / week). "How many bullets" appears only in bullets
mode, and is required there. Blockers stay optional on purpose.
```

Then stop. Wait for an explicit yes or corrections. **Show the JSON before
writing it, always** — this entry ends up in front of the user every day.

## 4. Write it

Use the slash plugin's **host tool** `enregistrer_entree`: it is the plugin's own
code, run in process, so the entry goes through the same validation and the same
store as the page — and nothing is written by an unauthenticated HTTP call.

```
enregistrer_entree({ body: { entry: { id: "standup", kind: "slash", ... } } })
```

`body` is exactly the route's body: `{entry}`, `{entries}`, `{delete: id|[ids]}`,
`{replace: [...]}`. A refusal comes back as `{ok: false, error}` with the reason
(`body object expected`, the model's validation message, `corrupt`/`unreadable`
for a store that must not be overwritten) and **nothing is written**.

Do **not** POST to `/kybernos/slash/entries`: since 21/10/2026 that route is the
**page's** path and needs DSH's signed session cookie (a `curl` gets 401/403, and
that refusal is not "the plugin is not wired"). If the tool is not available on
this host (an older plugin), write the store directly. It is one JSON array of
entries:

`~/.dsh/kybernos-slash/entries.json`

```bash
mkdir -p ~/.dsh/kybernos-slash
node -e '
  const fs = require("fs"), p = process.env.HOME + "/.dsh/kybernos-slash/entries.json";
  const entry = JSON.parse(fs.readFileSync(0, "utf8"));
  const all = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
  const i = all.findIndex((e) => e.id === entry.id);
  if (i >= 0) all[i] = entry; else all.push(entry);
  all.sort((a, b) => (a.order || 0) - (b.order || 0));
  fs.writeFileSync(p, JSON.stringify(all, null, 2) + "\n");
  console.log("written", entry.id, "total", all.length);
' < /tmp/slash-entry.json
```

Merge by `id`: editing an existing entry replaces it, it does not duplicate it.

Rules inherited from the harness:

- An entry that only pastes a paragraph is a `text` entry — no fields. Do not add
  a field to make it look smarter.
- One condition per field, usually. A field whose visibility depends on three
  others is a form the user cannot predict.
- The template is the product. Read it aloud with the optional values empty.

## 5. Verify, then hand over

1. Read the store back and confirm the entry is there:

   ```bash
   node -e 'const a=require(process.env.HOME+"/.dsh/kybernos-slash/entries.json"); console.log(a.map(e=>e.id+" ("+e.kind+", "+e.run+", "+e.fields.length+" fields)").join("\n"))'
   ```

2. Read back to the user the **final text** their entry will produce, filled with
   the defaults — that is what they will actually see after clicking.
3. Tell them where it is and that a **Reload** picks it up.

Do not report success on an entry you did not read back.
