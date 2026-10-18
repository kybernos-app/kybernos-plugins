// J3 — folders. Creating a team makes <Documents>/Kybernos/<Team> (in the sandbox's HOME); a switch opens a new chat whose session folder is the team's; back to
// Personal opens one in the previous workspace; a chat already started keeps its folder after a switch. (Joining a team is played in J4.)
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openGui, recorder, sleep, mainCalls, chatCalls, cwdOf, bodyOf } from './common.mjs'

export const run = async (ctx) => {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase()
  const { check, note, finish, rec } = recorder(ctx, 'J3')
  ctx.as('a')
  const A = await ctx.sessionOf('a')
  const P = await ctx.personalId('a')
  const { t1, t2 } = ctx.ids
  const homeA = process.env.KB_E2E_HOME_A
  if (!homeA) throw new Error('KB_E2E_HOME_A (the sandbox HOME of account A) is not set')
  const kyb = join(homeA, 'Documents', 'Kybernos')
  const personalRepo = process.env.KB_WORKTREE || null
  await ctx.engine({ text: 'FOLDERCHECK', prompt: 50, completion: 5 })

  const g = await openGui(ctx.hostA)
  const goTo = (id, label) => g.goTo(id, label)
  const turn = async (text) => {
    await g.selectModel('GLM')
    const t = await g.send(text)
    await g.until(() => mainCalls(ctx.rows(t)).length >= 1, 15000, 100)
    await sleep(2500)
    const rows = ctx.rows(t)
    return { chats: chatCalls(rows), mains: mainCalls(rows), t }
  }
  const folderName = (cwd) => (cwd ? cwd.split('/').slice(-2).join('/') : null)
  // a team folder is named after the team; a name already on the disk (an earlier sandbox's) is never taken over: « <Name> (<first 8 of the id>) »
  const isTeamFolder = (cwd, name) => new RegExp('^Kybernos/' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( \\([0-9a-f]{8}\\))?$').test(folderName(cwd) || '')
  try {
    await sleep(2500)
    // 1. creating a team through the dialog
    console.log('\n1. « Create a team » (the dialog) makes the team and its folder')
    const before = existsSync(kyb) ? readdirSync(kyb) : []
    check('the « Create a team » row is in the menu', await g.pressSpaceAction('create'))
    check('the dialog opens', !!(await g.until(() => g.exists('[data-kb="new-team"]'), 4000)))
    const name = 'E2E Gamma ' + Math.random().toString(36).slice(2, 5)
    await g.press('[data-kb="new-team"] input')
    await g.page.send('Input.insertText', { text: name })
    await sleep(200)
    await g.key('Enter', 'Enter', 13)
    check('the dialog closes (the team was created)', !!(await g.until(async () => !(await g.exists('[data-kb="new-team"]')), 15000)))
    await sleep(2500)
    const after = existsSync(kyb) ? readdirSync(kyb) : []
    check(`the folder ${name} exists under Documents/Kybernos of the sandbox`, after.includes(name), { before, after })
    const list = await ctx.server.call('GET', '/v1/workspaces', { cookie: A.cookie })
    const created = (Array.isArray(list.body) ? list.body : list.body.workspaces).find((w) => w.name === name)
    check('the server holds the new team and A owns it', !!created && created.role === 'owner', created && created.role)
    const cue = await g.text('.kbcue')
    note('after the creation the composer cue reads: ' + JSON.stringify(cue))
    await ctx.shot(g, 'j3-created')
    rec.created = { name, id: created && created.id }

    // 2. switching opens a chat in the team's folder
    console.log('\n2. a switch to T1 opens a new chat in the team folder; back to Personal opens one in the previous workspace')
    await goTo(t1, /E2E Alpha/)
    const folderPill = await g.text('[data-kb="cue-folder"]')
    check('the composer shows a folder pill for the team', typeof folderPill === 'string' && /Alpha/.test(folderPill), folderPill)
    const a1 = await turn('J3 alpha one')
    check('the new chat\'s session folder is the team\'s (Documents/Kybernos/E2E Alpha)', isTeamFolder(cwdOf(a1.mains[0]), 'E2E Alpha'), cwdOf(a1.mains[0]))
    await goTo(P, /Personal/)
    check('no folder pill in Personal', !(await g.exists('[data-kb="cue-folder"]')))
    const p1 = await turn('J3 personal one')
    const pc = cwdOf(p1.mains[0])
    check('back in Personal the chat opens in the previously used (non-team) workspace', pc !== null && !/\/Kybernos\//.test(pc) && (personalRepo === null || pc === personalRepo), pc)
    check('the Personal chat is billed to Personal', p1.chats.every((c) => c.workspace === P))

    // 3. a chat already started keeps its folder after a switch
    console.log('\n3. a chat started in T1 is continued after a switch to T2')
    await ctx.engine({ text: 'ALPHACHAT' + tag, prompt: 50, completion: 5 })
    await goTo(t1, /E2E Alpha/)
    const s1 = await turn('J3 started in alpha')
    await sleep(2000)
    await ctx.engine({ text: 'OTHERCHAT', prompt: 50, completion: 5 })
    await goTo(t2, /E2E Beta/)
    // the sidebar keeps the active team's folder open and the others folded: open the folder of T1 first when its chats are not on screen
    if ((await g.leaf('ALPHACHAT' + tag)) === null) { await g.pressText('E2E Alpha'); await sleep(800) }
    const opened = await g.until(async () => g.pressText('ALPHACHAT' + tag), 8000, 300)
    check('the T1 chat can be opened again from the sidebar while T2 is active', opened === true)
    await sleep(1500)
    const s2 = await turn('J3 continued after the switch')
    const folder2 = folderName(cwdOf(s2.mains[0]))
    check('the chat keeps its folder (E2E Alpha), whatever team is active now', isTeamFolder(cwdOf(s2.mains[0]), 'E2E Alpha'), folder2)
    const hdr = s2.chats[0] && s2.chats[0].workspace
    note(`that chat's requests carry the ACTIVE team (${hdr === t2 ? 'T2' : hdr === t1 ? 'T1' : hdr}), while its folder is T1's`)
    check('the continued T1 chat is billed to T1 (the team of its folder), not to the team that happens to be active', hdr === t1, { header: hdr === t2 ? 'T2' : hdr === t1 ? 'T1' : hdr, folder: folder2 })
    // 4. a draft typed before a switch (Miled's open question: does it survive?)
    console.log('\n4. a draft typed in the composer, then a switch')
    await goTo(P, /Personal/)
    await g.send('DRAFT-TEXT-77 not sent', { enter: false })
    await sleep(500)
    const typed = await g.val(`(() => { const e = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).pop(); return e ? (e.innerText || e.value || '') : null })()`)
    await goTo(t1, /E2E Alpha/)
    const afterT = await g.val(`(() => { const e = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).pop(); return e ? (e.innerText || e.value || '') : null })()`)
    await goTo(P, /Personal/)
    const back = await g.val(`(() => { const e = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).pop(); return e ? (e.innerText || e.value || '') : null })()`)
    note(`draft typed in Personal: ${JSON.stringify(typed && typed.trim())}; after a switch to T1 the new chat's composer holds ${JSON.stringify(afterT && afterT.trim())}; back in Personal ${JSON.stringify(back && back.trim())}`)
    rec.draft = { typed: !!(typed && /DRAFT-TEXT-77/.test(typed)), keptInTeam: !!(afterT && /DRAFT-TEXT-77/.test(afterT)), keptBack: !!(back && /DRAFT-TEXT-77/.test(back)) }
    rec.continued = { folder: folder2, header: hdr === t2 ? 'T2' : hdr === t1 ? 'T1' : hdr }
    await ctx.shot(g, 'j3-continued')
  } finally { await g.close() }
  return finish()
}
