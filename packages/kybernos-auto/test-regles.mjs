// The routing rules: which class a request falls in before any model is asked. The rules used to need French words and accents:
// "generate a video of a cat", "draw an image of a lighthouse" and "write a python function" all went to a chat model (the
// first rule, `vi[ée]deo`, matched neither "vidéo" nor "video").
//   node packages/kybernos-auto/test-regles.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classerParRegles, router } from './index.js'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const classe = (t) => classerParRegles(t) ?? 'chat'

const CASES = {
  media: [
    'génère une vidéo de chat', 'genere une video de chat', 'GÉNÈRE UNE VIDÉO DE CHAT', 'generate a video of a cat', 'make me a video about our launch',
    'draw an image of a lighthouse', "dessine-moi une image de phare", 'Génère une image pour la page', 'create an icon for the app',
    'mets des sous-titres', 'add subtitles to the clip', 'text to speech for this paragraph', 'fais un doublage en anglais',
  ],
  vision: [
    "décris cette image", 'describe this image', "regarde l'écran", 'regarde l’écran', "capture d'écran du bug", 'what is in this screenshot',
    'lis ce png', 'look at the screenshot and tell me what is wrong', 'inspecte la capture',
  ],
  code: [
    'write a python function to reverse a string', 'écris une fonction en python qui inverse une chaîne', 'fix the bug in my javascript code',
    'refactor this module', 'corrige le bug', 'test unitaire du composant', 'migration de la base', 'add pagination to the list',
    'debug this stack trace', 'write a script that renames the files', 'implement the endpoint',
    // code first: asking for code that makes an image is still code
    'write a python function that generates an image', 'écris une fonction qui génère une image',
  ],
  design: [
    "refonds la maquette de la page d'accueil", 'design a landing page', 'site web de kybernos.app', 'make a mockup of the settings page', 'revue UI de la sidebar',
  ],
  chat: [
    'analyse la stratégie de prix', 'explain how photosynthesis works', 'quelle heure est-il à Tokyo ?', 'résume cet article', 'what is the capital of Peru',
    'translate this sentence into Spanish', 'donne-moi trois idées de nom pour le produit', 'help me write an email to my landlord',
  ],
}
for (const [attendu, demandes] of Object.entries(CASES)) {
  console.log(attendu)
  for (const d of demandes) check(JSON.stringify(d) + ' → ' + attendu, classe(d) === attendu, 'got ' + classe(d))
}

console.log('the shape of the input')
check('null, undefined and a number do not throw and fall to chat', [null, undefined, 42, {}].every((v) => classe(v) === 'chat'))
check('an empty request falls to chat', classe('') === 'chat' && classe('   ') === 'chat')
check('upper case and accents are one word', classe('CRÉE UNE ILLUSTRATION') === 'media' && classe('cree une illustration') === 'media')

console.log('no classifier set (the default of the settings)')
{
  // T1-15: the page used to say « Default: local tev1 ». The setting is empty by default and then the classifier is never called: the rules decide
  // and a request they do not recognise is routed as chat. (An unreachable Ollama address proves it: a call would make `via` say the classifier failed.)
  const reglages = { whitelist: ['deepseek-official/deepseek-chat'], classifier: '', global: true }
  const r = await router('quelle heure est-il à Tokyo ?', { reglages, ollama: 'http://127.0.0.1:1' })
  check('a request no rule recognises is routed as chat, by the rules, with no classifier call', r.classe === 'chat' && r.via === 'regle', r)
  const c = await router('corrige le bug', { reglages, ollama: 'http://127.0.0.1:1' })
  check('a request a rule recognises keeps its class', c.classe === 'code' && c.via === 'regle', c)
}

console.log('the source')
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.js'), 'utf8')
check('the accent-stripping range is written as an escape, not as invisible combining characters (some tools turn it into raw ones)',
  /\[\\u0300-\\u036f\]/.test(source) && !source.includes('\u0300'))
const clientSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
check('T1-15: the Classifier row of the page names no default model (the setting is empty by default), in both languages',
  !/Défaut : tev1|Default: local tev1/.test(clientSource) && clientSource.includes('Vide par défaut : les règles décident') && clientSource.includes('Empty by default: the rules decide'))

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
