"""A guess at the language of a short text, with no dependency.

A call in "auto" speaks every reply in the language the reply is written in. The speech-to-text does not always
say which language it heard (measured 2026-10-08: the field came back empty), and the voice must still match the
words: an English voice reading French is unintelligible. So the text itself decides.

Two signals, both cheap: the writing system when it is not Latin (Arabic, Cyrillic, kana, hangul, han...), and for
Latin text the very common words of each language, each word weighing less the more languages share it. "" means
"not sure": the caller keeps what it already knew.
"""

from __future__ import annotations

import re

# The writing systems that name their language by themselves. Kana first: Japanese text also holds han characters.
_SCRIPTS = (
    (re.compile(r"[぀-ヿ]"), "ja"),
    (re.compile(r"[가-힯]"), "ko"),
    (re.compile(r"[一-鿿]"), "zh"),
    (re.compile(r"[؀-ۿ]"), "ar"),
    (re.compile(r"[֐-׿]"), "he"),
    (re.compile(r"[Ѐ-ӿ]"), "ru"),
    (re.compile(r"[ऀ-ॿ]"), "hi"),
    (re.compile(r"[Ͱ-Ͽ]"), "el"),
    (re.compile(r"[฀-๿]"), "th"),
)

_WORDS = {
    "fr": "le la les un une des du de et est que qui pas pour dans ce cette il elle je tu nous vous ils elles sont avec "
          "sur plus mais ou au aux en y a ne se ça oui non bien merci bonjour très être avoir fait faire peut tout "
          "comme j t l d qu c n s m suis es êtes ai as ont va vais voici alors donc aussi encore cela ces mon ma mes "
          "ton ta tes son sa ses votre vos notre nos accord voilà salut allô allo entends entend peux veux veut dois sais vois "
          "sûr bonsoir désolé",
    "en": "the and is are was were to of in it that this for with you i he she we they not have has be do does on at by "
          "an or but yes no hello thanks what can will just from your my as so if there here would could should "
          "about which their been am its our me him her them these those how why when who",
    "es": "el la los las un una unos unas y es son que de en por para con no si pero como más muy esto esta ese yo tú "
          "usted nosotros hola gracias bien está están estoy qué cómo aquí también ahora puedo puede hay del al se "
          "lo le mi su sus",
    "de": "der die das ein eine und ist sind nicht ich du er sie wir ihr mit für auf von zu den dem des im ja nein "
          "bitte danke hallo auch aber wie was kann habe haben wird werden sehr noch nur oder wenn dass hier",
    "it": "il lo la gli le un una e è sono che di in per con non si ma come più molto questo questa io tu noi voi ciao "
          "grazie bene sì anche del della dei nel questo sto sei ho hai ha cosa perché qui ora posso può c' l' d'",
    "pt": "o a os as um uma e é são que de em por para com não sim mas como mais muito isto esta eu tu você nós olá "
          "obrigado obrigada bem também está estou posso pode aqui agora do da dos das no na nos nas meu minha seu "
          "sua tem tenho",
    "nl": "de het een en is zijn dat dit niet ik jij hij zij wij jullie met voor op van te in ja nee ook maar hoe wat "
          "hallo dank goed kan heb heeft wordt zeer nog alleen of als dat hier",
    "tr": "ve bir bu şu için ile de da ben sen o biz siz evet hayır merhaba teşekkür çok iyi ama gibi değil var yok "
          "ne nasıl burada şimdi",
}

# Letters that only some languages use: a little weight each, capped.
_LETTERS = (
    (re.compile(r"[çœêèàùûîô]"), "fr", 0.4),
    (re.compile(r"[ñ¿¡]"), "es", 0.8),
    (re.compile(r"[ßäöü]"), "de", 0.5),
    (re.compile(r"[ãõ]"), "pt", 0.8),
    (re.compile(r"[ışğ]"), "tr", 0.8),
)

_TOKEN = re.compile(r"[^\W\d_]+")

_WEIGHT: dict[str, dict[str, float]] = {}
for _lang, _text in _WORDS.items():
    for _word in set(_text.split()):
        _WEIGHT.setdefault(_word.replace("'", ""), {})[_lang] = 1.0
for _word, _langs in _WEIGHT.items():
    for _lang in _langs:
        _langs[_lang] = 1.0 / len(_langs)


def guess_language(text: object) -> str:
    """The two-letter language of `text`, or "" when it cannot tell (too short, mixed, no letters)."""
    if not isinstance(text, str) or not text.strip():
        return ""
    for pattern, language in _SCRIPTS:
        if pattern.search(text):
            return language
    lowered = text.lower()
    score: dict[str, float] = {}
    for token in _TOKEN.findall(lowered):
        for language, weight in _WEIGHT.get(token, {}).items():
            score[language] = score.get(language, 0.0) + weight
    for pattern, language, weight in _LETTERS:
        found = len(pattern.findall(lowered))
        if found:
            score[language] = score.get(language, 0.0) + min(found * weight, 1.6)
    if not score:
        return ""
    ranked = sorted(score.items(), key=lambda kv: kv[1], reverse=True)
    best_language, best = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    if best < 1.0 or best < second * 1.3:
        return ""
    return best_language
