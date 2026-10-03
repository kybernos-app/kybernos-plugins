// [KB-TECHNIQUE] renderer MiniApp « technique » — visite 3D d'une machine.
//
// POURQUOI CE FICHIER EST HORS DE client.js : three.js pèse 670 Ko et ce
// renderer ~20 Ko. Les inliner dans `kybernos-plugin/client.js` (1,4 Mo, fichier
// CHAUD servi à chaud) ferait écrire le fichier chaud pour rien, et la veille de
// bundle remplacerait la révision au premier hoquet. Ici : un fichier STATIQUE,
// servi par une route de l'hôte, importé dynamiquement à la première ouverture
// d'une miniapp `technique`.
//
// CONTRAT (voir skills/artifact-technique/SKILL.md) :
//   { kind:'technique', renderer:'technique', title, summary,
//     parts:[{ id, label, role, shape, at, rot, color, metalness, roughness,
//              explode, shell, motion }],
//     steps:[{ part, caption, ms, zoom, explode, cutaway }] }
// Tout ce qui s'AFFICHE est en anglais (demande de l'utilisateur).

import * as THREE from './vendor/three.module.min.js'

const VERSION = 1
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }

/** Le style voyage AVEC le renderer : il n'est chargé que si une miniapp
 *  `technique` s'ouvre, et client.js n'a pas à connaître une seule de ces
 *  classes. Tous les textes visibles sont en anglais. */
const CSS = `
.kbtq-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:420px;border-radius:12px;overflow:hidden;background:#12161b;color:#e8edf3;font:inherit}
.kbtq-stage{position:relative;flex:1;min-height:260px}
.kbtq-canvas{display:block;width:100%;height:100%;cursor:grab;touch-action:none}
.kbtq-canvas:active{cursor:grabbing}
.kbtq-hud{position:absolute;inset:12px 12px auto 12px;display:flex;gap:12px;align-items:flex-start;pointer-events:none}
.kbtq-caption{pointer-events:auto;max-width:min(52%,420px);background:rgba(10,14,19,.72);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:10px 12px}
.kbtq-stepidx{display:block;font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#8fa3b8}
.kbtq-label{margin:3px 0 4px;font-size:14.5px;font-weight:650;color:#fff}
.kbtq-role{margin:0;font-size:12px;line-height:1.45;color:#c6d2de}
.kbtq-legend{pointer-events:auto;margin-left:auto;width:min(240px,38%);max-height:calc(100% - 4px);overflow:auto;background:rgba(10,14,19,.72);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.10);border-radius:10px;padding:8px}
.kbtq-legend-head{font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:#8fa3b8;padding:2px 4px 6px}
.kbtq-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.kbtq-item{display:flex;gap:8px;align-items:baseline;padding:4px 6px;border-radius:7px;cursor:pointer;font-size:11.5px;color:#aebbc8;opacity:.72}
.kbtq-item:hover{background:rgba(255,255,255,.06);opacity:1}
.kbtq-item.actif{background:rgba(74,144,226,.20);color:#fff;opacity:1}
.kbtq-n{flex:none;width:16px;font-size:9.5px;color:#7f8fa0;font-variant-numeric:tabular-nums}
.kbtq-item.actif .kbtq-n{color:#8fc0ff}
.kbtq-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid rgba(255,255,255,.08);background:rgba(8,11,15,.92)}
.kbtq-btn{width:26px;height:26px;border:1px solid rgba(255,255,255,.14);background:transparent;color:#e8edf3;border-radius:7px;cursor:pointer;font-size:13px;line-height:1}
.kbtq-btn:hover{background:rgba(255,255,255,.08)}
.kbtq-play{width:32px;height:32px;background:rgba(74,144,226,.22);border-color:rgba(122,176,255,.45)}
.kbtq-tg{border:1px solid rgba(255,255,255,.14);background:transparent;color:#c6d2de;border-radius:7px;padding:4px 9px;font:inherit;font-size:11px;cursor:pointer}
.kbtq-tg:hover{background:rgba(255,255,255,.08)}
.kbtq-tg.on{background:rgba(74,144,226,.26);border-color:rgba(122,176,255,.5);color:#fff}
.kbtq-sep{flex:1}
.kbtq-hint{font-size:10.5px;color:#7f8fa0}
.kbtq-err{padding:14px;font-size:12.5px;color:#ffb4b4}
/* Conteneur étroit (carte sidebar, vue MiniApp ~500px) : le HUD doit tenir
   DANS le conteneur — le @media(max-width) ci-dessous teste la FENÊTRE, qui
   reste large dans DSH, il ne suffit donc pas. La classe .kbtq-etroit est
   posée par le ResizeObserver. */
.kbtq-etroit .kbtq-caption{max-width:min(58%,290px)}
.kbtq-etroit .kbtq-label{font-size:13px}
.kbtq-etroit .kbtq-role{font-size:11px}
.kbtq-etroit .kbtq-legend{width:min(158px,42%);padding:6px}
.kbtq-etroit .kbtq-item{font-size:10.5px}
@media (max-width:560px){.kbtq-hud{flex-direction:column}.kbtq-legend{width:100%;margin-left:0;max-height:170px}.kbtq-caption{max-width:none}}
`

