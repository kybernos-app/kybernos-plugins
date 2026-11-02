# Template E2B « kybernos-dsh » — microVM embarquant un agent DSH connecté
# au proxy Kybernos (compte du client). L'outil computer_task y lance
# `dsh headless "<mission>"` : l'agent tourne DANS la VM, les appels LLM
# partent sur la clé KYBERNOS_API_KEY injectée au démarrage de la sandbox.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git ripgrep less procps \
    && rm -rf /var/lib/apt/lists/*

# DSH épinglé sur la version du moteur du poste (0.2.0-rc.2). Installation
# LOCALE + symlink : le `npm install -g` du builder E2B produit un arbre cassé
# (mesuré : 540 paquets « ajoutés » mais bin.js absent — MODULE_NOT_FOUND) ;
# l'install locale, elle, pose l'arbre complet. La vérification fait échouer
# le build si le lanceur ne démarre pas.
RUN mkdir -p /opt/dsh && cd /opt/dsh \
    && npm init -y >/dev/null \
    && npm install @deepseek-ai/dsh@0.2.0-rc.2 \
         --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs \
         --no-audit --no-fund \
    && node /opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js --version \
    && ln -sf /opt/dsh/node_modules/.bin/dsh /usr/local/bin/dsh \
    && dsh --version

# Profile headless minimal pré-câblé vers le proxy Kybernos :
# la route provider kybernos + le choix du modèle par défaut. Le secret
# (KYBERNOS_API_KEY) n'est JAMAIS dans l'image — il est injecté par envs
# à la création de la sandbox.
# E2B exécute les commandes en utilisateur « user » (home /home/user) :
# les réglages vivent dans SON home, pas dans /root (mesuré : Permission denied).
RUN mkdir -p /home/user/.dsh && chown -R user:user /home/user/.dsh
COPY --chown=user:user settings.yaml /home/user/.dsh/settings.yaml
COPY --chown=user:user agent-patch.yml /home/user/agent-patch.yml

WORKDIR /home/user
