import base64, json, glob, os, re, time, urllib.request
k = [l.split('=',1)[1].strip().strip('"') for l in open('/Users/miled/dyad-apps/kybernos-server/.env.keys') if l.startswith('ZAI_CODING_PLAN_API_KEY')][0]
D = '/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/captures/'
out = {}
files = sorted(glob.glob(D+'*.png'))
prompt = ("Capture d'écran d'une app de recette. Rends en FR, très compact: "
          "PAGE=<titre du panneau/page ouvert> ; ELEM=<max 8 éléments visibles, verbatim> ; "
          "DEFAUTS=<max 3: texte tronqué, chevauchement, contraste illisible, incohérence visuelle — 'aucun' si rien> ; "
          "INCERT=<ce que tu ne lis pas>")
for f in files:
    name = os.path.basename(f)
    for attempt in range(3):
        try:
            img = base64.b64encode(open(f,'rb').read()).decode()
            req = urllib.request.Request('https://api.z.ai/api/paas/v4/chat/completions',
              data=json.dumps({'model':'glm-5.3-flash','messages':[{'role':'user','content':[{'type':'text','text':prompt},{'type':'image_url','image_url':{'url':'data:image/png;base64,'+img}}]}]}).encode(),
              headers={'Authorization':'Bearer '+k,'Content-Type':'application/json'})
            r = json.load(urllib.request.urlopen(req, timeout=180))
            out[name] = r['choices'][0]['message']['content'][:600]
            print(f"OK {name}", flush=True)
            break
        except Exception as e:
            if attempt == 2: out[name] = f"ERREUR: {str(e)[:80]}"; print(f"ERR {name} {str(e)[:60]}", flush=True)
            time.sleep(8)
    time.sleep(2)
json.dump(out, open('/Users/miled/kybernos-plugins/campagne-recette-2026-10-19/vision-resultats.json','w'), indent=1, ensure_ascii=False)
print('TERMINE', len(out), '/', len(files))