/* ── une forme déclarée → une géométrie three ─────────────────────────────── */
function geometrie (s) {
  const t = String((s && s.type) || 'box')
  if (t === 'cylinder') return new THREE.CylinderGeometry(num(s.r, 1), num(s.r, 1), num(s.h, 1), int(s.segments, 40), 1, s.open === true)
  if (t === 'cone') return new THREE.ConeGeometry(num(s.r, 1), num(s.h, 1), int(s.segments, 32))
  if (t === 'sphere') return new THREE.SphereGeometry(num(s.r, 1), int(s.segments, 28), int(s.segments, 20))
  if (t === 'torus') return new THREE.TorusGeometry(num(s.r, 1), num(s.tube, 0.2), int(s.tubeSegments, 16), int(s.segments, 48))
  return new THREE.BoxGeometry(num(s.w, 1), num(s.h, 1), num(s.d, 1))
}

/** Un axe « x » pour un cylindre : three les construit le long de Y. */
function axe (nom) {
  if (nom === 'x') return [0, 0, -Math.PI / 2]
  if (nom === 'z') return [Math.PI / 2, 0, 0]
  return [0, 0, 0]
}

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)
const int = (v, d) => Math.max(3, Math.round(num(v, d)))
const vec = (v, d) => new THREE.Vector3(
  num(Array.isArray(v) ? v[0] : undefined, d[0]),
  num(Array.isArray(v) ? v[1] : undefined, d[1]),
  num(Array.isArray(v) ? v[2] : undefined, d[2]))

