#!/usr/bin/env node
// The checks a translated interface text goes through before it is kept (i18n-quality.mjs): each case is a way a model
// really gets a translation wrong, and the good answers that must NOT be refused.
//
//   node packages/kybernos-plugin/test-i18n-quality.mjs
import { PROTECTED_TERMS, explain, inspect, joinReasons, splitReasons, visibleText } from './i18n-quality.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const hard = (src, tr, lang) => inspect(src, tr, { lang }).hard
const soft = (src, tr, lang) => inspect(src, tr, { lang }).soft
const clean = (src, tr, lang) => { const r = inspect(src, tr, { lang }); return r.hard.length === 0 && r.soft.length === 0 }

console.log('good answers pass')
{
  check('a plain label', clean('Enregistrer', 'Guardar', 'es'))
  check('variables kept, in another order', clean('{count} fichiers dans {folder}', '{folder} contiene {count} archivos', 'es'))
  check('%s and %1$s', clean('Ouvrir %s (%d)', 'Abrir %s (%d)', 'de') && clean('%1$s a %2$s', '%1$s en %2$s', 'es'))
  check('tags and a link kept', clean('Lisez <b>ceci</b> sur https://kybernos.app/aide', 'Lee <b>esto</b> en https://kybernos.app/aide', 'es'))
  check('a markdown link keeps its address, the words change', clean('Voir [la documentation](https://kybernos.app/docs)', 'Ver [la documentación](https://kybernos.app/docs)', 'es'))
  check('inline code kept', clean('Lancez `dsh web` ici', 'Ejecuta `dsh web` aquí', 'es'))
  check('digits in another system are the same number', clean('3 fichiers, 12 dossiers', '٣ ملفات، ١٢ مجلدًا', 'ar'))
  check('a number written with another separator is the same number', clean('Jusqu’à 1 000 messages', 'Hasta 1.000 mensajes', 'es'))
  check('Arabic written in Arabic, with the product name kept', clean('Ouvrir Kybernos', 'افتح Kybernos', 'ar'))
  check('Chinese is short, and that is fine', clean('Réglages avancés du modèle de traduction', '翻译模型的高级设置', 'zh'))
  check('« OK », a year and an acronym come back as they went, and that is right', clean('OK', 'OK', 'es') && clean('2026', '2026', 'de') && clean('API', 'API', 'ru'))
}

console.log('hard failures: the text is not kept')
{
  check('a variable translated', hard('{count} fichiers', '{compte} archivos', 'es').includes('placeholder'))
  check('a variable dropped', hard('Bonjour {name}', 'Hola', 'es').includes('placeholder'))
  check('a variable added', hard('Bonjour', 'Hola {name}', 'es').includes('placeholder'))
  check('%s lost', hard('Ouvrir %s', 'Abrir', 'es').includes('placeholder'))
  check('a tag lost', hard('Lisez <b>ceci</b>', 'Lee esto', 'es').includes('tags'))
  check('a tag altered', hard('<a href="x">Lien</a>', '<a href="y">Enlace</a>', 'es').includes('tags'))
  check('a link address changed', hard('Voir https://kybernos.app/docs', 'Ver https://kybernos.app/doc', 'es').includes('url'))
  check('a markdown address changed', hard('[Aide](https://a.b/c)', '[Ayuda](https://a.b/d)', 'es').includes('url'))
  check('code altered', hard('Lancez `dsh web`', 'Ejecuta `dsh servidor`', 'es').includes('code'))
  check('a number changed', hard('Maximum 40 messages', 'Máximo 4 mensajes', 'es').includes('numbers'))
  check('a model\'s own sentence', hard('Enregistrer', 'Here is the translation: Guardar', 'es').includes('meta') && hard('Enregistrer', 'Voici la traduction : Guardar', 'es').includes('meta'))
  check('a code fence', hard('Enregistrer', '```\nGuardar\n```', 'es').includes('meta'))
  check('a refusal', hard('Enregistrer', 'As an AI language model I cannot translate this', 'es').includes('meta'))
  check('a sentence that is itself « here is… » in the source is not a model remark', !hard('Here is the result', 'Aquí está el resultado', 'es').includes('meta'))
  check('Arabic answered in French', hard('Ouvrir les réglages avancés du modèle', 'Ouvrir les réglages avancés du modèle', 'ar').includes('script'))
  check('Russian answered in Latin letters', hard('Ouvrir les réglages avancés', 'Otkryt rasshirennye nastroyki', 'ru').includes('script'))
  check('a long text cut to a word', hard('Cette action supprime définitivement la langue et ses traductions.', 'Eliminar', 'es').includes('length'))
  check('a short label padded with an essay', hard('Annuler la sélection', 'Cancelar la selección actual y volver al estado anterior de la lista con todos los elementos', 'es').includes('length'))
  check('an empty answer', hard('Enregistrer', '   ', 'es').includes('empty'))
  check('several reasons at once are all listed', (() => { const h = hard('{n} fichiers sur https://a.b', 'Here is: archivos', 'es'); return h.includes('placeholder') && h.includes('url') && h.includes('meta') })())
}

console.log('soft: kept, and listed for a second look')
{
  check('a sentence left as it was is flagged, not refused', (() => { const r = inspect('Cette action est définitive.', 'Cette action est définitive.', { lang: 'es' }); return r.hard.length === 0 && r.soft.includes('unchanged') })())
  check('a lone short word the same in both languages is not flagged', soft('OK', 'OK', 'es').length === 0 && soft('Menu', 'Menu', 'de').length === 0)
  check('French as a target is never « unchanged » (the source is French)', soft('Enregistrer le document', 'Enregistrer le document', 'fr').length === 0)
  check('a product name that vanished is flagged', soft('Ouvrir Kybernos', 'Abrir', 'es').includes('glossary:Kybernos'))
  check('…and one that stayed is not', !soft('Ouvrir Kybernos', 'Abrir Kybernos', 'es').includes('glossary:Kybernos'))
  check('a protected word inside another word does not count', soft('Les APIs publiques', 'Las interfaces públicas', 'es').length === 0)
  check('hard failures hide the soft ones (one reason at a time is enough to retry)', inspect('{n} Kybernos', 'hola', { lang: 'es' }).soft.length === 0)
}

console.log('the pieces')
{
  check('what a person reads: variables, tags, addresses and code taken out', visibleText('Ouvrez <b>{name}</b> : https://a.b/c et `x`') === 'Ouvrez : et')
  check('reasons are explained to the model in a sentence', /variable/.test(explain(['placeholder'])) && /script/.test(explain(['script'])))
  check('reasons travel as a short string and back', JSON.stringify(splitReasons(joinReasons(['placeholder', 'url']))) === JSON.stringify(['placeholder', 'url']))
  check('the protected terms are product names and formats, not words', PROTECTED_TERMS.includes('Kybernos') && PROTECTED_TERMS.includes('DSH') && !PROTECTED_TERMS.includes('Menu'))
  check('the region of a language is ignored (pt-BR is pt, zh-TW is zh)', hard('Ouvrir les réglages avancés du modèle', 'Ouvrir les réglages avancés du modèle', 'zh-TW').includes('script'))
  check('a language this table does not know is read as Latin', hard('Ouvrir les réglages avancés', 'Buka pengaturan lanjutan', 'id').length === 0)
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
