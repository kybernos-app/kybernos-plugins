#!/usr/bin/env node
// The local relevance ranking (relevance.mjs): what it finds, in which order, and what it honestly cannot do.
//   node packages/kybernos-cloud/test-relevance.mjs
import assert from 'node:assert/strict'
import { normalize, stem, tokens, rank } from './relevance.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const mk = (id, content, extra = {}) => ({ id, content, createdAt: '2026-09-10 10:00:00+00:00', pinned: false, ...extra })
const ids = (r) => r.map((x) => x.doc.id)

console.log('words')
assert.equal(normalize('  Réunions, du LUNDI — à 9h !  '), 'reunions du lundi a 9h')
assert.equal(normalize(null), '')
assert.equal(normalize(undefined), '')
ok('normalize: accents, case and punctuation go; null and undefined are empty')
assert.equal(stem('reunions'), 'reunion')
assert.equal(stem('answers'), 'answer')
assert.equal(stem('files'), 'fil')
assert.equal(stem('travaux'), 'travau')
assert.equal(stem('running'), 'runn')
assert.equal(stem('wanted'), 'want')
assert.equal(stem('bus'), 'bus', 'a short word is left alone')
assert.equal(stem('is'), 'is')
ok('stem: plurals and -ing / -ed fold, a short word is never eaten')
assert.deepEqual(tokens('Le chat DE la maison, the cat of a house'), ['chat', 'maison', 'cat', 'house'])
assert.deepEqual(tokens('a b c ok'), ['ok'], 'a lone letter never counts')
assert.deepEqual(tokens('lesson 3 and 12'), ['lesson', '3', '12'], 'a single digit does ("lesson 3")')
assert.deepEqual(ids(rank([mk(1, 'lesson 30: x'), mk(2, 'lesson 3: y'), mk(3, 'lesson 13: z')], 'lesson 3')), [2, 1, 3], 'lesson 3 finds lesson 3 first, not lesson 30 or 13')
ok('tokens: stop words (FR and EN) and 1-letter words are out')

console.log('ranking')
const docs = [
  mk(1, 'Prefers short answers, in French', { createdAt: '2026-09-01 10:00:00+00:00' }),
  mk(2, 'Déteste les réunions du lundi matin', { createdAt: '2026-09-02 10:00:00+00:00' }),
  mk(3, 'Utilise Docker Desktop sur macOS', { createdAt: '2026-09-03 10:00:00+00:00' }),
  mk(4, 'Utilise Ollama en local avec Docker', { createdAt: '2026-09-04 10:00:00+00:00' }),
  mk(5, 'Le SI repose sur ERPNext comme source de vérité', { createdAt: '2026-09-05 10:00:00+00:00' }),
  mk(6, 'Apprend la guitare le soir', { createdAt: '2026-09-06 10:00:00+00:00' }),
]
assert.deepEqual(ids(rank(docs, 'reunion lundi')), [2], 'accents and plurals do not matter')
assert.deepEqual(ids(rank(docs, 'RÉUNIONS LUNDI')), [2])
assert.deepEqual(ids(rank(docs, 'short answer')), [1], 'English, singular for plural')
assert.deepEqual(ids(rank(docs, 'zzz')), [], 'no match, no result')
assert.deepEqual(ids(rank(docs, '')), [])
assert.deepEqual(ids(rank([], 'docker')), [])
assert.deepEqual(ids(rank(null, 'docker')), [])
ok('finds across accents, case, plurals and the two languages; nothing for a miss or an empty query')

const two = rank(docs, 'docker ollama')
assert.deepEqual(ids(two), [4, 3], 'the memory with both words first, then the one with one')
assert.deepEqual([two[0].matched, two[0].of, two[1].matched, two[1].of], [2, 2, 1, 2], 'it says how many of the words matched')
ok('more of the query\'s words first, and it says how many matched')

const many = Array.from({ length: 40 }, (_, i) => mk(100 + i, 'Utilise Docker pour le projet ' + i))
const rare = [...many, mk(1, 'Teste Ollama le week-end')]
const rr = rank(rare, 'docker ollama')
assert.equal(rr[0].doc.id, 1, 'a rare word (1 memory) outweighs a common one (40 memories)')
ok('rare words weigh more than common ones')

const full = [mk(10, 'docker '.repeat(30), { createdAt: '2026-01-01 00:00:00+00:00' }), mk(11, 'docker et ollama', { createdAt: '2026-01-01 00:00:00+00:00' })]
assert.equal(rank(full, 'docker ollama')[0].doc.id, 11, 'matching 2 of 2 words beats repeating one word')
ok('matching all the words beats repeating one of them')

