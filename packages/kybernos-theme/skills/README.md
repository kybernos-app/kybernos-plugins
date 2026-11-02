# Skills shipped with the Theme plugin

| Skill | What it does | Writes |
|---|---|---|
| `loader/` | Turns a description into one animated SVG (chat: `/skill-loader ...`) | `<dsh home>/kybernos/loaders/<slug>.svg` |
| `loading-text/` | Writes a personal pack of waiting labels (chat: `/skill-loading-text ...`) | `<dsh home>/kybernos/loading-text.json` |

`<dsh home>` is `DSH_HOME` when set, else `~/.dsh`. Both files are read by the host
route `/kybernos-theme/loader-store` (see `../loader-store.mjs`), which applies the same
refusal rules as the skills: an SVG that could run code or fetch anything is refused, never
rewritten, and shows up in the `skipped` list of that route's answer.

## How a skill reaches the user

At host start, `../index.js` calls `seedSkills` (`../seed-skills.mjs`), which copies each
`<name>/SKILL.md` to `<dsh home>/skills/<name>/SKILL.md`, where DSH's registry finds user
skills. The user's edits win:

- a missing file is created;
- a file that still matches what we copied last time (sha-256 kept in
  `<dsh home>/kybernos/seeded-skills.json`) is refreshed when the plugin ships a new text;
- a file the user changed, or a `SKILL.md.disabled` next to it, is left alone.

## Adding a skill

1. Create `<name>/SKILL.md` here. The frontmatter needs `name` (the same as the folder,
   lowercase words joined by hyphens) and `description`; `whenToUse` is optional.
2. Add the name to `SEEDED_SKILLS` in `../index.js`.
3. Keep it in English, and keep any command it asks the agent to run tested (the
   `loader` example and its check are exercised by `../test-loader-store.mjs`).
