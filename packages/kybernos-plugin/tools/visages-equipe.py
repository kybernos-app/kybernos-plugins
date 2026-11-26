#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Découpe une planche « deux sections » en image d'équipe + un portrait par personne.

Contrat : un seul argument, une chaîne JSON sur argv.

    python3 visages-equipe.py '{"src":"…/planche.png","workDir":"/tmp/…",
                               "prefix":"dev-team","count":5}'

Entrée : la planche produite par le modèle image — section 1 (haut) = la scène
d'équipe, section 2 (bas) = `count` cases, une personne par case (une rangée
jusqu'à 5 personnes, deux rangées au-delà : c'est ce que demande le prompt).

Sortie (stdout, JSON uniquement) :
    {"ok":true,"scene":"…","separator":503,"faces":[{…}],"avatars":[{…}],
     "warnings":["…"]}

Deux règles apprises sur les planches RÉELLES (23/09/2026) :

1. Le séparateur se trouve seul : ligne la plus claire et la plus uniforme de la
   bande centrale (blanc pur, écart-type 0). Sinon partage fixe à 52 %, signalé.
2. La découpe suit LA GRILLE annoncée (rangées × colonnes) et la détection de
   visage ne sert qu'à cadrer À L'INTÉRIEUR de chaque case. La version
   « pilotée par les visages » a été essayée puis rejetée : sur une planche à
   deux rangées, un faux positif de 259 px a produit un collage de quatre
   visages à la place d'un portrait. Une case = une personne, toujours.

La taille des visages cherchés est bornée par la case (12 % à 85 % de son petit
côté) : c'est ce qui écarte les faux positifs larges. cv2 est optionnel — sans
lui, on découpe au centre de chaque case et `faces` reste vide.
"""
import json
import math
import os
import sys

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover - dépendance machine
    print(json.dumps({"ok": False, "error": "Pillow absent: " + str(exc)}))
    sys.exit(1)

try:
    import cv2
    import numpy as np
except Exception:
    cv2 = None
    np = None

FACE_W = 1.55    # largeur de la découpe, en largeurs de visage
FACE_H = 2.15    # hauteur de la découpe, en hauteurs de visage
FACE_TOP = 0.42  # part de la hauteur du visage placée au-dessus de la découpe
AVATAR_PX = 512  # largeur de l'avatar écrit
RANGEE_MAX = 5   # une seule rangée jusqu'à 5 personnes


def echoue(message):
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(1)


def trouver_separateur(gris, hauteur):
    """Ligne la plus claire et la plus uniforme de la bande centrale."""
    if np is None:
        return int(hauteur * 0.52), "numpy absent : partage fixe à 52 %"
    a = np.asarray(gris, dtype=np.float32)
    debut, fin = int(hauteur * 0.25), int(hauteur * 0.80)
    meilleur, score_max = None, None
    for y in range(debut, fin):
        ligne = a[y]
        score = float(ligne.mean()) - 1.5 * float(ligne.std())
        if score_max is None or score > score_max:
            meilleur, score_max = y, score
    moyenne = float(a[meilleur].mean())
    if moyenne < 200.0:
        return int(hauteur * 0.52), ("séparateur introuvable (ligne la plus claire à %.0f) : "
                                     "partage fixe à 52 %%" % moyenne)
    return int(meilleur), None


def visage_de(case):
    """Le visage le plus proche du centre de la case, ou None.

    Bornes proportionnelles à la case : un « visage » plus grand que 85 % du
    petit côté est un motif, pas un visage (constaté : 259 px détecté dans une
    case de 260 px de haut — la découpe devenait un collage).
    """
    if cv2 is None or np is None:
        return None
    cw, ch = case.size
    petit = min(cw, ch)
    gris = cv2.cvtColor(np.asarray(case), cv2.COLOR_RGB2GRAY)
    casque = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades,
                                                "haarcascade_frontalface_default.xml"))
    mini = max(24, int(petit * 0.12))
    maxi = int(petit * 0.85)
    trouves = casque.detectMultiScale(gris, 1.08, 5, minSize=(mini, mini), maxSize=(maxi, maxi))
    if len(trouves) == 0:
        return None
    cx, cy = cw / 2.0, ch / 2.0

    def distance(f):
        return abs(f[0] + f[2] / 2.0 - cx) + abs(f[1] + f[3] / 2.0 - cy)
    return tuple(int(v) for v in min(trouves, key=distance))


def cadre(case, face):
    """Découpe buste autour d'un visage (coordonnées locales à la case)."""
    cw, ch = case.size
    x, y, w, h = face
    cw_dec = max(1, min(cw, int(w * FACE_W)))
    ch_dec = max(1, min(ch, int(h * FACE_H)))
    centre = x + w / 2.0
    g = int(max(0, min(cw - cw_dec, centre - cw_dec / 2.0)))
    t = int(max(0, min(ch - ch_dec, y - h * FACE_TOP)))
    return case.crop((g, t, g + cw_dec, t + ch_dec))


def normalise(découpe):
    if découpe.size[0] != AVATAR_PX:
        hh = max(1, int(round(AVATAR_PX * découpe.size[1] / float(découpe.size[0]))))
        découpe = découpe.resize((AVATAR_PX, hh), Image.LANCZOS)
    return découpe


