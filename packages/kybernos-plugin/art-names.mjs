// The names a person may give a file of Creations (rename, duplicate), as two pure functions so a test can run them.
//
// The old rule was `[A-Za-z0-9][A-Za-z0-9 ._-]`: « résumé.md » could be neither renamed nor duplicated (its copy « résumé copy.md » was refused as invalid), and a rename
// typed without its extension (« plan » for « plan.md ») left a file that Creations no longer lists (a file with no known extension is not a creation).

/**
 * Is this a name a person may give? Letters of any language (an accent may be one character or a letter plus a combining mark, as macOS stores it), digits, space and
 * `. _ ( ) [ ] & ' + , -`; a letter or a digit first (so never a hidden file); at most 120 characters. No `/` (a name is not a path) and no control character.
 * The shell command that does the rename single-quotes the name, so none of these characters can leave the quotes.
 */
export const kbArtNameOk = (name) => typeof name === 'string' && /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._()[\]&'+,-]{0,119}$/u.test(name)

/**
 * A rename typed without its extension keeps the old one when the new name has none that Creations lists: « plan v2 » for « plan.md » becomes « plan v2.md ».
 * `ext` is the old extension with its dot (`.md`, or '' for none); `listed(name)` says whether a name carries an extension Creations lists.
 */
export const kbArtKeepExt = (newName, ext, listed) => (ext !== '' && listed(newName) !== true ? newName + ext : newName)
