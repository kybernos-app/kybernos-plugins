#!/usr/bin/env node
// Near-duplicate detection (dedupe.mjs): what is grouped, what is kept, and what is deliberately left alone.
//   node packages/kybernos-cloud/test-dedupe.mjs
import assert from 'node:assert/strict'
import { findDuplicateGroups, likeness, sameFact, DEDUPE_TUNING } from './dedupe.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const mk = (id, content, extra = {}) => ({ id, content, createdAt: '2026-09-10 10:00:00+00:00', pinned: false, bucket: 'fact', ...extra })
const idsOf = (groups) => groups.map((g) => g.items.map((i) => i.id).sort())

console.log('what is the same fact')
const tz = [
  mk(1, "Fuseau horaire de l'utilisateur : Europe/Paris (à utiliser pour interpréter les dates et heures non qualifiées)", { createdAt: '2026-09-01 10:00:00+00:00' }),
  mk(2, "Fuseau horaire de l'utilisateur : Europe/Paris (interpréter les dates et heures non qualifiées dans ce fuseau).", { createdAt: '2026-09-05 10:00:00+00:00' }),
  mk(3, "Fuseau horaire de l'utilisateur : Europe/Paris (interpréter les dates/heures non qualifiées dans ce fuseau)", { createdAt: '2026-09-09 10:00:00+00:00' }),
  mk(4, 'Utilise pnpm pour les installs'),
]
const g1 = findDuplicateGroups(tz)
assert.equal(g1.length, 1)
assert.deepEqual(idsOf(g1), [[1, 2, 3]])
assert.equal(g1[0].saves, 2)
assert.equal(g1[0].keeperId, 1, 'the most complete one is kept (it has the most distinct words)')
assert.ok(g1[0].items[0].keep && g1[0].items.slice(1).every((i) => !i.keep))
assert.ok(g1[0].score >= 80 && g1[0].score <= 100)
ok('three rewordings of one fact are one group; the most complete is kept; an unrelated memory is left out')

const exact = [mk(1, 'Toujours répondre en français', { createdAt: '2026-09-01 10:00:00+00:00' }), mk(2, 'Toujours répondre en français', { createdAt: '2026-09-09 10:00:00+00:00' }), mk(3, 'toujours repondre en francais !', { createdAt: '2026-09-05 10:00:00+00:00' })]
const g2 = findDuplicateGroups(exact)
assert.equal(g2[0].keeperId, 2, 'identical wording: the newest is kept')
assert.equal(g2[0].items.length, 3, 'accents, case and punctuation do not make a difference')
assert.equal(g2[0].score, 100)
ok('identical wording (accents and punctuation aside): the newest is kept')

console.log('what is deliberately left alone')
assert.equal(findDuplicateGroups([mk(1, 'Le serveur de dev écoute sur le port 3000'), mk(2, 'Le serveur de dev écoute sur le port 3080 (changé le 2 oct.)')]).length, 0, 'an older value replaced by a newer one is a judgement, not a word count')
assert.equal(findDuplicateGroups([mk(1, 'Le projet A se déploie sur Vercel (branche dev)'), mk(2, 'Le projet B se déploie sur Railway (branche dev)')]).length, 0, 'similar sentences about different things stay apart')
assert.equal(findDuplicateGroups([mk(1, 'Europe/Paris'), mk(2, 'Europe/Paris')]).length, 0, 'under 3 words nothing is compared')
const swallow = findDuplicateGroups([mk(1, 'Europe Paris fuseau horaire'), mk(2, "Pour toutes les réunions du lundi matin le fuseau horaire Europe Paris s'applique partout et pour tous")])
assert.equal(swallow.length, 0, 'a short fact does not swallow a long sentence that merely contains it')
const sub = findDuplicateGroups([mk(1, 'Un projet est situé dans le dossier dsh-kybernos du workspace'), mk(2, "L'utilisateur travaille sur le projet nommé dsh-kybernos situé dans le dossier dsh-kybernos du workspace principal")])
assert.equal(sub.length, 1, 'a 4+ word statement wholly inside a longer one that says the same is a duplicate (contained + 60 % alike)')
ok('replaced values, different subjects, tiny items and loose containment are not merged')

assert.equal(findDuplicateGroups([mk(1, 'Toujours répondre en français', { bucket: 'fact' }), mk(2, 'Toujours répondre en français', { bucket: 'preference' })]).length, 0, 'same text, different kind: not compared')
assert.equal(findDuplicateGroups([mk(1, 'meme texte de lecon', { bucket: 'kyber-a' }), mk(2, 'meme texte de lecon', { bucket: 'kyber-b' })]).length, 0, 'lessons of two kybers are never merged')
ok('only items of the same kind (or the same kyber) are compared')