console.log('partial words')
const pre = rank(docs, 'doc')
assert.deepEqual(ids(pre).sort(), [3, 4], 'a prefix finds docker')
const frag = rank(docs, 'cker')
assert.deepEqual(ids(frag).sort(), [3, 4], 'a fragment of 3+ letters finds it too')
// within ONE query the same word is worth the same, so the kind of match decides: exact > prefix > fragment
const kinds = [mk(1, 'fichier undocumented', { createdAt: '2026-09-09 10:00:00+00:00' }), mk(2, 'fichier dockerfile', { createdAt: '2026-09-08 10:00:00+00:00' }), mk(3, 'fichier doc', { createdAt: '2026-09-01 10:00:00+00:00' })]
assert.deepEqual(ids(rank(kinds, 'doc')), [3, 2, 1], 'exact word, then prefix, then fragment — even though the fragment is the newest')
assert.deepEqual(ids(rank(docs, 'do')), [], 'two letters are too little to match as a fragment')
ok('a prefix or a fragment (3+ letters) matches, always under an exact word')

// Seen on the real account: « utilisateur communique » returned memories that only had « com » (from yopmail.com)
const addr = [mk(1, "L'utilisateur utilise le compte milou7@yopmail.com"), mk(2, "L'utilisateur communique en français"), mk(3, 'Le plugin communique avec la console')]
assert.deepEqual(rank(addr, 'utilisateur communique').map((r) => [r.doc.id, r.matched]), [[2, 2], [3, 1], [1, 1]], 'a 3-letter word that merely begins the query word ("com") is not a match')
assert.deepEqual(ids(rank([mk(1, 'ouvre un com')], 'communique')), [], 'a short memory word never matches a long query word it only begins')
assert.deepEqual(ids(rank([mk(1, 'le fichier dockerfile')], 'docker')), [1], 'the user typing the start of a word still matches (docker → dockerfile)')
assert.deepEqual(ids(rank([mk(1, 'utilise docker')], 'dockerfile')), [1], 'a memory word that is most of the query word matches (dockerfile → docker)')
ok('a short word that only begins the query word is not a match; a typed start or most of the word is')

console.log('order is stable and fair')
const t1 = [mk(1, 'meme sujet', { createdAt: '2026-09-01 10:00:00+00:00' }), mk(2, 'meme sujet', { createdAt: '2026-09-09 10:00:00+00:00' }), mk(3, 'meme sujet', { createdAt: '2026-09-05 10:00:00+00:00', pinned: true })]
assert.deepEqual(ids(rank(t1, 'sujet')), [3, 2, 1], 'ties: pinned first, then newest')
assert.deepEqual(ids(rank([...t1].reverse(), 'sujet')), [3, 2, 1], 'input order does not change the result')
const shuffled = [...docs].sort(() => 0.5 - Math.random())
assert.deepEqual(ids(rank(shuffled, 'docker')), ids(rank(docs, 'docker')))
ok('ties: pinned, then newest; the result never depends on the input order')

const shortVsLong = [mk(1, 'docker ' + 'blabla '.repeat(60)), mk(2, 'docker')]
assert.equal(rank(shortVsLong, 'docker')[0].doc.id, 2, 'a short memory about it ranks over a long one that mentions it')
ok('a short memory about the word ranks over a long one that only mentions it')

console.log('stop words and odd input')
assert.deepEqual(ids(rank(docs, 'le soir')), [6], '« le » is dropped, « soir » decides')
assert.deepEqual(ids(rank([mk(1, 'rien a voir'), mk(2, 'ceci de la')], 'de la')), [2], 'a query of only stop words falls back to a plain « contains »')
assert.deepEqual(ids(rank(docs, '!!! ???')), [])
assert.deepEqual(ids(rank([{ content: null }, { content: undefined }, { id: 9 }, mk(1, 'ok test')], 'test')), [1], 'a memory without text never throws')
ok('stop words, punctuation-only and broken memories are handled')

console.log('what it cannot do, said plainly')
assert.deepEqual(ids(rank([mk(1, 'Aime sa voiture électrique')], 'bagnole')), [], 'synonyms without shared letters are NOT found: that is search by meaning')
assert.deepEqual(ids(rank([mk(1, 'Déteste les réunions du lundi')], 'monday meetings')), [], 'FR ↔ EN is not found either')
ok('synonyms and cross-language are not found (that is what the embedding model is for)')

console.log('speed')
const big = Array.from({ length: 2000 }, (_, i) => mk(i, ['Prefers short answers in French', 'Utilise pnpm pour les installs', 'Never commit .env files', 'Works on macOS with zsh', 'Squash-merge feature branches'][i % 5] + ' (' + i + ')'))
const t0 = performance.now()
for (let i = 0; i < 20; i++) rank(big, 'short answers french')
const per = (performance.now() - t0) / 20
assert.ok(per < 60, 'one query over 2000 memories took ' + per.toFixed(1) + ' ms')
ok('2000 memories: ' + per.toFixed(1) + ' ms per query')

console.log('\n' + pass + ' verifications OK')
