import base64, json, glob, os, time, urllib.request, random
k = [l.split('=',1)[1].strip().strip('"') for l in open('/Users/miled/dyad-apps/kybernos-server/.env.keys') if l.startswith('ZAI_CODING_PLAN_API_KEY')][0]
D = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/captures/'
S = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/vision-resultats.json'
out = json.load(open(S)) if os.path.exists(S) else {}
files = sorted(glob.glob(D + '*.png'))
prompt = ("Capture d'écran d'une app de recette. Rends en FR, très compact: "
          "PAGE=<titre du panneau/page ouvert> ; ELEM=<max 8 éléments visibles, verbatim> ; "
          "DEFAUTS=<max 3: texte tronqué, chevauchement, contraste illisible, incohérence visuelle — 'aucun' si rien> ; "
          "INCERT=<ce que tu ne lis pas>")
# order: unseen first, most important panels first
prio = ['v0-accueil.png','v0-dashboards.png','v0-dashboards-dark.png','v0-skills.png','v0-connectors.png',
        'v0-automations.png','v0-workspaces.png','v0-creations.png','v0-agent-teams.png','v0-account-team.png']
files = [f for n in prio for f in files if os.path.basename(f) == n] + \
        [f for f in files if os.path.basename(f) not in prio]
done = 0
for f in files:
    name = os.path.basename(f)
    if out.get(name) and not out[name].startswith('ERREUR'):
        continue
    ok = False
    for attempt in range(12):
        try:
            img = base64.b64encode(open(f,'rb').read()).decode()
            req = urllib.request.Request('https://api.z.ai/api/paas/v4/chat/completions',
              data=json.dumps({'model':'glm-5.3-flash','messages':[{'role':'user','content':[
                {'type':'text','text':prompt},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+img}}]}]}).encode(),
              headers={'Authorization':'Bearer '+k,'Content-Type':'application/json'})
            r = json.load(urllib.request.urlopen(req, timeout=180))
            out[name] = r['choices'][0]['message']['content'][:600]
            json.dump(out, open(S,'w'), indent=1, ensure_ascii=False)
            print('OK', name, flush=True)
            ok = True; done += 1
            time.sleep(20 + random.randint(0,10))
            break
        except Exception as e:
            msg = str(e)[:60]
            print('retry', name, msg, flush=True)
            time.sleep(60 + attempt*15)
    if not ok:
        out[name] = 'ERREUR: quota'
        json.dump(out, open(S,'w'), indent=1, ensure_ascii=False)
print('TERMINE', sum(1 for v in out.values() if not str(v).startswith('ERREUR')), '/', len(files), flush=True)