console.log('stars, not chains')
const base = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'theta', 'iota', 'kappa', 'lambda']
const wA = base                                              // 10 words
const wB = [...base.slice(0, 9), 'xx1']                      // 9 shared with A  → alike (0.82)
const wC = [...base.slice(0, 8), 'xx1', 'yy2']               // 8 shared with A (0.67), 9 shared with B (0.82)
assert.ok(sameFact(new Set(wA), new Set(wB)) && sameFact(new Set(wB), new Set(wC)) && !sameFact(new Set(wA), new Set(wC)), 'sanity: A~B, B~C, A≁C')
const text = (w) => w.join(' ')
// A is the keeper (newest): B joins it, C does NOT (C is only alike to B)
const aKeeps = findDuplicateGroups([mk(1, text(wA), { createdAt: '2026-09-09 10:00:00+00:00' }), mk(2, text(wB), { createdAt: '2026-09-05 10:00:00+00:00' }), mk(3, text(wC), { createdAt: '2026-09-01 10:00:00+00:00' })])
assert.deepEqual(idsOf(aKeeps), [[1, 2]], 'A~B and B~C does not put C with A: the group is a star around its keeper')
// B is the keeper: both are alike to B, so both join it (each is a rewording of the keeper itself)
const bKeeps = findDuplicateGroups([mk(1, text(wA), { createdAt: '2026-09-01 10:00:00+00:00' }), mk(2, text(wB), { createdAt: '2026-09-09 10:00:00+00:00' }), mk(3, text(wC), { createdAt: '2026-09-05 10:00:00+00:00' })])
assert.deepEqual(idsOf(bKeeps), [[1, 2, 3]])
assert.equal(bKeeps[0].keeperId, 2)
ok('a group is a star around its keeper: every member is alike to the keeper itself, never only to a neighbour')

console.log('pinned')
const pins = findDuplicateGroups([mk(1, 'Règle durable : toujours demander avant de supprimer', { pinned: true, createdAt: '2026-01-01 10:00:00+00:00' }), mk(2, 'Règle durable : toujours demander avant de supprimer un fichier', { createdAt: '2026-09-09 10:00:00+00:00' })])
assert.equal(pins[0].keeperId, 1, 'a pinned memory is always the keeper, however old and short')
assert.equal(findDuplicateGroups([mk(1, 'Règle durable : toujours demander avant de supprimer', { pinned: true }), mk(2, 'Règle durable : toujours demander avant de supprimer', { pinned: true })]).length, 0, 'two pinned memories are two deliberate choices: never grouped')
ok('a pinned memory is the keeper and is never removed; two pinned are never grouped')

console.log('stable and safe')
const shuffled = [...tz, ...exact.map((e) => ({ ...e, id: e.id + 100 }))]
const a = findDuplicateGroups(shuffled)
const b = findDuplicateGroups([...shuffled].reverse())
assert.deepEqual(a.map((g) => [g.id, g.keeperId, g.items.map((i) => i.id)]), b.map((g) => [g.id, g.keeperId, g.items.map((i) => i.id)]), 'the input order never changes the result')
assert.equal(new Set(a.map((g) => g.id)).size, a.length)
assert.equal(findDuplicateGroups(tz)[0].id, findDuplicateGroups([...tz].reverse())[0].id, 'a group keeps its id across scans')
const twins = [mk(7, 'exactement la meme phrase ici'), mk(3, 'exactement la meme phrase ici'), mk(5, 'exactement la meme phrase ici')]
assert.equal(findDuplicateGroups(twins)[0].keeperId, 3, 'a complete tie goes to the lowest id')
assert.equal(findDuplicateGroups([...twins].reverse())[0].keeperId, 3, '… whatever the input order')
for (const bad of [null, undefined, [], [null, 3, 'x', {}], [{ id: 1 }], [{ id: 1, content: null }], 'text', 42]) assert.doesNotThrow(() => findDuplicateGroups(bad))
assert.deepEqual(findDuplicateGroups([null, mk(1, 'a b c d e'), undefined]), [])
ok('deterministic (any input order), stable group ids, odd input never throws')

assert.deepEqual(DEDUPE_TUNING, { jaccard: 0.8, containment: 0.95, containmentJaccard: 0.6, containmentMinWords: 4, minWords: 3 })
const many = Array.from({ length: 1500 }, (_, i) => mk(i, ['Utilise pnpm pour les installs', 'Never commit .env files', 'Prefers short answers in French', 'Works on macOS with zsh'][i % 4] + ' variante numero ' + String(i * 7919)))
const t0 = performance.now()
const big = findDuplicateGroups(many)
const ms = performance.now() - t0
assert.ok(ms < 3000, '1500 items took ' + ms.toFixed(0) + ' ms')
ok('1500 items scanned in ' + ms.toFixed(0) + ' ms (' + String(big.length) + ' groups)')

console.log('\n' + pass + ' verifications OK')