def cases(bas, count):
    """Cases de la section 2 : mêmes rangées que celles demandées au modèle.

    Ligne 1 = RANGEE_MAX personnes (ou moins), lignes suivantes = le reste,
    réparti également sur la largeur — c'est la disposition que le modèle rend
    réellement (mesuré : 5 cases en haut, 4 en bas pour 9 personnes).
    """
    bw, bh = bas.size
    # Même règle que le prompt de l'hôte : une rangée jusqu'à 5, deux au-delà.
    rangees = 1 if count <= RANGEE_MAX else 2
    par_rangee = int(math.ceil(count / float(rangees)))
    out, reste = [], count
    for r in range(rangees):
        n = min(par_rangee, reste)
        reste -= n
        if n <= 0:
            break
        y0, y1 = int(r * bh / rangees), int((r + 1) * bh / rangees)
        for c in range(n):
            x0, x1 = int(c * bw / n), int((c + 1) * bw / n)
            out.append(bas.crop((x0, y0, x1, y1)))
    return out, rangees, par_rangee


def main():
    if len(sys.argv) < 2:
        echoue("config JSON manquante sur argv")
    try:
        cfg = json.loads(sys.argv[1])
    except Exception as exc:
        echoue("config JSON illisible: " + str(exc))
    src, work = cfg.get("src"), cfg.get("workDir")
    prefix = str(cfg.get("prefix") or "equipe")
    try:
        count = int(cfg.get("count"))
    except Exception:
        echoue("count invalide")
    if not src or not os.path.isfile(src):
        echoue("planche introuvable: " + str(src))
    if not work:
        echoue("workDir manquant")
    if cfg.get("single"):
        if count != 1:
            echoue("single veut count=1")
    elif count < 2 or count > 12:
        echoue("count hors bornes (2..12)")
    os.makedirs(work, exist_ok=True)

    # Portrait seul (option `single`) : l'image EST déjà le portrait — pas de
    # planche, pas de séparateur. On réutilise le MÊME cadrage que les cases de
    # la planche : détouré sur le visage s'il se trouve, centré sinon.
    if cfg.get("single"):
        img0 = Image.open(src).convert("RGB")
        face0 = visage_de(img0)
        if face0 is None:
            cw0, ch0 = img0.size
            cote0 = min(cw0, ch0)
            dec0 = img0.crop((int((cw0 - cote0) / 2), 0, int((cw0 + cote0) / 2), cote0))
        else:
            dec0 = cadre(img0, face0)
        dec0 = normalise(dec0)
        chemin0 = os.path.join(work, "%s-1.png" % prefix)
        dec0.save(chemin0)
        print(json.dumps({
            "ok": True, "scene": None, "separator": 0,
            "width": img0.size[0], "height": img0.size[1],
            "rows": 1, "perRow": 1,
            "faceDetector": cv2 is not None,
            "faces": ([{"index": 1, "x": face0[0], "y": face0[1],
                        "w": face0[2], "h": face0[3]}] if face0 else []),
            "avatars": [{"index": 1, "path": chemin0,
                         "w": dec0.size[0], "h": dec0.size[1],
                         "cadre": "visage" if face0 is not None else "case"}],
            "warnings": [] if face0 is not None else ["aucun visage détecté : découpe centrée"],
        }))
        return

    img = Image.open(src).convert("RGB")
    largeur, hauteur = img.size
    sep, avert = trouver_separateur(img.convert("L"), hauteur)
    avertissements = [avert] if avert else []

    scene_path = os.path.join(work, prefix + ".scene.png")
    img.crop((0, 0, largeur, sep)).save(scene_path)

    bas = img.crop((0, sep, largeur, hauteur))
    cells, rangees, par_rangee = cases(bas, count)
    if len(cells) != count:
        avertissements.append("%d case(s) pour %d personne(s)" % (len(cells), count))

    faces, avatars, sans_visage = [], [], 0
    for i, cell in enumerate(cells):
        face = visage_de(cell)
        if face is None:
            sans_visage += 1
            cw, ch = cell.size
            cote = min(cw, ch)
            découpe = cell.crop((int((cw - cote) / 2), 0, int((cw + cote) / 2), cote))
        else:
            découpe = cadre(cell, face)
            faces.append({"index": i + 1, "x": face[0], "y": face[1],
                          "w": face[2], "h": face[3]})
        découpe = normalise(découpe)
        chemin = os.path.join(work, "%s-%d.png" % (prefix, i + 1))
        découpe.save(chemin)
        avatars.append({"index": i + 1, "path": chemin,
                        "w": découpe.size[0], "h": découpe.size[1],
                        "cadre": "visage" if face is not None else "case"})

    if cv2 is not None and sans_visage > 0:
        avertissements.append("%d case(s) sans visage détecté (découpe centrée)" % sans_visage)
    if cv2 is None:
        avertissements.append("cv2 absent : découpe centrée, sans détection de visage")

    print(json.dumps({
        "ok": True,
        "scene": scene_path,
        "separator": sep,
        "width": largeur,
        "height": hauteur,
        "rows": rangees,
        "perRow": par_rangee,
        "faceDetector": cv2 is not None,
        "faces": faces,
        "avatars": avatars,
        "warnings": avertissements,
    }))


if __name__ == "__main__":
    main()