/* ── la scène ─────────────────────────────────────────────────────────────── */
function monter (conteneur, artefact) {
  const A = artefact !== null && typeof artefact === 'object' ? artefact : {}
  const parts = Array.isArray(A.parts) ? A.parts : []
  const steps = Array.isArray(A.steps) ? A.steps : []
  const bg = typeof A.background === 'string' ? A.background : '#12161b'

  const racine = document.createElement('div')
  racine.className = 'kbtq-root'
  racine.setAttribute('data-kb', 'technique')
  racine.setAttribute('data-version', String(VERSION))
  if (document.getElementById('kbtq-styles') === null) {
    const style = document.createElement('style')
    style.id = 'kbtq-styles'
    style.textContent = CSS
    document.head.appendChild(style)
  }
  racine.innerHTML = `
    <div class="kbtq-stage"><canvas class="kbtq-canvas"></canvas></div>
    <div class="kbtq-hud">
      <div class="kbtq-caption" data-kb="technique-caption">
        <span class="kbtq-stepidx"></span>
        <h3 class="kbtq-label"></h3>
        <p class="kbtq-role"></p>
      </div>
      <div class="kbtq-legend">
        <div class="kbtq-legend-head">Components</div>
        <ol class="kbtq-list"></ol>
      </div>
    </div>
    <div class="kbtq-bar">
      <button type="button" class="kbtq-btn" data-act="prev" title="Previous component">‹</button>
      <button type="button" class="kbtq-btn kbtq-play" data-act="play" title="Play / pause">⏸</button>
      <button type="button" class="kbtq-btn" data-act="next" title="Next component">›</button>
      <span class="kbtq-sep"></span>
      <button type="button" class="kbtq-tg" data-act="explode" title="Exploded view">Exploded</button>
      <button type="button" class="kbtq-tg" data-act="cutaway" title="Cutaway (shells transparent)">Cutaway</button>
      <button type="button" class="kbtq-tg" data-act="spin" title="Auto-rotate">Spin</button>
      <button type="button" class="kbtq-tg" data-act="home" title="Reset the camera">Reset</button>
      <span class="kbtq-hint">drag to orbit · wheel to zoom</span>
    </div>`
  conteneur.appendChild(racine)

  const canvas = racine.querySelector('.kbtq-canvas')
  const stage = racine.querySelector('.kbtq-stage')
  const elLabel = racine.querySelector('.kbtq-label')
  const elRole = racine.querySelector('.kbtq-role')
  const elIdx = racine.querySelector('.kbtq-stepidx')
  const elList = racine.querySelector('.kbtq-list')
  const elPlay = racine.querySelector('.kbtq-play')

  const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bg)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400)
  const groupe = new THREE.Group()
  scene.add(groupe)

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1b2026, 0.85))
  const clef = new THREE.DirectionalLight(0xffffff, 2.1)
  clef.position.set(14, 22, 16)
  clef.castShadow = true
  clef.shadow.mapSize.set(1024, 1024)
  const ombre = clef.shadow.camera
  ombre.left = -30; ombre.right = 30; ombre.top = 30; ombre.bottom = -30; ombre.far = 90
  scene.add(clef)
  const remplissage = new THREE.DirectionalLight(0x9fc3ff, 0.55)
  remplissage.position.set(-18, 10, -14)
  scene.add(remplissage)

  /* ── les pièces ─────────────────────────────────────────────────────────── */
  // Une PIÈCE peut avoir plusieurs EXEMPLAIRES (`repeat`) : 4 pistons, 8
  // soupapes… Une seule entrée de légende, un seul surlignage, une seule étape
  // de visite — sinon la liste des composants devient un inventaire.
  const meshes = new Map()
  const toutes = []
  const boite = new THREE.Box3()
  for (const p of parts) {
    if (p === null || typeof p !== 'object' || typeof p.id !== 'string') continue
    const geo = geometrie(p.shape)
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(typeof p.color === 'string' ? p.color : '#9aa3ad'),
      metalness: num(p.metalness, 0.45),
      roughness: num(p.roughness, 0.45),
      transparent: p.shell === true,
      opacity: p.shell === true ? 0.28 : 1,
      emissive: new THREE.Color(0x000000),
      side: p.shape && p.shape.open === true ? THREE.DoubleSide : THREE.FrontSide,
      depthWrite: p.shell === true ? false : true,
    })
    const [rx, ry, rz] = axe(p.shape && p.shape.axis)
    const placements = emplacements(p.repeat)
    const base = vec(p.at, [0, 0, 0])
    const motion = p.motion && typeof p.motion === 'object' ? p.motion : null
    const pasPhase = num(motion && motion.phaseStep, 0)
    // `repeat.phases` : la phase de CHAQUE exemplaire, en demi-tours — un
    // vilebrequin 0°/180°/180°/0° ne s'exprime pas avec un pas linéaire.
    const phases = p.repeat !== null && typeof p.repeat === 'object' && Array.isArray(p.repeat.phases) ? p.repeat.phases : null
    const liste = []
    for (let i = 0; i < placements.length; i++) {
      const mesh = new THREE.Mesh(geo, i === 0 ? mat : mat.clone())
      mesh.rotation.set(rx + rad(p.rot, 0), ry + rad(p.rot, 1), rz + rad(p.rot, 2))
      mesh.position.copy(base).add(placements[i])
      mesh.castShadow = p.shell !== true
      mesh.receiveShadow = true
      mesh.userData.part = p
      mesh.userData.repeatIndex = i
      mesh.userData.base = mesh.position.clone()
      mesh.userData.baseRot = mesh.rotation.clone()
      mesh.userData.explode = vec(p.explode, [0, 0, 0])
      mesh.userData.motion = motion
      mesh.userData.phase = phases !== null ? num(phases[i], 0) : num(motion && motion.phase, 0) + pasPhase * i
      mesh.userData.shell = p.shell === true
      groupe.add(mesh)
      liste.push(mesh)
      toutes.push(mesh)
      boite.expandByObject(mesh)
    }
    meshes.set(p.id, liste)
  }
  const centre = boite.isEmpty() ? new THREE.Vector3() : boite.getCenter(new THREE.Vector3())
  const taille = boite.isEmpty() ? 20 : boite.getSize(new THREE.Vector3()).length()
  const distanceBase = Math.max(18, taille * 1.25)

  // sol discret sous la machine : donne l'échelle et reçoit l'ombre
  const sol = new THREE.Mesh(
    new THREE.CircleGeometry(distanceBase * 1.6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1b2129, roughness: 1, metalness: 0 }))
  sol.position.set(centre.x, boite.min.y - 0.05, centre.z)
  sol.receiveShadow = true
  scene.add(sol)

  /* ── caméra orbitale (pas d'OrbitControls à vendoriser pour si peu) ─────── */
  const cam = { cible: centre.clone(), vise: centre.clone(), theta: 0.9, phi: 1.05, rayon: distanceBase, viseRayon: distanceBase, spin: false }
  const borneRayon = (r) => Math.max(distanceBase * 0.22, Math.min(distanceBase * 2.6, r))
  function placerCamera () {
    const r = cam.rayon
    camera.position.set(
      cam.cible.x + r * Math.sin(cam.phi) * Math.cos(cam.theta),
      cam.cible.y + r * Math.cos(cam.phi),
      cam.cible.z + r * Math.sin(cam.phi) * Math.sin(cam.theta))
    camera.lookAt(cam.cible)
  }

  /* ── la visite guidée ──────────────────────────────────────────────────── */
  const etat = { etape: -1, enLecture: true, explose: false, coupe: false, tempsEtape: 0, horloge: 0 }
  const dureeEtape = (s) => Math.max(1500, num(s && s.ms, 4200))

  const lignes = parts.filter((p) => meshes.has(p.id)).map((p, i) => {
    const li = document.createElement('li')
    li.className = 'kbtq-item'
    li.setAttribute('data-part', p.id)
    li.innerHTML = `<span class="kbtq-n">${i + 1}</span><span class="kbtq-t">${echappe(p.label || p.id)}</span>`
    li.addEventListener('click', () => { allerA(etapeDe(p.id)) })
    elList.appendChild(li)
    return li
  })

  function etapeDe (id) {
    for (let i = 0; i < steps.length; i++) if (steps[i] && steps[i].part === id) return i
    return -1
  }

  // Les pièces NON sélectionnées passent en fantôme : une coque translucide
  // (chemise, bloc) posée sur la pièce étudiée donne une bouillie illisible —
  // l'image doit montrer LA pièce, le reste ne sert que de repère.
  function majOpacites () {
    const s = steps[etat.etape] || null
    const active = s !== null ? s.part : null
    for (const [id, liste] of meshes) {
      const part = parts.find((x) => x.id === id) || {}
      const voile = active !== null && id !== active
      for (const m of liste) {
        let op = part.shell === true ? (etat.coupe ? 0.12 : 0.28) : 1
        if (voile) op = part.shell === true ? 0.1 : 0.22
        m.material.transparent = op < 1
        m.material.opacity = op
        m.material.depthWrite = op >= 1
      }
    }
  }

  function appliquerEtape () {
    const s = steps[etat.etape] || null
    const p = s !== null ? parts.find((x) => x.id === s.part) : null
    const liste = p !== null && meshes.has(p.id) ? meshes.get(p.id) : null
    for (const li of lignes) li.classList.toggle('actif', p !== null && li.getAttribute('data-part') === p.id)
    for (const [id, groupe2] of meshes) {
      const actif = p !== null && id === p.id
      for (const m of groupe2) m.material.emissive.setHex(actif ? 0x2a4560 : 0x000000)
    }
    majOpacites()
    racine.setAttribute('data-etape', String(etat.etape))
    racine.setAttribute('data-part', p !== null ? p.id : '')
    elIdx.textContent = steps.length > 0 ? `Step ${Math.max(1, etat.etape + 1)} / ${steps.length}` : ''
    elLabel.textContent = p !== null ? String(p.label || p.id) : String(A.title || '')
    elRole.textContent = String((s !== null && s.caption) || (p !== null && p.role) || A.summary || '')
    if (liste !== null && liste.length > 0) {
      const zoom = num(s !== null ? s.zoom : undefined, 1)
      const centrePiece = new THREE.Vector3()
      for (const m of liste) centrePiece.add(m.userData.base)
      centrePiece.divideScalar(liste.length)
      if (etat.explose) centrePiece.add(liste[0].userData.explode)
      cam.vise.copy(centrePiece)
      // La pièce doit tenir DANS le cadre : une visée serrée qui laisse sortir
      // la moitié de la pièce lit comme un écran cassé. On borne donc le zoom
      // par la sphère englobante du composant (marge 12 %).
      let rayonPiece = 0
      for (const m of liste) {
        m.geometry.computeBoundingSphere()
        rayonPiece = Math.max(rayonPiece, m.position.distanceTo(centrePiece) + m.geometry.boundingSphere.radius)
      }
      const demiAngle = Math.min(
        (camera.fov * Math.PI) / 360,
        Math.atan(Math.tan((camera.fov * Math.PI) / 360) * Math.max(0.3, camera.aspect)))
      const distanceAjustee = (rayonPiece * 1.12) / Math.max(0.05, Math.sin(demiAngle))
      cam.viseRayon = borneRayon(Math.max(distanceBase / Math.max(0.4, zoom), distanceAjustee))
      etat.coupe = s !== null && s.cutaway === true ? true : etat.coupe
    } else {
      cam.vise.copy(centre); cam.viseRayon = distanceBase
    }
    etat.tempsEtape = 0
  }

  function allerA (i) {
    if (steps.length === 0) return
    etat.etape = (i + steps.length) % steps.length
    appliquerEtape()
  }

  /* ── animation : le mouvement des pièces + la caméra ───────────────────── */
  const frac = (v) => v - Math.floor(v)
  /** Le plan d'orbite autour d'un axe : deux directions orthonormées. */
  function planOrbite (axeMot) {
    if (axeMot === AXES.x) return [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
    if (axeMot === AXES.y) return [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)]
    return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)]
  }
  function animerPiece (mesh, t) {
    const m = mesh.userData.motion
    mesh.position.copy(mesh.userData.base)
    mesh.rotation.copy(mesh.userData.baseRot)
    mesh.scale.setScalar(1)
    if (etat.explose) mesh.position.add(mesh.userData.explode)
    if (m === null) return
    const vitesse = num(m.speed, 1)
    const phase = num(mesh.userData.phase, 0)
    const axeMot = AXES[String(m.axis || 'y')] || AXES.y
    if (m.type === 'spin') {
      mesh.rotateOnAxis(axeMot, t * vitesse)
    } else if (m.type === 'stroke') {
      mesh.position.add(axeMot.clone().multiplyScalar(Math.sin(t * vitesse * Math.PI + phase * Math.PI) * num(m.amplitude, 1)))
    } else if (m.type === 'pivot') {
      const pivot = vec(m.joint, [0, 0, 0])
      mesh.position.sub(pivot).applyAxisAngle(axeMot, Math.sin(t * vitesse * Math.PI + phase * Math.PI) * num(m.amplitude, 0.25)).add(pivot)
    } else if (m.type === 'crank') {
      // Vrai train bielle-manivelle : le maneton tourne (r), le piston glisse
      // sur y tel que y = r·cos θ + √(L² − r²·sin²θ) — bielle ET piston restent
      // liés. `phase` (demi-tours) = calage du maneton ; `repeat.phases` donne
      // l'ordre du vilebrequin (inline-4 : 0, 1, 1, 0).
      const r = Math.max(0.05, num(m.radius, 1))
      const L = Math.max(r * 1.2, num(m.rod, r * 2.8))
      const role = String(m.role || 'piston')
      const th = t * vitesse * Math.PI + phase * Math.PI
      const ct = Math.cos(th), st = Math.sin(th)
      const [u, v] = planOrbite(axeMot)
      if (role === 'pin') {
        mesh.position.add(u.clone().multiplyScalar(r * ct)).add(v.clone().multiplyScalar(r * st))
        mesh.rotateOnAxis(axeMot, th)
      } else if (role === 'web') {
        mesh.position.add(u.clone().multiplyScalar(r * 0.5 * ct)).add(v.clone().multiplyScalar(r * 0.5 * st))
        mesh.rotateOnAxis(axeMot, th)
      } else {
        const portee = Math.sqrt(Math.max(0.0001, L * L - r * r * st * st))
        mesh.position.add(u.clone().multiplyScalar(r * ct + portee - (r + L)))
        if (role === 'rod') {
          // La bielle pivote autour du maneton : Δu du MILIEU = (r·ct + portée/2)
          // − (r + L/2), Δv = r·st/2 — son gros bout suit exactement le maneton
          // (preuve cinématique dans scripts/preuve-technique.py).
          mesh.position.add(u.clone().multiplyScalar(L / 2 - portee / 2)).add(v.clone().multiplyScalar(r * st / 2))
          mesh.rotateOnAxis(axeMot, Math.atan2(-r * st, portee))
        }
      }
    } else if (m.type === 'bump') {
      // Fenêtre de came : une ouverture par cycle (pic à θ = π/2), durée ~240° de
      // vilebrequin par défaut (cos² sur ±`width` radians de came).
      const demiLargeur = Math.max(0.15, num(m.width, 1.047))
      let d = t * vitesse * Math.PI + phase * Math.PI - Math.PI / 2
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2
      const g = Math.abs(d) < demiLargeur ? Math.cos((Math.PI / 2) * (d / demiLargeur)) : 0
      mesh.position.add(axeMot.clone().multiplyScalar(-g * g * num(m.amplitude, 0.4)))
    } else if (m.type === 'flash') {
      // Étincelle : un pic court par cycle de 4 temps (θ = π/2), exprimé en
      // échelle — la bougie s'allume à son PMH de compression, jamais au PMH d'échappement.
      const c = Math.max(0, Math.cos(t * vitesse * Math.PI + phase * Math.PI - Math.PI / 2))
      mesh.scale.setScalar(0.3 + 3 * Math.pow(c, 16))
    }
  }

  let raf = 0
  let dernier = performance.now()
  function boucle (maintenant) {
    raf = requestAnimationFrame(boucle)
    const dt = Math.min(0.05, (maintenant - dernier) / 1000)
    dernier = maintenant
    etat.horloge += dt
    if (cam.spin) cam.theta += dt * 0.35
    if (etat.enLecture && steps.length > 0) {
      etat.tempsEtape += dt * 1000
      if (etat.tempsEtape > dureeEtape(steps[etat.etape])) allerA(etat.etape + 1)
    }
    for (const mesh of toutes) animerPiece(mesh, etat.horloge)
    cam.cible.lerp(cam.vise, 1 - Math.pow(0.0015, dt))
    cam.rayon += (cam.viseRayon - cam.rayon) * (1 - Math.pow(0.002, dt))
    placerCamera()
    renderer.render(scene, camera)
  }

  /* ── redimensionnement + interactions ─────────────────────────────────── */
  function redimensionner () {
    const w = Math.max(80, stage.clientWidth)
    const h = Math.max(120, stage.clientHeight)
    racine.classList.toggle('kbtq-etroit', w < 640)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(redimensionner) : null
  if (ro !== null) ro.observe(stage)

  const glisse = { actif: false, x: 0, y: 0 }
  canvas.addEventListener('pointerdown', (e) => { glisse.actif = true; glisse.x = e.clientX; glisse.y = e.clientY; canvas.setPointerCapture(e.pointerId) })
  canvas.addEventListener('pointerup', () => { glisse.actif = false })
  canvas.addEventListener('pointercancel', () => { glisse.actif = false })
  canvas.addEventListener('pointermove', (e) => {
    if (!glisse.actif) return
    cam.theta -= (e.clientX - glisse.x) * 0.008
    cam.phi = Math.max(0.25, Math.min(Math.PI * 0.86, cam.phi - (e.clientY - glisse.y) * 0.006))
    glisse.x = e.clientX; glisse.y = e.clientY
    cam.viseRayon = cam.rayon
  })
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    cam.viseRayon = borneRayon(cam.viseRayon * (e.deltaY > 0 ? 1.08 : 0.92))
  }, { passive: false })

  racine.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]')
    if (b === null) return
    const act = b.getAttribute('data-act')
    if (act === 'next') { etat.enLecture = false; majPlay(); allerA(etat.etape + 1) }
    else if (act === 'prev') { etat.enLecture = false; majPlay(); allerA(etat.etape - 1) }
    else if (act === 'play') { etat.enLecture = !etat.enLecture; majPlay() }
    else if (act === 'explode') { etat.explose = !etat.explose; b.classList.toggle('on', etat.explose); appliquerEtape() }
    else if (act === 'cutaway') {
      etat.coupe = !etat.coupe
      b.classList.toggle('on', etat.coupe)
      majOpacites()
    } else if (act === 'spin') { cam.spin = !cam.spin; b.classList.toggle('on', cam.spin) }
    else if (act === 'home') { cam.theta = 0.9; cam.phi = 1.05; cam.viseRayon = distanceBase; cam.vise.copy(centre) }
  })

  function majPlay () { elPlay.textContent = etat.enLecture ? '⏸' : '▶' }

  redimensionner()
  if (steps.length > 0) allerA(0)
  else { appliquerEtape(); cam.vise.copy(centre); cam.viseRayon = distanceBase }
  majPlay()
  raf = requestAnimationFrame(boucle)

  window.__KB_TECHNIQUE__ = {
    version: VERSION,
    parts: parts.length,
    steps: steps.length,
    racine: racine,
    // Positions animées par composant (pour la preuve cinématique) :
    // id → [[x,y,z], …] au dernier rendu.
    positions () {
      const out = {}
      for (const [id, liste] of meshes) out[id] = liste.map((m) => [Number(m.position.x.toFixed(4)), Number(m.position.y.toFixed(4)), Number(m.position.z.toFixed(4))])
      return out
    },
    // Échelles animées (preuve de l'étincelle) : id → [échelle, …].
    scales () {
      const out = {}
      for (const [id, liste] of meshes) out[id] = liste.map((m) => Number(m.scale.x.toFixed(3)))
      return out
    },
  }

  return {
    demonter () {
      cancelAnimationFrame(raf)
      if (ro !== null) ro.disconnect()
      renderer.dispose()
      for (const mesh of toutes) { mesh.geometry.dispose(); mesh.material.dispose() }
      conteneur.removeChild(racine)
    },
  }
}

function rad (v, i) {
  const deg = num(Array.isArray(v) ? v[i] : undefined, 0)
  return (deg * Math.PI) / 180
}

/** Les décalages d'une pièce : `offsets` explicites, une ligne (`count`/`step`),
 *  ou un seul exemplaire. */
function emplacements (repeat) {
  const r = repeat !== null && typeof repeat === 'object' ? repeat : null
  if (r === null) return [new THREE.Vector3()]
  if (Array.isArray(r.offsets)) return r.offsets.map((o) => vec(o, [0, 0, 0]))
  const n = Math.max(1, Math.round(num(r.count, 1)))
  const pas = vec(r.step, [0, 0, 0])
  const out = []
  for (let i = 0; i < n; i++) out.push(pas.clone().multiplyScalar(i))
  return out
}

function echappe (s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

export { monter, VERSION }