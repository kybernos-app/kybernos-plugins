// emails.js — transactional emails: rendered here, delivered by ONE adapter (swap it for
// Resend/Postmark in the emails batch; SPF/DKIM/DMARC live with the provider). POC mode: the
// adapter appends to logs/emails.log. Sending is at most once per payment event — the webhook's
// idempotency (003) makes the call unreachable on a replay.
const fs = require('node:fs')
const path = require('node:path')

const euro = (cents) => (cents / 100).toFixed(2) + ' €'

const rendreConfirmation = (commande, lignes) => {
  const lignesTexte = lignes.map((l) => l.quantite + ' x ' + l.produit + ' — ' + euro(l.prix_cents * l.quantite)).join('\n')
  const total = euro(commande.total_cents)
  return {
    sujet: 'Commande #' + commande.id + ' confirmée',
    html: '<div style="font-family:system-ui;line-height:1.5"><h1>Merci pour votre commande</h1><p>Commande #' + commande.id + ' — payée.</p><pre>' + lignesTexte + '</pre><p><strong>Total : ' + total + '</strong></p></div>',
    texte: 'Merci pour votre commande.\nCommande #' + commande.id + ' — payée.\n' + lignesTexte + '\nTotal : ' + total,
  }
}

const rendreExpedition = (commande, suivi) => ({
  sujet: 'Commande #' + commande.id + ' expédiée',
  html: '<div style="font-family:system-ui"><h1>Votre commande est en route</h1><p>Suivi : ' + String(suivi || 'à venir') + '</p></div>',
  texte: 'Votre commande #' + commande.id + ' est en route. Suivi : ' + String(suivi || 'à venir'),
})

/** The provider adapter — the only place that talks to the outside. */
const envoyer = (destinataire, message) => {
  try {
    fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true })
    fs.appendFileSync(path.join(__dirname, 'logs', 'emails.log'), JSON.stringify({ le: new Date().toISOString(), a: destinataire, sujet: message.sujet }) + '\n')
    return { ok: true, mode: 'poc-log' }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}

exports.rendreConfirmation = rendreConfirmation
exports.rendreExpedition = rendreExpedition
exports.envoyer = envoyer
