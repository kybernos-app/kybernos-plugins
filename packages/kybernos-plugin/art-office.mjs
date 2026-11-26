// The Office and OpenDocument files a chat writes (a report, a workbook, a deck). They are creations like a PDF or a Markdown file, so the sidebar and the Creations page
// list them; until 2026-11-03 the whitelist of the host stopped at pdf, csv and text, and a chat that made a .docx, an .xlsx and a .pptx showed none of the three.

export const KB_OFFICE_EXTS = ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp']

/** Word, Excel and PowerPoint leave `~$name.docx` next to a file that is open: a lock, not a creation. */
export const kbIsOfficeLock = (name) => String(name === null || name === undefined ? '' : name).startsWith('~$')
