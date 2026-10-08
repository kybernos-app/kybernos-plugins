// ═══════════════════════════════════════════════════════
// kybernos-workers — client half: the Settings section "Workers".
//
// One ROW per external coding agent (Claude Code, Codex, Gemini, OpenCode, Qwen, Hermes,
// ZCode), the same columns on every row so the eye can scan them:
//   agent (logo, name, one line) · status · four step dots · ONE next action · details.
// The next action is the only button a person has to look for: Activate, Check, Install,
// Sign in, or — once the agent is ready — the "Allowed" switch.
//
// The detail of a row is a short checklist (turn on, install, sign in, check) that shows
// what to do for the first step that is not done: the command to copy, a key to paste, or
// "Install", which shows the exact command and where it comes from, asks for a confirmation
// and then runs it on the host. Signing in to an account stays the person's own job.
//
// Everything shown is VERIFIED by the host (connection mounted, package, binary, sign-in
// reported by the CLI or an API key in DSH's environment, write test in a throw-away git
// worktree) — never assumed. The one policy DSH exposes is here too: may the main agent
// hand tasks to this worker, and may it work in the background. Model, permissions and run
// duration stay the native product's, and the screen says so.
//
// "? How it works" is the shared help card of the Suite, with a button that opens the guide
// of this page: what a worker is, a clickable demo of the whole path, and the usual questions.
//
// Everything is wrapped in try/catch: this section is optional, never the reason a page
// fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-workers',
  factory: (require) => {
    const NAME = 'kybernos-workers'

    const lang = () => {
      try {
        const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
        const s = String(l || '')
        // French only when the resolved language IS French (the 'kybernos' default
        // or a fr base); every other language — translated (es…) or not — gets
        // English, never French.
        return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
      } catch (e) { return 'fr' }
    }
    const PACK_STRINGS = {} // fr → {fr, en} — collected at run time for the i18n pack
    const kt = (fr, en) => {
      if (PACK_STRINGS[fr] === undefined) PACK_STRINGS[fr] = { fr, en }
      return (lang() === 'fr' ? fr : en)
    }

    // ── logos ───────────────────────────────────────────────────────────────
    // Inline SVG symbols (no image file, no network request). The marks belong to their
    // owners and are only used to point at the agent. ZCode has no public mark: terminal glyph.
    const LOGOS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs><linearGradient id="kbwk-gm1" gradientUnits="userSpaceOnUse" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"/><stop offset="1" stop-color="#08B962" stop-opacity="0"/></linearGradient><linearGradient id="kbwk-gm2" gradientUnits="userSpaceOnUse" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"/><stop offset="1" stop-color="#F94543" stop-opacity="0"/></linearGradient><linearGradient id="kbwk-gm3" gradientUnits="userSpaceOnUse" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"/><stop offset=".46" stop-color="#FABC12" stop-opacity="0"/></linearGradient><linearGradient id="kbwk-qw" x1="0%" x2="100%" y1="0%" y2="0%"><stop offset="0%" stop-color="#6336E7" stop-opacity=".84"/><stop offset="100%" stop-color="#6F69F7" stop-opacity=".84"/></linearGradient><path id="kbwk-gem-d" d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z"/></defs><symbol id="kbwk-lg-claude" viewBox="0 0 24 24"><path fill="#D97757" fill-rule="evenodd" clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"/></symbol><symbol id="kbwk-lg-codex" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z"/></symbol><symbol id="kbwk-lg-gemini" viewBox="0 0 24 24"><use href="#kbwk-gem-d" fill="#3186FF"/><use href="#kbwk-gem-d" fill="url(#kbwk-gm1)"/><use href="#kbwk-gem-d" fill="url(#kbwk-gm2)"/><use href="#kbwk-gem-d" fill="url(#kbwk-gm3)"/></symbol><symbol id="kbwk-lg-opencode" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M16 6H8v12h8V6zm4 16H4V2h16v20z"/></symbol><symbol id="kbwk-lg-qwen" viewBox="0 0 24 24"><path fill="url(#kbwk-qw)" fill-rule="nonzero" d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z"/></symbol><symbol id="kbwk-lg-hermes" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M5.938 12.835c.127-.039.285.02.373.143.028.038.036.092.046.14.003.014-.02.033-.04.05-.124-.098-.24-.194-.354-.291-.011-.01-.016-.027-.025-.042zM8.396 9.412c.195-.032.39-.06.588-.05a.54.54 0 01.148.026c.202.071.402.147.601.224.028.01.05.036.075.055l-.013.027a9.203 9.203 0 01-.26-.089c-.115-.038-.213-.077-.315-.098-.25-.05-.25-.046-.292-.014l.574.144c.275.139.55.276.823.417.042.022.09.057.107.098.026.06.063.076.117.072.066-.006.132-.017.213-.027l-.04.086c.051.08.142.02.216.064-.074.13-.247.09-.334.199l.061.074-.12.087c0 .106-.038.168-.306.243l.026.085-.196.042.07.124h-.25l-.007.137c-.081-.01-.161-.018-.244-.027l-.053.123c-.027-.008-.052-.011-.073-.023-.067-.038-.128-.056-.195.006-.019.017-.063.014-.093.008-.026-.006-.05-.029-.07-.042-.11.095-.11.095-.208.003-.057.046-.12.074-.186.011-.063.027-.123-.02-.178-.014-.07.007-.097-.035-.133-.07l-.13.033c-.013-.236-.194-.19-.34-.203.005-.072.05-.092.095-.094a.474.474 0 01.159.022c.164.05.32.12.496.138.203.021.405.029.601-.015.265-.059.52-.149.707-.365.049-.056.083-.127.117-.195.019-.038.02-.084-.02-.116a1.397 1.397 0 00-.382-.217c.024.12-.031.182-.115.221 0 .014-.004.025 0 .03.08.115.084.16-.007.267a1.39 1.39 0 01-.218.211.477.477 0 01-.641-.05 1.36 1.36 0 01-.133-.152c-.078-.107-.076-.108-.033-.236-.165-.08-.128-.226-.104-.364.008-.05.028-.096.049-.163-.04.014-.067.017-.087.032a.897.897 0 00-.316.357c-.007.016-.01.034-.02.047-.012.015-.034.038-.045.035-.02-.006-.037-.027-.05-.045-.008-.012-.007-.032-.012-.057h-.126l.053-.172a14.82 14.82 0 00-.039-.049l.11-.284c-.06.026-.091.044-.124.051-.03.007-.064 0-.095 0 0-.031-.01-.07.004-.092.149-.22.305-.428.593-.476z"/><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.06 10.788c-.003-.038-.004-.075.037-.062.016.006.034.048.028.067-.01.04-.038.032-.064-.005z"/><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M11.981.009c.226-.012.453-.011.679 0 .247.01.495.024.74.062.401.064.798.157 1.19.273.463.138.92.299 1.356.511a7.31 7.31 0 012.948 2.642c.292.469.536.963.739 1.479.219.556.446 1.11.623 1.683.204.654.329 1.326.458 1.997.097.504.182 1.01.29 1.511.156.722.329 1.44.494 2.16.186.812.4 1.615.63 2.415.102.355.193.713.282 1.072.11.436.202.876.254 1.323.031.278.066.557.073.837a7.56 7.56 0 01-.017.88c-.037.413-.1.818-.226 1.212a5.017 5.017 0 01-.915 1.649l-.13.156.018.023c.043-.023.088-.041.127-.068.2-.138.373-.307.531-.49.4-.46.721-.973.975-1.529a3.59 3.59 0 00.325-1.72c-.024-.424-.097-.834-.3-1.213-.013-.027-.015-.06-.03-.121.05.035.082.048.101.072.107.13.22.258.315.398.33.494.46 1.052.486 1.64a3.75 3.75 0 01-.47 1.97c-.36.655-.887 1.14-1.526 1.506-.193.111-.394.21-.595.308-.157.078-.248.211-.318.365a.522.522 0 00-.033.406.359.359 0 01.013.139c-.005.077-.077.155-.14.162-.054.006-.125-.043-.15-.116a1.206 1.206 0 01-.06-.233c-.04-.314-.155-.6-.308-.87a3.906 3.906 0 00-.73-.91 2.129 2.129 0 00-.897-.524 4.093 4.093 0 00-.692-.131c-.075-.008-.15-.04-.22.01.18.06.363.11.538.18.434.173.82.43 1.18.728.308.255.58.543.794.884.098.155.186.315.227.496.027.123.042.25.067.375.013.062-.002.109-.053.144-.047.033-.122.034-.163-.01a.455.455 0 01-.08-.14c-.03-.073-.038-.159-.078-.225a7.314 7.314 0 00-1.423-1.664c-.16-.137-.329-.26-.537-.323-.376-.114-.753-.203-1.15-.154-.213.025-.427.032-.64.053a1.6 1.6 0 00-.736.278 5.14 5.14 0 00-.834.72c-.329.342-.642.699-.955 1.055-.136.155-.264.319-.314.531a5.227 5.227 0 00-.012.051.096.096 0 01-.09.076h-.31c-.046 0-.082-.048-.072-.094.023-.108.045-.216.07-.324.075-.325.19-.635.368-.917.024-.039.04-.088.104-.08l.01.049.027.077c.28-.435.571-.834.996-1.135.283-.204.584-.378.89-.55a.196.196 0 00-.098-.002c-.162.043-.325.084-.485.134-.402.124-.764.33-1.11.566-.147.1-.298.193-.414.333a7.314 7.314 0 00-1.07 1.767.845.845 0 00-.04.12.075.075 0 01-.072.056h-.494c-.04 0-.062-.051-.036-.082.123-.14.246-.282.377-.415.275-.281.58-.532.777-.884.027-.048.063-.09.095-.135.238-.333.54-.607.818-.902.082-.086.175-.16.26-.24.029-.027.053-.057.079-.085l-.018-.025-.135.041c-.034.017-.07.031-.102.05-.248.144-.494.292-.743.433-.408.23-.825.439-1.209.711-.281.2-.591.358-.889.533-.02.012-.044.015-.08.028-.015-.135.143-.201.108-.336-.033.014-.064.02-.085.038-.111.096-.227.19-.328.296-.148.157-.284.325-.425.488-.125.143-.25.286-.373.431A.153.153 0 019.89 24H8.762a.316.316 0 00.016-.042c.028-.09.085-.172.083-.28-.091-.018-.162.001-.212.077a4.45 4.45 0 00-.136.215c-.01.016-.024.03-.042.03h-.093c-.019 0-.029-.022-.017-.037.071-.088.14-.178.209-.268.001-.002-.006-.012-.012-.024-.014.004-.03.006-.045.013-.176.09-.352.181-.527.274a.363.363 0 01-.168.042H5.202c-.026 0-.039-.036-.019-.053.21-.178.402-.374.558-.605.335-.496.538-1.047.667-1.629.004-.02-.003-.043-.006-.091-.037.048-.059.072-.076.1a1.943 1.943 0 01-.334.415c-.28.258-.59.448-.983.464-.297.012-.588 0-.865-.127-.46-.21-.722-.57-.794-1.072-.025-.17-.017-.171-.182-.219A3.513 3.513 0 011.97 20.6a2.286 2.286 0 01-.808-1.13 3.569 3.569 0 01-.16-1.245c.002-.034.016-.067.024-.1.032.023.046.043.05.066.033.153.059.308.096.46.086.355.257.664.516.92.258.256.571.419.91.532.358.118.717.138 1.07-.016a1.89 1.89 0 00.621-.452c.328-.348.533-.76.648-1.223.009-.034.005-.071.007-.11-.015.006-.026.006-.03.011-.031.05-.064.1-.093.152-.284.502-.679.887-1.196 1.135-.351.17-.718.255-1.11.159a1.607 1.607 0 01-.971-.64 2.006 2.006 0 01-.368-.924 2.903 2.903 0 01.02-.886c.05-.439.466-1.17.742-1.271-.02.063-.035.112-.053.16-.043.116-.097.227-.13.345a1.901 1.901 0 00-.05.82c.033.212.09.416.204.6.147.236.346.407.62.465.11.023.225.014.338.018a.576.576 0 00.386-.131c.164-.128.282-.292.366-.481.168-.375.24-.777.309-1.179.05-.296.093-.594.133-.893.039-.281.071-.563.104-.845.026-.232.048-.464.074-.696.024-.228.052-.455.076-.683.024-.227.047-.455.069-.683.013-.14.022-.28.034-.42l.037-.417c.022-.25.041-.5.065-.748.008-.082-.02-.132-.09-.177a2.46 2.46 0 01-.492-.418c-.1-.109-.188-.228-.282-.342-.035-.042-.056-.097-.116-.118a2.084 2.084 0 00.275.597c.06.092.131.176.196.265.063.086.182.115.234.226-.028.003-.046.01-.06.006a4.74 4.74 0 01-.22-.057 2.71 2.71 0 01-1.287-.819c-.435-.487-.656-1.076-.71-1.723a5.206 5.206 0 01.014-1.06c.072-.602.22-1.186.45-1.745.155-.376.338-.741.526-1.102.205-.393.466-.75.765-1.076.512-.559 1.104-1.024 1.726-1.448.717-.49 1.478-.898 2.277-1.233C8.244.828 8.767.632 9.31.494c.655-.166 1.31-.33 1.982-.415.229-.03.458-.058.688-.07zm-1.847 22.82c-.07.06-.147.111-.207.18-.238.27-.464.549-.668.869l-.044.108a.177.177 0 00.093-.057c.174-.19.351-.378.519-.574.104-.122.195-.255.288-.386.024-.034.03-.08.046-.12l-.027-.02zm1.65-3.695a5.51 5.51 0 00-.653.593l-.37.386a.963.963 0 01-.377.25 1.372 1.372 0 01-.467.09c-.044 0-.087.006-.151.012.028.058.043.097.064.131.15.242.301.482.45.724.136.22.276.438.399.666.068.125.105.267.156.404.077.027.14-.018.202-.048.29-.135.579-.274.867-.412.213-.101.437-.186.636-.31.347-.215.68-.455 1.018-.685.015-.01.026-.028.042-.046-.023-.019-.038-.037-.056-.044-.287-.111-.527-.3-.77-.482a5.319 5.319 0 01-.506-.42 1.757 1.757 0 01-.41-.653c-.019-.049-.045-.095-.075-.156zm-5.847.264c-.06.096-.097.194-.132.293a3.38 3.38 0 01-.555 1.01c-.2.25-.455.412-.762.493-.23.06-.464.076-.7.07-.048-.002-.097.002-.158.005.016.04.021.066.035.085.1.145.23.246.4.295.157.046.316.034.498.023.181-.037.343-.115.485-.234.238-.199.402-.454.536-.732.175-.363.264-.751.342-1.144.01-.053.008-.11.011-.164zm14.945-4.586c.008.029.016.057.027.107.024.155.051.31.072.464.03.219.067.437.078.657.017.344.027.689-.014 1.033-.037.315-.063.633-.116.946a6.153 6.153 0 01-.46 1.518c-.008.018-.01.039-.02.082.047-.03.077-.042.098-.064.085-.083.17-.167.248-.255.271-.305.458-.66.596-1.043.18-.498.228-1.011.145-1.531-.103-.65-.33-1.263-.597-1.881a9.055 9.055 0 00-.024-.055l-.033.022zM5.797 8.29a.26.26 0 00.018.153c.124.251.25.501.379.75.025.049.066.09.03.163-.284.06-.578.119-.88.255.059.038.097.06.132.087.042.032.112.058.09.12-.01.033-.075.048-.117.072.017.01.043.021.067.036.166.102.33.207.447.368.138.192.229.404.188.644-.079.469-.306.85-.69 1.132-.054.04-.106.083-.161.122a.243.243 0 00-.103.245.77.77 0 00.055.195c.083.196.22.35.375.492.083.076.159.164.222.257a.37.37 0 01.025.377c-.023.05-.05.099-.076.148-.03.06-.028.111.022.162.041.042.08.089.112.138.038.058.078.079.147.05a.486.486 0 01.333-.006c.16.046.302.126.444.21.13.077.264.149.4.219.067.035.14.05.219.026.071-.022.124.01.145.076.02.064-.003.108-.074.139-.07.03-.137.063-.209.088-.1.035-.201.073-.314.077-.013-.107.11-.088.127-.159-.206-.126-.643-.145-.801-.034.063.112.035.21-.096.313-.13-.1-.025-.202.002-.3a.209.209 0 00-.249.17c-.015.101.067.216.178.224.108.007.218-.005.326-.012.06-.005.12-.027.199 0-.103.123-.248.127-.357.19.002.05.07.086.019.131-.053.048-.095-.001-.132-.03-.08-.063-.16-.126-.231-.197a.474.474 0 01-.157-.311.52.52 0 00-.043-.172c-.032-.074-.032-.137.033-.19-.018-.03-.028-.053-.045-.072a1.222 1.222 0 01-.196-.369c-.053-.137-.046-.264.048-.381.024-.03.05-.06.064-.095a.664.664 0 00.047-.168c.017-.165-.064-.287-.182-.387-.186-.156-.36-.322-.46-.551-.005-.011-.024-.017-.037-.026-.011.017-.024.027-.025.038-.019.185-.045.37-.052.557-.014.377.058.743.162 1.104.118.41.289.798.488 1.173.267.502.537 1.002.812 1.5.055.098.13.189.208.27.198.202.452.272.724.273.202 0 .404-.006.605-.026.295-.03.59-.073.884-.113.183-.025.365-.057.548-.08.21-.026.38.073.522.21.16.156.305.327.447.5.22.265.397.56.554.867.05.098.07.1.147.03.13-.121.26-.242.394-.36.067-.059.088-.12.067-.213a3.535 3.535 0 01-.085-.796c.002-.157.006-.314.018-.471.015-.224.03-.45.06-.672a59.114 59.114 0 01.362-2.298c.087-.493.182-.984.268-1.477.06-.347.118-.694.162-1.043.034-.273.055-.55.063-.825.011-.332.003-.665.002-.998 0-.077.004-.155-.01-.23-.028-.142-.01-.155-.162-.19a5.826 5.826 0 00-.607-.107c-.146-.018-.207-.053-.221-.19-.006-.049-.025-.098-.041-.146-.009-.025-.024-.048-.046-.09l-.025.264c-.009.096-.029.116-.127.115-.055 0-.11-.008-.164-.008-.476 0-.952-.008-1.426.032-.095.008-.173-.015-.226-.103-.04-.066-.088-.126-.134-.186-.063-.084-.086-.093-.182-.06-.195.068-.388.138-.582.21a2.71 2.71 0 00-.675.394.986.986 0 01-.323.168c-.033.01-.07.008-.127.013.02-.066.024-.114.047-.15.064-.105.135-.205.205-.306.023-.033.049-.063.073-.095l-.015-.023-.201.037c-.146.04-.296.07-.437.122-.148.053-.266.023-.386-.072a3.623 3.623 0 01-.733-.786l-.093-.132zm8.592 8.963l-.147.09c-.22.134-.44.266-.659.402-.093.058-.184.12-.27.188-.085.07-.124.161-.072.272.047.1.093.2.147.294.047.08.124.138.213.147.11.01.228.012.336-.012.217-.05.372-.205.528-.357a.291.291 0 00.087-.308c-.046-.18-.079-.365-.118-.547-.011-.052-.027-.103-.045-.169zm-.257-2.409c-.12.291-.205.597-.325.91-.151.433-.294.87-.435 1.323.036-.01.054-.01.067-.018.261-.16.522-.324.785-.484.054-.033.071-.078.065-.138-.012-.13-.024-.262-.034-.393l-.068-.886c-.008-.103-.02-.206-.029-.31-.009 0-.017-.002-.026-.004zm3.081-8.13l.099.285c.08.231.159.463.24.714l.58 1.952c.187.63.372 1.262.558 1.893.114.382.235.762.343 1.146.072.257.126.519.186.799.044.206.087.413.127.64.034.106.023.226.077.325l.025-.006-.068-.362c-.038-.206-.077-.412-.113-.638-.015-.07-.029-.141-.046-.211-.095-.396-.177-.796-.29-1.187-.196-.685-.413-1.364-.618-2.046-.165-.549-.322-1.1-.488-1.648-.069-.227-.15-.45-.226-.695l-.117-.336c-.037-.107-.075-.216-.115-.322-.04-.106-.084-.21-.127-.314a7.558 7.558 0 01-.027.01zM6.225 14.304c-.063-.001-.115.014-.134.083a.35.35 0 00.41.012 4.533 4.533 0 00-.276-.095zM5.23 11.98c-.026-.027-.057-.048-.075.002-.012.032-.007.07-.01.113.082-.037.082-.037.085-.115zm.062-1.189a.135.135 0 00-.088.056.197.197 0 00-.025.11c.005.152.01.306.026.457a.751.751 0 00.066.218c.061.136.157.167.288.101.055-.027.06-.054.025-.11a4.52 4.52 0 01-.129-.211c-.015-.068-.066-.131-.033-.207.04-.09-.076-.116-.074-.19V10.874c-.003-.038-.006-.087-.056-.083zm-.017-.968a.867.867 0 00-.467.127c-.076.045-.084.07-.05.158.034.087.07.173.115.254.064.117.09.125.21.077a.657.657 0 01.336-.053c.202.022.357.136.504.264l.092.077c.007-.006.014-.013.022-.018-.019-.105-.035-.226-.149-.264-.157-.053-.324-.075-.508-.117l-.24-.005c.24-.169.452-.044.687.009-.063-.115-.153-.147-.23-.193-.082-.05-.17-.092-.25-.144-.06-.037-.12-.08-.072-.172zm10.233.325c-.23-.01-.427.08-.608.211-.034.026-.06.065-.105.117.087.026.15.046.232.065.044-.015.088-.03.13-.046.306-.114.61-.115.904.031.126.063.237.04.366-.005-.02-.031-.03-.054-.045-.071a.986.986 0 00-.448-.273c-.14-.044-.284-.024-.426-.03zM7.99 6.483a.308.308 0 00.002.133c.08.321.156.643.242.962.104.387.27.75.456 1.103.02.037.061.08.098.087a.404.404 0 00.253-.051l-.472-.84c-.23-.448-.405-.92-.579-1.394zM10.397.497c-.2-.008-.405.004-.603.034-.236.035-.47.087-.7.152-.287.08-.569.18-.852.273-.04.013-.074.038-.11.058.028.014.05.018.07.014.287-.068.58-.085.873-.09.134-.002.269.009.402.025.19.024.382.048.57.09.456.104.874.3 1.265.556.464.306.888.66 1.257 1.078.205.232.395.475.56.739.17.274.315.561.449.856.273.601.456 1.232.6 1.876.04.173.07.348.1.524.017.104.065.167.17.19.122.028.2.105.22.251-.003.102-.06.174-.129.24a1.065 1.065 0 00-.268.358.164.164 0 00.083-.039c.08-.086.162-.172.235-.265a.56.56 0 00.13-.333c.009-.05.022-.1.024-.15.007-.124-.017-.15-.143-.168-.025-.004-.049-.014-.073-.015-.082-.007-.125-.063-.137-.131-.033-.198-.004-.355.247-.408.086-.018.174-.03.26-.042.158-.023.315-.053.473-.067.14-.012.19.033.226.167.008.029.018.057.021.087.019.179-.008.225-.141.288-.027.013-.055.024-.078.042a.148.148 0 00-.051.067c-.039.144.073.382.206.445l.673.32c.023.011.05.015.075.023l.018-.026c-.015-.008-.032-.013-.044-.024a2.27 2.27 0 00-.544-.32 4.898 4.898 0 00-.173-.075.203.203 0 01-.126-.191c-.003-.085.045-.154.128-.187l.059-.025c.099-.044.118-.076.112-.187a.384.384 0 00-.008-.063c-.067-.294-.123-.59-.205-.88a9.478 9.478 0 00-.826-2.036 7.465 7.465 0 00-1.39-1.805 4.536 4.536 0 00-1.177-.824 3.656 3.656 0 00-1.016-.328 6.155 6.155 0 00-.712-.074zm6.719 5.955c.01.014.018.028.038.034l-.022-.044-.016.01zM4.103 3.917a.062.062 0 01-.03.012.455.455 0 01-.04.039c-.01.01-.02.02-.045.04l-.363.354c-.088.085-.17.178-.266.253-.284.22-.425.53-.544.855a.132.132 0 00-.007.071c.013.055.033.108.052.168l.074.026c-.017.056-.03.105-.047.152-.058.164-.118.327-.175.491-.005.015.008.036.019.077.08-.175.158-.33.225-.489.228-.544.484-1.074.819-1.561.09-.133.182-.266.283-.401.004-.006.007-.013.022-.03.001-.016.003-.032.015-.04l.008-.017zm12.976 2.408a.023.023 0 01.009.019.073.073 0 00-.006.01.188.188 0 00.007.02l.018.022c.002-.007.007-.016.005-.021-.003-.01-.012-.018-.02-.038a1.331 1.331 0 01-.013-.012zM4.199 4.48c-.003.004-.008.008-.027.014-.005.013-.011.025-.031.047a2.085 2.085 0 01-.124.167c-.048.07-.116.055-.181.041-.134-.028-.228.016-.287.143-.089.187-.187.37-.273.56-.049.108-.11.216-.118.36.081.003.154.007.228.008h.228a2.563 2.563 0 01-.079.264c-.01.052-.022.103-.033.155l.02.004c.018-.046.037-.092.067-.153.066-.142.13-.285.2-.426.02-.04.034-.1.116-.092 0 .043.004.084 0 .124-.005.045-.017.09-.028.143.141.043.086.174.115.269.102-.022.104-.195.248-.144v.205l.017.002.439-1.059c-.13 0-.246-.02-.358.033-.024.011-.058-.001-.108-.004.075-.15.139-.278.211-.417a.128.128 0 01.025-.036c0-.015-.001-.03.008-.038l.006-.02c-.005.006-.01.011-.028.017-.004.012-.009.024-.026.045a.085.085 0 01-.032.033c-.123.157-.09.164-.258.106-.079-.027-.078-.028-.047-.144.028-.046.056-.093.098-.15 0-.016-.001-.032.007-.042L4.2 4.48zm2.073-.67c-.003.006-.007.011-.027.016-.094.125-.194.246-.28.377-.155.238-.301.481-.451.723-.14.224-.345.368-.575.481-.017.008-.04.006-.079.011.012-.059.016-.109.033-.153a6.076 6.076 0 01.229-.518l-.007-.02a.138.138 0 01-.035.025c-.028.05-.055.1-.093.164-.26.424-.443.817-.442.95.024.004.048.011.073.013.177.013.188.007.26-.165.03-.07.077-.12.147-.15l.175-.07c.044-.018.085-.057.146-.032.003.05-.01.11.014.145.042.062.044.125.047.193.002.049.017.098.026.147.029-.034.039-.065.05-.097.142-.39.277-.782.428-1.17.1-.256.22-.504.33-.756.013-.03.013-.067.03-.092V3.81zm3.987-.34c0 .045.01.084.021.123.042.16.094.318.124.48.024.133.023.27.028.406 0 .033-.019.067-.032.11-.094-.058-.047-.158-.106-.215h-.125c-.015.072-.01.152-.046.2-.066.085-.155.154-.236.227-.043.038-.078.018-.103-.025l-.046-.087c-.065.035-.117.069-.172.093-.116.051-.235.095-.35.147-.085.038-.09.053-.07.147.014.075.034.148.047.223.013.072.05.109.123.124.233.05.462.115.657.265.058-.102.058-.102.168-.151.03-.014.06-.03.092-.042.08-.03.115-.017.15.06.023.048.041.098.066.158.06-.14-.042-.267.017-.416.157.18.24.39.375.567a.235.235 0 00.022-.098c.002-.124 0-.247.002-.371 0-.034.013-.067.02-.1l.032-.003c.11.155.13.354.226.52a3.036 3.036 0 00-.01-.392c-.004-.045 0-.074.05-.088.08.036.116.14.215.158-.03-.275-.423-1.137-.798-1.635-.114-.127-.2-.28-.34-.386zm-2.667.696c-.019.034-.03.05-.037.067-.061.185-.125.37-.18.556-.031.105-.087.169-.195.19-.09.019-.178.052-.268.073-.038.009-.089.015-.118-.003-.024-.016-.025-.069-.036-.106-.064.076-.082.087-.17.047-.133-.062-.262-.135-.393-.201-.048-.025-.093-.063-.17-.03-.043.12-.091.25-.137.382-.099.28-.087.242.095.453.046.048.102.03.154.023.054-.009.106-.03.16-.036.13-.013.26-.08.367-.015.204-.064.387-.122.571-.178.05-.015.089.005.114.054.022.042.034.093.082.121.038-.056-.013-.128.063-.178l.14.241-.042-1.46zm.278.358c-.096-.01-.107.01-.11.108-.002.038-.003.078.002.115.03.2.099.386.174.57.002.006.012.01.022.015l.078-.05c.052.036.081.088.153.088.205-.002.41.014.616.012.099-.001.158.042.205.12.018.03.024.077.088.066l-.08-.394c-.05-.195-.085-.395-.172-.589-.057.057-.114.068-.18.046a.72.72 0 00-.135-.028c-.22-.028-.44-.059-.66-.08zm10.254-1.727c.089.163.155.316.139.491-.016.168.026.342-.044.516-.047-.033-.088-.082-.112-.075-.117.035-.164-.057-.227-.115a4.772 4.772 0 01-.286-.29l-.104-.113a4.856 4.856 0 01-.023.019c.035.046.07.093.11.156.04.064.084.127.122.193.034.058.065.118.031.205-.082-.01-.164-.019-.246-.032-.06-.01-.101 0-.124.07-.031.098-.037.096-.15.09.02.042.036.08.057.116.041.074.03.138-.03.196-.06.06-.118.122-.178.181a.175.175 0 01-.185.046c-.222-.061-.447-.113-.67-.174-.032-.009-.063-.04-.086-.068-.03-.04-.052-.087-.08-.13-.044-.07-.09-.138-.136-.207a.18.18 0 00-.014.105c.012.127.03.253.035.38.005.1-.024.12-.121.104-.104-.017-.206-.04-.31-.058-.064-.012-.131-.028-.202.03l.081.208c.09 0 .166-.01.237.002a.819.819 0 01.458.251c.078.083.154.168.241.26l.018-.005c-.004-.006-.008-.013-.01-.04.014-.056-.062-.118.018-.178.031.03.064.057.088.09.058.078.111.159.169.257l.089.141.024-.013a2093.819 2093.819 0 01-.427-.934c.055.007.083.007.108.016.193.07.385.142.577.216.074.028.147.06.219.094.062.028.112.018.157-.033.05-.056.102-.112.154-.167.05-.051.095-.046.132.014.016.025.026.053.04.08.071.138.143.277.217.433l.159.308.025-.011c-.044-.106-.07-.218-.138-.334-.057-.182-.168-.346-.206-.545.136.034.362.326.567.732l.057.074.018-.011a1.563 1.563 0 01-.052-.127c-.046-.145-.097-.29-.136-.436-.022-.083-.036-.173.022-.26l.109.058-.026-.207.027-.016c.022.02.05.036.065.06.073.108.143.22.215.33.01.016.029.029.043.043-.036-.217-.2-.38-.229-.626l.155.112c.014-.166.012-.319.042-.465.032-.158-.023-.297-.063-.445.024.004.036.006.055.025.092.124.183.249.277.371.02.027.05.047.069.087l.04.063.019-.015a.293.293 0 01-.053-.082 27.922 27.922 0 01-.332-.49c-.221-.311-.363-.467-.485-.521zm-6.57.327c-.003.161.092.275.069.415l-.368.087c.09.139.032.237-.052.331-.05.057-.092.122-.143.178-.037.04-.046.078-.018.126l.16.275c.029.048.072.066.128.064.076-.003.152 0 .228-.001.116-.003.216.022.275.137.006.014.02.024.044.052.004-.059-.003-.098.01-.13.016-.04.04-.099.072-.108.084-.023.173-.024.26-.03.013-.001.027.018.04.029l.071.065c.019-.11-.082-.198-.024-.31l.126.04c-.026-.123-.07-.245-.071-.366 0-.123.051-.243.115-.36.107.062.16.156.234.253.183.265.36.533.494.834.165-.078.27.068.407.088-.003-.106-.133-.441-.197-.492a.142.142 0 00-.102-.028c-.06.011-.119.039-.191.063-.025-.039-.056-.078-.077-.122a3.936 3.936 0 00-.473-.783c-.076-.094-.16-.182-.228-.26l-.391.285c-.049.035-.094.03-.132-.017l-.169-.207c-.025-.03-.053-.059-.097-.108z"/></symbol><symbol id="kbwk-lg-term" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M4 17l6-6-6-6M12 19h8"/></symbol></svg>'
    const LOGO_OF = { 'claude-code': 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode', qwen: 'qwen', hermes: 'hermes' }

    // ── pure data (tested without a browser) ────────────────────────────────
    // One word per row: [dot class, French, English].
    const STATUS = {
      inactive: ['', 'Pas activé', 'Not turned on'],
      unknown: ['', 'À vérifier', 'To check'],
      checking: ['warn busy', 'Vérification…', 'Checking…'],
      'binaire-absent': ['warn', 'À installer', 'To install'],
      'non-connecte': ['warn', 'À connecter', 'To connect'],
      'ecriture-impossible': ['bad', 'Pas d’écriture', 'Cannot write'],
      incomplet: ['warn', 'À confirmer', 'To confirm'],
      'a-relancer': ['warn', 'Redémarrez DSH', 'Restart DSH'],
      'serveur-absent': ['bad', 'Serveur introuvable', 'Server not found'],
      pret: ['ok', 'Prêt', 'Ready']
    }

    const control = (w, id) => (w.dernier != null && Array.isArray(w.dernier.controles) ? w.dernier.controles.find((c) => c.id === id) : undefined)

    /** Pure. The status key of a row, from what the host returned and whether a check is running. */
    const statusOf = (w, busy) => {
      if (w.connexion !== true) return 'inactive'
      if (busy === 'check') return 'checking'
      if (w.dernier != null && typeof w.dernier.statut === 'string') return w.dernier.statut === 'a-connecter' ? 'inactive' : w.dernier.statut
      return 'unknown'
    }

    /** Pure. The four dots: turned on · installed · signed in · verified. '' = not known yet. */
    const stepsOf = (w, busy) => {
      const mcp = w.genre === 'mcp'
      const dot = (c, unknownIsWarn) => (c === undefined ? '' : (c.etat === 'ok' ? 'ok' : (c.etat === 'ko' || unknownIsWarn ? 'warn' : '')))
      const auth = control(w, 'auth')
      return [
        w.connexion === true ? 'ok' : '',
        dot(control(w, mcp ? 'paquet' : 'binaire'), false),
        dot(auth, mcp),
        statusOf(w, busy) === 'pret' ? 'ok' : ''
      ]
    }

    /** Pure. What each evidence line says, from "<check>:<code>". */
    const CONTROLS = {
      'connexion:montee': ['Connexion montée dans le profil', 'Connection mounted in the profile'],
      'connexion:non-montee': ['Connexion absente du profil', 'Connection missing from the profile'],
      'paquet:installe': ['Paquet de connexion installé', 'Connection package installed'],
      'paquet:non-installe': ['Paquet de connexion non installé (relance de DSH nécessaire)', 'Connection package not installed (DSH restart needed)'],
      'paquet:serveur-present': ['Serveur MCP présent', 'MCP server present'],
      'paquet:serveur-absent': ['Serveur MCP introuvable', 'MCP server not found'],
      'binaire:trouve': ['Programme trouvé dans le PATH de DSH', 'Program found in DSH’s PATH'],
      'binaire:absent': ['Programme introuvable dans le PATH de DSH', 'Program not found in DSH’s PATH'],
      'auth:connecte': ['Connexion déclarée par la CLI', 'Sign-in reported by the CLI'],
      'auth:non-connecte': ['La CLI n’est pas connectée', 'The CLI is not signed in'],
      'auth:non-verifiable': ['Connexion non vérifiable', 'Sign-in could not be checked'],
      'auth:binaire-absent': ['Connexion non testée (programme absent)', 'Sign-in not tested (program missing)'],
      'auth:coffre-propre': ['Connexion gérée par l’application, non vérifiable ici', 'Sign-in handled by the app, not checkable here'],
      'worktree:ecriture-ok': ['Écriture dans un worktree git jetable', 'Write inside a throwaway git worktree'],
      'worktree:ecriture-ko': ['Écriture dans un worktree git impossible', 'Cannot write inside a git worktree']
    }
    const KEY_CONTROLS = {
      'auth:connecte': ['Clé API trouvée dans l’environnement de DSH', 'API key found in DSH’s environment'],
      'auth:non-connecte': ['Aucune clé API dans l’environnement de DSH', 'No API key in DSH’s environment']
    }
    const controlLabel = (c, w) => {
      const keyed = w != null && w.connect != null && w.connect.mode === 'key' ? KEY_CONTROLS[c.id + ':' + c.code] : undefined
      const t = keyed !== undefined ? keyed : CONTROLS[c.id + ':' + c.code]
      return t === undefined ? c.id + ' · ' + c.code : kt(t[0], t[1])
    }

    /** Pure. The current policy of a row (what is in the profile), to initialise the switches. */
    const currentPolicy = (w) => ({ expose: w.ligne != null ? w.ligne.expose === true : false, background: w.ligne != null ? w.ligne.arrierePlan === true : false })

    /** Pure. Who a worker is, in a few words (vendor · what it signs in with). */
    const IDENTITY = {
      'claude-code': [['Anthropic', 'Anthropic'], ['abonnement Claude', 'Claude subscription']],
      codex: [['OpenAI', 'OpenAI'], ['compte ChatGPT', 'ChatGPT account']],
      gemini: [['Google', 'Google'], ['clé API Google', 'Google API key']],
      opencode: [['Open source', 'Open source'], ['vos propres clés', 'your own keys']],
      qwen: [['Alibaba', 'Alibaba'], ['clé Token Plan', 'Token Plan key']],
      hermes: [['Nous Research', 'Nous Research'], ['compte Nous Portal', 'Nous Portal account']],
      zcode: [['Application ZCode', 'ZCode app'], ['connexion gérée par ZCode', 'sign-in handled by ZCode']]
    }
    const identityLine = (w) => {
      const i = IDENTITY[w.id]
      return i === undefined ? '' : kt(i[0][0], i[0][1]) + ' · ' + kt(i[1][0], i[1][1])
    }

    /** Pure. The one line under the name: it follows the status so the next step reads at a glance. */
    const sublineOf = (w, status) => {
      if (status === 'binaire-absent') return kt('Le programme n’est pas encore sur cet ordinateur.', 'The program is not on this computer yet.')
      if (status === 'non-connecte') {
        return w.connect != null && w.connect.mode === 'key'
          ? kt('Installé. Il manque votre clé API.', 'Installed. Your API key is missing.')
          : kt('Installé. Il reste à vous connecter à votre compte.', 'Installed. You still have to sign in to your account.')
      }
      if (status === 'incomplet' && w.genre === 'mcp') return kt('Connexion gérée par ZCode : seule une vraie tâche le prouve.', 'Sign-in handled by ZCode: only a real task proves it.')
      return identityLine(w)
    }

    /** Pure. Why an install job failed, in words. */
    const failureText = (job) => {
      if (job == null) return ''
      const log = (job.journal || []).join('\n')
      if (job.raison === 'timeout') return kt('L’installation a pris trop de temps et a été arrêtée.', 'The install took too long and was stopped.')
      if (/EACCES|permission denied/i.test(log)) return kt('Votre ordinateur a refusé l’écriture (droits). Utilisez la ligne Homebrew ou installez-le vous-même.', 'Your computer refused the write (permissions). Use the Homebrew line or install it yourself.')
      return kt('L’installateur s’est arrêté avec une erreur (code ' + String(job.code) + ').', 'The installer stopped with an error (code ' + String(job.code) + ').')
    }

    /** Pure. The answer of a refused route, in words. */
    const REFUSALS = {
      'package-missing': ['Ce connecteur n’est pas encore livré avec votre Suite : il arrivera dans une prochaine mise à jour.', 'This connector does not ship with your Suite yet: it will arrive in a coming update.'],
      'command-changed': ['La commande a changé depuis l’affichage : rechargez la page et recommencez.', 'The command changed since it was shown: reload the page and try again.'],
      busy: ['Une autre opération est en cours : réessayez dans un instant.', 'Another operation is running: try again in a moment.'],
      'already-installed': ['Déjà installé : DSH le revérifie.', 'Already installed: DSH is checking it again.'],
      'unsupported-platform': ['L’installation automatique n’existe que sur Mac et Linux pour l’instant.', 'Automatic install only exists on Mac and Linux for now.'],
      'install-unavailable': ['L’installation automatique n’est pas disponible : redémarrez DSH.', 'Automatic install is not available: restart DSH.'],
      'ligne-existante': ['Une ligne d’outil existe déjà dans votre profil et n’a pas été écrite ici : modifiez-la à la main.', 'A tool line already exists in your profile and was not written here: edit it by hand.'],
      'ligne-modifiee-a-la-main': ['La ligne a été modifiée à la main : je ne la réécris pas.', 'The line was edited by hand: I will not rewrite it.'],
      'connexion-absente': ['Activez d’abord l’agent.', 'Turn the agent on first.']
    }
    const refusalText = (r, prefixFr, prefixEn) => {
      const known = r != null && REFUSALS[r.error]
      if (known) return kt(known[0], known[1])
      if (r != null && r.error === 'missing-tool') {
        return r.tool === 'npm'
          ? kt('npm (fourni avec Node.js) n’est pas installé sur cet ordinateur. Installez Node.js depuis nodejs.org, ou utilisez Homebrew, puis réessayez.', 'npm (it comes with Node.js) is not installed on this computer. Install Node.js from nodejs.org, or use Homebrew, then try again.')
          : kt('Il manque « ' + String(r.tool) + ' » sur cet ordinateur.', '"' + String(r.tool) + '" is missing on this computer.')
      }
      return kt(prefixFr, prefixEn) + String(r != null && r.error ? r.error : '')
    }

    // ── the guide: what a worker is, and the demo path ──────────────────────
    const DEMO_COMMAND = 'curl -fsSL https://claude.ai/install.sh | bash'

    const lireJson = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    const post = (path, body) => fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then((r) => r.json().catch(() => ({ ok: false, error: 'bad-response' }))).catch(() => ({ ok: false, error: 'network' }))
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    const copyText = (text, button) => {
      const done = () => { try { const old = button.textContent; button.textContent = kt('Copié ✓', 'Copied ✓'); setTimeout(() => { button.textContent = old }, 1500) } catch (e) { /* the button is gone */ } }
      const fallback = () => {
        try {
          const area = document.createElement('textarea')
          area.value = text; area.style.position = 'fixed'; area.style.opacity = '0'
          document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); done()
        } catch (e) { /* the command stays selectable on the page */ }
      }
      try { navigator.clipboard.writeText(text).then(done, fallback) } catch (e) { fallback() }
    }

    const CSS = [
      '.kbwk{display:flex;flex-direction:column;gap:14px;max-width:980px;font-size:13.5px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
      '.kbwk button,.kbwk input{font:inherit}',
      '.kbwk button{cursor:pointer}',
      '.kbwk button:disabled{opacity:.5;cursor:default}',
      '.kbwk button:focus-visible,.kbwk summary:focus-visible,.kbwk input:focus-visible{outline:2px solid #ff7a1a;outline-offset:2px}',
      '.kbwk svg.i{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}',
      '.kbwk .spin{animation:kbwkspin .9s linear infinite}@keyframes kbwkspin{to{transform:rotate(360deg)}}',
      '@media (prefers-reduced-motion:reduce){.kbwk .spin,.kbwk-dot.busy{animation:none}}',
      '.kbwk code,.kbwk-mono{font:12px ui-monospace,Menlo,monospace}',
      '.kbwk p code{background:var(--dsw-alias-bg-layer-3);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}',
      // ── header ───────────────────────────────────────────────────────────
      '.kbwk-head{display:flex;flex-wrap:wrap;gap:10px 24px;justify-content:space-between;align-items:flex-start;min-width:0}',
      '.kbwk-head h4{margin:0 0 2px;font-size:26px;font-weight:800;letter-spacing:-.01em;line-height:1.25}',
      '.kbwk-head p{margin:0;color:var(--dsw-alias-label-secondary);max-width:60ch}',
      '.kbwk-hbtn{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.kbwk-count{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.kbwk-count b{color:var(--dsw-alias-label-primary)}',
      '.kbwk-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:30px;padding:0 12px;border-radius:9px;border:0;font-weight:600;font-size:13px;white-space:nowrap;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      '.kbwk-btn.ghost{background:transparent;color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font-weight:500}',
      '.kbwk-btn.accent{background:#ff7a1a;color:#fff}',
      '.kbwk-btn.ico{width:30px;padding:0}',
      '.kbwk-btn.big{height:32px;padding:0 13px;border-radius:10px}',
      '.kbwk-relance{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;padding:10px 14px;border-radius:12px;border:1px solid #ff7a1a;background:color-mix(in srgb,#ff7a1a 14%,transparent)}',
      '.kbwk-banner{display:flex;flex-direction:column;gap:6px;padding:11px 14px;border-radius:12px;border:1px solid var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.kbwk-banner strong{display:flex;gap:8px;align-items:center}',
      // ── the list: the same columns on every row ───────────────────────────
      '.kbwk-page{container-type:inline-size;container-name:kbwk;display:flex;flex-direction:column;gap:14px;min-width:0}',
      '.kbwk-list{border-top:1px solid var(--dsw-alias-border-l1);list-style:none;margin:0;padding:0;min-width:0}',
      '.kbwk-item{border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}',
      '.kbwk-row{display:grid;grid-template-columns:minmax(0,1fr) 124px 66px 188px 28px;column-gap:12px;row-gap:6px;align-items:center;padding:10px 2px;min-width:0}',
      '.kbwk-item:hover>.kbwk-row{background:var(--dsw-alias-interactive-bg-hover)}',
      '.kbwk-main{display:flex;align-items:center;gap:11px;min-width:0;background:none;border:0;text-align:start;padding:0;color:inherit}',
      '.kbwk-mt{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.kbwk-nom{font-size:15px;font-weight:700;line-height:1.25}',
      '.kbwk-l2{font-size:12.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.kbwk-logo{flex:none;width:36px;height:36px;border-radius:10px;background:#f3f4f6;color:#16181d;border:1px solid rgba(0,0,0,.08);display:grid;place-items:center}',
      '.kbwk-logo svg{width:22px;height:22px;display:block}',
      '.kbwk-logo.sm{width:30px;height:30px;border-radius:8px}.kbwk-logo.sm svg{width:18px;height:18px}',
      '.kbwk-logo.xs{width:20px;height:20px;border-radius:6px}.kbwk-logo.xs svg{width:13px;height:13px}',
      '.kbwk-stc{display:flex;min-width:0}',
      '.kbwk-chip{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 9px 2px 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);white-space:nowrap}',
      '.kbwk-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}',
      '.kbwk-dot.ok{background:var(--dsw-alias-state-success-primary)}.kbwk-dot.warn{background:var(--dsw-alias-state-warn-primary)}.kbwk-dot.bad{background:var(--dsw-alias-state-error-primary)}',
      '.kbwk-dot.busy{animation:kbwkbusy 1.1s ease-in-out infinite}@keyframes kbwkbusy{50%{opacity:.25}}',
      '.kbwk-steps{display:inline-flex;align-items:center;justify-content:center}',
      '.kbwk-steps i{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3);background:transparent;flex:none}',
      '.kbwk-steps i.ok{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
      '.kbwk-steps i.warn{border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,transparent)}',
      '.kbwk-steps s{width:9px;height:2px;background:var(--dsw-alias-border-l2);display:block}',
      '.kbwk-ctl{display:inline-flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0}',
      '.kbwk-swl{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.kbwk-sw{position:relative;flex:none;width:36px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);padding:0}',
      '.kbwk-sw i{position:absolute;inset-inline-start:2px;top:2px;width:14px;height:14px;border-radius:999px;background:var(--dsw-alias-label-secondary);transition:inset-inline-start .15s ease}',
      '.kbwk-sw.on{background:#ff7a1a;border-color:#ff7a1a}.kbwk-sw.on i{inset-inline-start:18px;background:#fff}',
      '.kbwk-chev{width:28px;height:28px;border-radius:8px;border:0;background:none;display:grid;place-items:center;color:var(--dsw-alias-label-secondary)}',
      '.kbwk-chev svg{transition:transform .15s ease}.kbwk-item[data-ouvert="1"] .kbwk-chev svg{transform:rotate(180deg)}',
      '.kbwk-msg{margin:0 2px 10px;font-size:12.5px}.kbwk-msg.ok{color:var(--dsw-alias-state-success-primary)}.kbwk-msg.bad{color:var(--dsw-alias-state-error-primary)}',
      // ── the detail: a checklist ───────────────────────────────────────────
      '.kbwk-detail{display:none;padding:2px 2px 18px;flex-direction:column;gap:14px}',
      '.kbwk-item[data-ouvert="1"] .kbwk-detail{display:flex}',
      '.kbwk-todo{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}',
      '.kbwk-todo>li{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;align-items:start}',
      '.kbwk-n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}',
      '.kbwk-todo>li.done .kbwk-n{background:var(--dsw-alias-state-success-primary);color:#fff}',
      '.kbwk-todo>li.cur .kbwk-n{background:#ff7a1a;color:#fff}',
      '.kbwk-todo>li.wait{opacity:.6}',
      '.kbwk-todo b{font-size:13.5px}',
      '.kbwk-todo p{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.kbwk-cmd{display:flex;align-items:center;gap:8px;margin-top:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:6px 6px 6px 12px;min-width:0}',
      '.kbwk-cmd code{flex:1;min-width:0;overflow-x:auto;white-space:nowrap;font-size:12.5px}',
      '.kbwk-cmd input{flex:1;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;padding:4px 0;outline:0}',
      '.kbwk-cmd:focus-within{border-color:#ff7a1a}',
      '.kbwk-alt{margin:8px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kbwk-alt a{color:inherit;text-decoration:underline}',
      '.kbwk-box{margin-top:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:8px}',
      '.kbwk-box.err{border-color:var(--dsw-alias-state-error-primary)}',
      '.kbwk-box p{margin:0!important}',
      '.kbwk-log{margin:0;font:12px ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border-radius:8px;padding:8px 10px;min-height:44px;white-space:pre-wrap;word-break:break-all}',
      '.kbwk-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.kbwk-pol{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px;display:flex;flex-direction:column;gap:10px}',
      '.kbwk-pol h5{margin:0;font-size:12.5px;font-weight:600}',
      '.kbwk-prow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}',
      '.kbwk-prow p{margin:1px 0 0;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kbwk-tech{border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}',
      '.kbwk-tech summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12.5px;font-weight:600}',
      '.kbwk-ev{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:12.5px}',
      '.kbwk-ev li{display:flex;gap:7px;align-items:baseline;min-width:0;overflow-wrap:anywhere}',
      '.kbwk-ev .ok{color:var(--dsw-alias-state-success-primary)}.kbwk-ev .ko{color:var(--dsw-alias-state-error-primary)}.kbwk-ev .inconnu{color:var(--dsw-alias-state-warn-primary)}',
      '.kbwk-ev small{color:var(--dsw-alias-label-tertiary);font:11.5px ui-monospace,Menlo,monospace}',
      '.kbwk-note{margin:0;font-size:12.5px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}',
      '.kbwk-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:12px}',
      // narrow window: measured on the page itself, not the screen
      '@container kbwk (max-width:640px){',
      '.kbwk-row{grid-template-columns:minmax(0,1fr) auto 28px}',
      '.kbwk-main{grid-column:1 / span 2;grid-row:1}.kbwk-chev{grid-column:3;grid-row:1}',
      '.kbwk-stc{grid-column:1;grid-row:2}.kbwk-steps{grid-column:2;grid-row:2;justify-self:end}',
      '.kbwk-ctl{grid-column:1 / span 3;grid-row:3;justify-content:space-between}',
      '.kbwk-head h4{font-size:22px}',
      '}',
      // ── the guide ─────────────────────────────────────────────────────────
      '.kbwk-scrim{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto}',
      '.kbwk-dlg{position:relative;width:100%;max-width:640px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:20px 22px 22px;display:flex;flex-direction:column;gap:16px;font-size:13.5px;outline:0}',
      '.kbwk-dlg h3{margin:0;font-size:20px;font-weight:800}',
      '.kbwk-dlg h6{margin:0 0 8px;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);font-weight:600}',
      '.kbwk-dlg p{margin:0;color:var(--dsw-alias-label-secondary)}',
      '.kbwk-x{position:absolute;inset-inline-end:12px;top:12px;width:28px;height:28px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);display:grid;place-items:center;cursor:pointer}',
      '.kbwk-x:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.kbwk-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px}',
      '.kbwk-node{flex:1 1 150px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.kbwk-node span{font-size:12.5px;color:var(--dsw-alias-label-tertiary)}',
      '.kbwk-arrow{align-self:center;color:var(--dsw-alias-label-tertiary);font-size:18px}',
      '.kbwk-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}',
      '.kbwk-chips em{font-style:normal;display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:2px 8px 2px 3px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
      '.kbwk-demo{border:1px solid var(--dsw-alias-border-l2);border-radius:14px;overflow:hidden;background:var(--dsw-alias-bg-layer-1)}',
      '.kbwk-demo>header{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-3)}',
      '.kbwk-demo>header span{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.kbwk-tabs{display:flex;gap:4px;padding:10px 12px 0;flex-wrap:wrap}',
      '.kbwk-tabs button{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:999px;padding:3px 11px 3px 4px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.kbwk-tabs button .kbwk-n{width:19px;height:19px;font-size:11px}',
      '.kbwk-tabs button[aria-current="step"]{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}',
      '.kbwk-tabs button.done .kbwk-n{background:var(--dsw-alias-state-success-primary);color:#fff}',
      '.kbwk-tabs button[aria-current="step"] .kbwk-n{background:#ff7a1a;color:#fff}',
      '.kbwk-say{padding:12px 16px 4px}',
      '.kbwk-say h4{margin:0 0 3px;font-size:15px}',
      '.kbwk-say p{font-size:13.5px}',
      '.kbwk-stage{padding:10px 14px 14px;display:flex;flex-direction:column;gap:12px}',
      '.kbwk-mini{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);padding:4px 10px}',
      '.kbwk-mini .kbwk-row{grid-template-columns:auto 1fr auto;padding:9px 0;column-gap:12px}',
      '.kbwk-mini .kbwk-main{grid-column:1 / -1;grid-row:1}.kbwk-mini .kbwk-stc{grid-column:1;grid-row:2}',
      '.kbwk-mini .kbwk-steps{grid-column:2;grid-row:2;justify-self:start}.kbwk-mini .kbwk-ctl{grid-column:3;grid-row:2}',
      '.kbwk-term{background:#0f0f10;color:#d9dde1;border-radius:12px;overflow:hidden;font:12.5px ui-monospace,Menlo,monospace}',
      '.kbwk-term .tb{display:flex;gap:6px;padding:8px 10px;background:rgba(255,255,255,.06)}',
      '.kbwk-term .tb i{width:10px;height:10px;border-radius:50%;background:#ff5f57}.kbwk-term .tb i:nth-child(2){background:#febc2e}.kbwk-term .tb i:nth-child(3){background:#28c840}',
      '.kbwk-term .tb span{margin-inline-start:8px;color:#8b939c;font-size:11.5px}',
      '.kbwk-term pre{margin:0;padding:10px 12px;white-space:pre-wrap;word-break:break-all;min-height:80px;font:inherit}',
      '.kbwk-term .g{color:#4ade80}.kbwk-term .d{color:#8b939c}',
      '.kbwk-checks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;font-size:13px}',
      '.kbwk-checks li{display:flex;gap:8px;color:var(--dsw-alias-label-tertiary)}.kbwk-checks li.on{color:var(--dsw-alias-label-primary)}',
      '.kbwk-checks .m{width:16px;color:var(--dsw-alias-state-success-primary);font-weight:700}',
      '.kbwk-chat{display:flex;flex-direction:column;gap:8px}',
      '.kbwk-bub{max-width:88%;padding:9px 12px;border-radius:14px;font-size:13.5px}',
      '.kbwk-bub.me{align-self:flex-end;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-end-end-radius:4px}',
      '.kbwk-bub.ai{align-self:flex-start;background:var(--dsw-alias-bg-layer-3);border-end-start-radius:4px}',
      '.kbwk-job{align-self:flex-start;width:min(100%,380px);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:9px 12px;font-size:13px;display:flex;flex-direction:column;gap:3px;background:var(--dsw-alias-bg-layer-2)}',
      '.kbwk-job .t{display:flex;gap:8px;align-items:center;font-weight:600}',
      '.kbwk-prog{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}.kbwk-prog i{display:block;height:100%;background:#ff7a1a;transition:width 1.6s linear}',
      '.kbwk-nav{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.kbwk-faq{display:flex;flex-direction:column;gap:6px}',
      '.kbwk-faq details{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 12px}',
      '.kbwk-faq summary{cursor:pointer;font-weight:600;font-size:13.5px}',
      '.kbwk-faq details p{margin-top:6px;font-size:13px}'
    ].join('\n')

    const ICONS = {
      alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01',
      refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
      plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z',
      chevron: 'm6 9 6 6 6-6',
      close: 'M18 6 6 18M6 6l12 12',
      download: 'M12 3v12M7 10l5 5 5-5M5 21h14'
    }

    const buildPanel = (React, creds) => {
      const h = React.createElement
      const ic = (name, extra) => h('svg', { className: 'i' + (extra ? ' ' + extra : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d: ICONS[name] || ICONS.alert }))
      const logo = (w, size) => h('span', { className: 'kbwk-logo' + (size ? ' ' + size : ''), 'aria-hidden': 'true' }, h('svg', { viewBox: '0 0 24 24' }, h('use', { href: '#kbwk-lg-' + (LOGO_OF[typeof w === 'string' ? w : w.id] || 'term') })))
      const cmdBox = (text) => h('div', { className: 'kbwk-cmd' }, h('code', null, text),
        h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: (e) => { e.stopPropagation(); copyText(text, e.currentTarget) } }, kt('Copier', 'Copy')))

      /** One row, shared by the page and the demo so what is learnt there is what is on the page. */
      const rowView = (o) => h('div', { className: 'kbwk-row' },
        h(o.toggle ? 'button' : 'div', Object.assign({ className: 'kbwk-main' }, o.toggle ? { type: 'button', 'aria-expanded': o.open ? 'true' : 'false', 'data-kb': 'wk-toggle-' + o.id, onClick: o.toggle } : {}),
          logo(o.logoId), h('span', { className: 'kbwk-mt' }, h('span', { className: 'kbwk-nom' }, o.name), h('span', { className: 'kbwk-l2', title: o.sub }, o.sub))),
        h('span', { className: 'kbwk-stc' }, h('span', { className: 'kbwk-chip', role: 'status', 'data-kb': o.id ? 'wk-status-' + o.id : undefined }, h('i', { className: 'kbwk-dot ' + o.status[0] }), kt(o.status[1], o.status[2]))),
        h('span', { className: 'kbwk-steps', title: kt('Activé · Installé · Connecté · Vérifié', 'Turned on · Installed · Signed in · Checked'), 'aria-label': kt('Étapes : activé, installé, connecté, vérifié', 'Steps: turned on, installed, signed in, checked') },
          o.steps.reduce((acc, s, i) => { if (i > 0) acc.push(h('s', { key: 's' + i })); acc.push(h('i', { key: 'i' + i, className: s })); return acc }, [])),
        h('span', { className: 'kbwk-ctl' }, o.ctl),
        o.toggle ? h('button', { type: 'button', className: 'kbwk-chev', 'aria-label': kt('Détails', 'Details'), 'aria-expanded': o.open ? 'true' : 'false', 'data-kb': 'wk-det-' + o.id, onClick: o.toggle }, h('svg', { className: 'i', viewBox: '0 0 24 24' }, h('path', { d: ICONS.chevron }))) : null)

      const swtch = (o) => h('button', { type: 'button', role: 'switch', 'aria-checked': o.on ? 'true' : 'false', 'aria-label': o.label, title: o.title || o.label, disabled: o.disabled === true, className: 'kbwk-sw' + (o.on ? ' on' : ''), 'data-kb': o.kb, onClick: o.onClick }, h('i'))

      // ── the guide dialog ──
      function Guide ({ onClose }) {
        const [step, setStep] = React.useState(0)
        const [d, setD] = React.useState({ mounted: false, verdict: null, installed: false, connected: false, ask: false, inst: null, log: [], term: [], expose: false, saved: false, chat: 0, busy: false, checkN: 0 })
        const alive = React.useRef(true)
        const root = React.useRef(null)
        const patch = (p) => { if (alive.current) setD((x) => Object.assign({}, x, p)) }
        const push = (key, line) => { if (alive.current) setD((x) => Object.assign({}, x, { [key]: x[key].concat([line]) })) }
        React.useEffect(() => {
          alive.current = true
          const before = document.activeElement
          if (root.current) root.current.focus()
          const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
          window.addEventListener('keydown', esc, true)
          return () => { alive.current = false; window.removeEventListener('keydown', esc, true); try { if (before && before.focus) before.focus() } catch (e) { /* the opener is gone */ } }
        }, [])

        const STEPS = [
          [kt('Activer', 'Turn on'), kt('DSH doit d’abord connaître l’agent. Un clic sur « Activer » l’ajoute à votre configuration, avec une sauvegarde. Essayez sur la ligne ci-dessous.', 'DSH has to know the agent first. One click on "Turn on" adds it to your configuration, with a backup. Try it on the row below.')],
          [kt('Vérifier', 'Check'), kt('« Vérifier » contrôle l’agent sans l’utiliser, donc sans rien dépenser. Il dit ce qui manque, et la ligne indique l’étape suivante.', '"Check" tests the agent without using it, so it spends nothing. It says what is missing, and the row shows the next step.')],
          [kt('Installer', 'Install'), kt('Si le programme manque, DSH peut l’installer pour vous : il montre la commande exacte et sa source, vous confirmez, il la lance puis revérifie tout seul.', 'If the program is missing, DSH can install it for you: it shows the exact command and its source, you confirm, it runs it and checks again by itself.')],
          [kt('Se connecter', 'Sign in'), kt('La connexion se fait avec votre compte, dans votre navigateur : DSH ne peut pas la faire à votre place. Tapez le nom de l’agent dans l’app Terminal (Cmd + Espace, « Terminal »). Certains agents (Gemini, Qwen) demandent plutôt une clé API, que l’on colle dans la page.', 'Signing in uses your account, in your browser: DSH cannot do it for you. Type the agent’s name in the Terminal app (Cmd + Space, "Terminal"). Some agents (Gemini, Qwen) ask for an API key instead, which you paste in the page.')],
          [kt('Revérifier', 'Check again'), kt('Une fois connecté, vérifiez de nouveau. Quand les cinq contrôles passent, la ligne passe à « Prêt ».', 'Once signed in, check again. When the five checks pass, the row turns "Ready".')],
          [kt('Autoriser', 'Allow'), kt('Vous choisissez si l’agent principal peut appeler cet agent. Pensez à enregistrer : DSH l’applique en quelques secondes.', 'You choose whether the main agent may call this agent. Remember to save: DSH applies it in a few seconds.')],
          [kt('Déléguer', 'Delegate'), kt('Dans une conversation, demandez simplement. L’agent principal choisit de passer la tâche au worker autorisé et vous rend le résultat.', 'In a conversation, just ask. The main agent hands the task to the allowed worker and brings you the result.')]
        ]

        const status = !d.mounted ? 'inactive' : (d.busy === 'check' ? 'checking' : (d.verdict === null ? 'unknown' : d.verdict))
        const demoSteps = [d.mounted ? 'ok' : '', d.verdict && d.verdict !== 'binaire-absent' ? 'ok' : (d.verdict ? 'warn' : ''), d.verdict === 'pret' ? 'ok' : (d.verdict === 'non-connecte' ? 'warn' : ''), d.verdict === 'pret' ? 'ok' : '']
        const verdictNow = (x) => (!x.installed ? 'binaire-absent' : (!x.connected ? 'non-connecte' : 'pret'))
        const act = {
          activate: () => patch({ mounted: true }),
          check: async () => {
            patch({ busy: 'check', checkN: 0 })
            if (step === 4) { for (let i = 1; i <= 5; i++) { await wait(380); patch({ checkN: i }) } } else await wait(800)
            setD((x) => Object.assign({}, x, { busy: false, verdict: verdictNow(x), checkN: verdictNow(x) === 'pret' ? 5 : x.checkN }))
          },
          ask: () => { patch({ ask: true }); setStep(2) },
          run: async () => {
            patch({ ask: false, inst: 'running', log: ['$ ' + DEMO_COMMAND] })
            await wait(800); push('log', kt('Téléchargement…', 'Downloading…'))
            await wait(800); push('log', '✓ claude 2.1.287 ' + kt('installé', 'installed')); patch({ installed: true })
            await wait(600); patch({ verdict: 'non-connecte', inst: 'done' })
          },
          signin: async () => {
            patch({ busy: true, term: [{ t: '$ claude', c: '' }] })
            await wait(700); push('term', { t: kt('Ouverture de votre navigateur… connexion à votre compte Claude', 'Opening your browser… signing in to your Claude account'), c: 'd' })
            await wait(900); push('term', { t: kt('Connexion confirmée dans le navigateur.', 'Sign-in confirmed in the browser.'), c: 'd' })
            await wait(600); push('term', { t: '✓ ' + kt('connecté', 'signed in'), c: 'g' }); patch({ connected: true, busy: false })
          },
          send: async () => {
            patch({ chat: 1 }); await wait(700); patch({ chat: 2 }); await wait(1800); patch({ chat: 3 })
          },
          reset: () => { setD({ mounted: false, verdict: null, installed: false, connected: false, ask: false, inst: null, log: [], term: [], expose: false, saved: false, chat: 0, busy: false, checkN: 0 }); setStep(0) }
        }

        let ctl = null
        if (status === 'inactive') ctl = h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'guide-activate', onClick: act.activate }, ic('plug'), kt('Activer', 'Turn on'))
        else if (status === 'checking') ctl = h('button', { type: 'button', className: 'kbwk-btn', disabled: true }, ic('refresh', 'spin'), kt('Vérification…', 'Checking…'))
        else if (status === 'unknown') ctl = h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'guide-check', onClick: act.check }, ic('refresh'), kt('Vérifier', 'Check'))
        else if (status === 'pret') ctl = h(React.Fragment, null, h('span', { className: 'kbwk-swl' }, kt('Autorisé', 'Allowed'), swtch({ on: d.expose, label: kt('Autorisé', 'Allowed'), kb: 'guide-expose', onClick: () => patch({ expose: !d.expose }) })), d.expose !== d.saved ? h('button', { type: 'button', className: 'kbwk-btn accent', 'data-kb': 'guide-save', onClick: () => patch({ saved: d.expose }) }, kt('Enregistrer', 'Save')) : null)
        else if (status === 'binaire-absent') ctl = d.inst === 'running' ? h('button', { type: 'button', className: 'kbwk-btn', disabled: true }, ic('refresh', 'spin'), kt('Installation…', 'Installing…')) : h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'guide-ask', onClick: act.ask }, ic('download'), kt('Installer', 'Install'))
        else ctl = h('button', { type: 'button', className: 'kbwk-btn ghost', 'data-kb': 'guide-check', onClick: act.check }, ic('refresh'), kt('Revérifier', 'Check again'))
        const mini = h('div', { className: 'kbwk-mini' }, rowView({ logoId: 'claude-code', name: 'Claude Code', sub: kt('Exemple · Anthropic · abonnement Claude', 'Example · Anthropic · Claude subscription'), status: STATUS[status], steps: demoSteps, ctl }))

        const hint = (fr, en) => h('p', { className: 'kbwk-note' }, kt(fr, en))
        let stage
        if (step === 0) stage = mini
        else if (step === 1) stage = h(React.Fragment, null, mini, d.verdict === 'binaire-absent' ? hint('Résultat : un point manque, le programme Claude Code n’est pas installé. On s’en occupe à l’étape suivante.', 'Result: one point is missing, the Claude Code program is not installed. We take care of it in the next step.') : null, !d.mounted ? hint('Faites d’abord l’étape 1.', 'Do step 1 first.') : null)
        else if (step === 2) {
          let box = null
          if (d.ask) box = h('div', { className: 'kbwk-box' }, h('p', null, h('b', null, kt('DSH va lancer cette commande sur votre ordinateur :', 'DSH will run this command on your computer:'))), h('div', { className: 'kbwk-cmd' }, h('code', null, DEMO_COMMAND)),
            h('p', { className: 'kbwk-alt' }, kt('Source : claude.ai (installation officielle de Claude Code). Vous pouvez interrompre à tout moment.', 'Source: claude.ai (the official Claude Code install). You can stop it at any time.')),
            h('div', { className: 'kbwk-acts' }, h('button', { type: 'button', className: 'kbwk-btn accent', 'data-kb': 'guide-run', onClick: act.run }, ic('download'), kt('Lancer l’installation', 'Run the install')), h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: () => patch({ ask: false }) }, kt('Annuler', 'Cancel'))))
          else if (d.inst === 'running' || d.inst === 'done') box = h('div', { className: 'kbwk-box' }, h('p', null, h('b', null, d.inst === 'done' ? '✓ ' + kt('Installé. DSH a revérifié tout seul.', 'Installed. DSH checked again by itself.') : kt('Installation en cours…', 'Installing…'))), h('pre', { className: 'kbwk-log' }, d.log.join('\n')))
          stage = h(React.Fragment, null, mini, box, d.verdict !== 'binaire-absent' && !d.installed ? hint('Faites d’abord l’étape 2 : la vérification dit si l’installation est nécessaire.', 'Do step 2 first: the check says whether an install is needed.') : null)
        } else if (step === 3) {
          stage = h(React.Fragment, null, mini,
            h('div', { className: 'kbwk-term' }, h('div', { className: 'tb' }, h('i'), h('i'), h('i'), h('span', null, 'Terminal')), h('pre', null, d.term.length === 0 ? h('span', { className: 'd' }, kt('Cliquez sur le bouton ci-dessous pour taper la commande dans cette fenêtre.', 'Click the button below to type the command in this window.')) : d.term.map((l, i) => h('span', { key: i, className: l.c }, l.t + '\n')))),
            h('div', { className: 'kbwk-acts' }, h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'guide-signin', disabled: !d.installed || d.connected || d.busy === true, onClick: act.signin }, d.connected ? '✓ ' + kt('Connecté', 'Signed in') : kt('Taper « claude » et se connecter', 'Type "claude" and sign in'))),
            !d.installed ? hint('Faites d’abord l’étape 3 : il faut que le programme soit installé.', 'Do step 3 first: the program has to be installed.') : hint('Dans la vraie page, le bouton « Copier » met la commande dans le presse-papiers : il suffit de la coller (Cmd + V) dans le Terminal, puis Entrée.', 'On the real page, the "Copy" button puts the command in the clipboard: just paste it (Cmd + V) in the Terminal, then Enter.'))
        } else if (step === 4) {
          const marks = [kt('Connexion montée dans le profil', 'Connection mounted in the profile'), kt('Paquet de connexion installé', 'Connection package installed'), kt('Programme trouvé sur l’ordinateur', 'Program found on the computer'), kt('Connexion à votre compte confirmée', 'Sign-in to your account confirmed'), kt('Écriture possible dans un dossier de test', 'Writing possible in a test folder')]
          stage = h(React.Fragment, null, mini, h('ul', { className: 'kbwk-checks' }, marks.map((m, i) => h('li', { key: i, className: i < d.checkN ? 'on' : '' }, h('span', { className: 'm' }, i < d.checkN ? '✓' : ''), m))),
            d.verdict === 'pret' ? hint('Aucun modèle n’a été appelé : 0 € dépensé sur votre abonnement Claude.', 'No model was called: nothing spent on your Claude subscription.') : null)
        } else if (step === 5) {
          stage = h(React.Fragment, null, mini, d.verdict !== 'pret' ? hint('Faites d’abord l’étape 5 : l’interrupteur apparaît quand l’agent est prêt.', 'Do step 5 first: the switch shows up once the agent is ready.') : null,
            d.saved ? h('p', { className: 'kbwk-msg ok', role: 'status' }, kt('Enregistré. DSH l’applique dans quelques secondes.', 'Saved. DSH applies it in a few seconds.')) : null,
            d.verdict === 'pret' ? hint('Dans la vraie page, le réglage « Arrière-plan » se trouve dans le détail de la ligne.', 'On the real page, the "Background" setting is in the row’s details.') : null)
        } else {
          stage = h(React.Fragment, null, d.saved && d.expose ? null : hint('Dans la vraie utilisation, il faut avoir autorisé l’agent (étape 6). Ici, la démo continue.', 'In real use, the agent has to be allowed (step 6). Here the demo goes on.'),
            h('div', { className: 'kbwk-chat' },
              d.chat >= 1 ? h('div', { className: 'kbwk-bub me' }, kt('Demande à Claude Code de relire mon README pendant que je prépare la sortie.', 'Ask Claude Code to proofread my README while I prepare the release.')) : null,
              d.chat >= 2 ? h('div', { className: 'kbwk-bub ai' }, kt('Je confie la relecture à Claude Code. Je vous préviens quand c’est fini.', 'I am handing the proofreading to Claude Code. I will tell you when it is done.')) : null,
              d.chat >= 2 ? h('div', { className: 'kbwk-job' }, h('span', { className: 't' }, logo('claude-code', 'xs'), h('i', { className: 'kbwk-dot ' + (d.chat >= 3 ? 'ok' : 'warn busy') }), 'Claude Code · ' + (d.chat >= 3 ? kt('terminé', 'done') : kt('en arrière-plan', 'in the background'))), h('span', { className: 'kbwk-note' }, kt('Dossier du projet · ', 'Project folder · ') + (d.chat >= 3 ? '0:07' : kt('en cours', 'running'))), h('div', { className: 'kbwk-prog' }, h('i', { style: { width: d.chat >= 3 ? '100%' : '8%' } }))) : null,
              d.chat >= 3 ? h('div', { className: 'kbwk-bub ai' }, kt('Claude Code a relu le README : 3 corrections proposées (une faute, un lien cassé, une commande périmée). Voulez-vous que je les applique ?', 'Claude Code proofread the README: 3 fixes suggested (a typo, a broken link, an outdated command). Shall I apply them?')) : null),
            h('div', { className: 'kbwk-acts' }, d.chat === 0 ? h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'guide-send', onClick: act.send }, kt('Envoyer le message', 'Send the message')) : null, d.chat >= 3 ? h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: act.reset }, kt('Recommencer la démo', 'Start the demo again')) : null))
        }

        const faq = (q, a) => h('details', null, h('summary', null, q), h('p', null, a))
        return h('div', { className: 'kbwk-scrim', 'data-kb': 'workers-guide', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
          h('section', { className: 'kbwk-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Workers — ' + kt('Comment ça marche', 'How it works'), tabIndex: -1, ref: root },
            h('button', { type: 'button', className: 'kbwk-x', 'aria-label': kt('Fermer', 'Close'), 'data-kb': 'guide-close', onClick: onClose }, ic('close')),
            h('div', null, h('h3', null, kt('Comment ça marche', 'How it works')), h('p', { style: { marginTop: 6 } }, kt('Un worker est un deuxième assistant de code installé sur votre ordinateur. Comme un chef de projet qui confie une tâche à un spécialiste, votre agent principal peut lui passer un travail pendant que vous continuez à discuter avec lui.', 'A worker is a second coding assistant installed on your computer. Like a project lead handing a task to a specialist, your main agent can pass it a job while you keep talking to it.'))),
            h('div', null, h('h6', null, kt('Le principe', 'The idea')), h('div', { className: 'kbwk-flow' },
              h('div', { className: 'kbwk-node' }, h('b', null, kt('Vous', 'You')), h('span', null, kt('Vous parlez à un seul agent, comme d’habitude.', 'You talk to a single agent, as usual.'))),
              h('span', { className: 'kbwk-arrow', 'aria-hidden': 'true' }, '→'),
              h('div', { className: 'kbwk-node' }, h('b', null, kt('Agent principal', 'Main agent')), h('span', null, kt('Il décide de déléguer une tâche si vous l’y autorisez.', 'It decides to hand a task over if you allowed it.'))),
              h('span', { className: 'kbwk-arrow', 'aria-hidden': 'true' }, '→'),
              h('div', { className: 'kbwk-node' }, h('b', null, 'Workers'), h('span', null, kt('Ils travaillent dans votre dossier de projet.', 'They work in your project folder.')),
                h('span', { className: 'kbwk-chips' }, ['claude-code', 'codex', 'gemini', 'opencode', 'qwen', 'hermes'].map((id) => h('em', { key: id }, logo(id, 'xs'), ({ 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode', qwen: 'Qwen', hermes: 'Hermes' })[id]))))
            )),
            h('div', { className: 'kbwk-demo' },
              h('header', null, h('b', null, kt('Essayez : mettre un worker en route', 'Try it: get a worker running')), h('span', null, kt('Simulation, rien n’est installé', 'Simulation, nothing gets installed'))),
              h('div', { className: 'kbwk-tabs', role: 'tablist' }, STEPS.map((s, i) => h('button', Object.assign({ key: i, type: 'button', role: 'tab', 'data-kb': 'guide-step-' + i, className: i < step ? 'done' : '', onClick: () => setStep(i) }, i === step ? { 'aria-current': 'step' } : {}), h('span', { className: 'kbwk-n' }, i < step ? '✓' : i + 1), s[0]))),
              h('div', { className: 'kbwk-say' }, h('h4', null, (step + 1) + '. ' + STEPS[step][0]), h('p', null, STEPS[step][1])),
              h('div', { className: 'kbwk-stage' }, stage),
              h('div', { className: 'kbwk-nav' }, h('button', { type: 'button', className: 'kbwk-btn ghost', 'data-kb': 'guide-prev', disabled: step === 0, onClick: () => setStep(Math.max(0, step - 1)) }, kt('Précédent', 'Previous')), h('span', { className: 'kbwk-note' }, kt('Étape ', 'Step ') + (step + 1) + kt(' sur ', ' of ') + STEPS.length), h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'guide-next', disabled: step === STEPS.length - 1, onClick: () => setStep(Math.min(STEPS.length - 1, step + 1)) }, kt('Suivant', 'Next')))),
            h('div', { className: 'kbwk-faq' }, h('h6', null, kt('Questions fréquentes', 'Common questions')),
              faq(kt('Est-ce que ça coûte quelque chose ?', 'Does it cost anything?'), kt('DSH ne facture rien en plus. Chaque agent utilise son propre abonnement ou sa propre clé (Claude, ChatGPT, Google, Alibaba…). « Vérifier » n’appelle aucun modèle.', 'DSH charges nothing more. Each agent uses its own subscription or key (Claude, ChatGPT, Google, Alibaba…). "Check" calls no model.')),
              faq(kt('DSH installe-t-il vraiment les agents ?', 'Does DSH really install the agents?'), kt('Oui, si vous le demandez : le bouton « Installer » lance l’installation officielle de l’agent, après avoir montré la commande et sa source et attendu votre confirmation. La connexion à votre compte reste à faire par vous, dans le navigateur.', 'Yes, when you ask: the "Install" button runs the agent’s official install, after showing the command and its source and waiting for your confirmation. Signing in to your account is still up to you, in the browser.')),
              faq(kt('Un worker peut-il modifier mes fichiers ?', 'Can a worker change my files?'), kt('Oui, dans le dossier de la conversation, comme il le ferait dans son propre outil, parfois sans demander confirmation à chaque fichier. N’autorisez que les agents que vous voulez voir travailler.', 'Yes, in the conversation’s folder, as it would in its own tool, sometimes without asking for each file. Only allow the agents you want to see work.')),
              faq(kt('Ça ne passe pas au vert, que faire ?', 'It will not turn green, what now?'), kt('Cliquez sur le bouton de la ligne (« Installer », « Se connecter » ou « Que faire ? ») : la page indique l’étape qui bloque et ce qu’il faut faire. Ensuite, « Revérifier ».', 'Click the button on the row ("Install", "Sign in" or "What to do?"): the page shows the step that blocks and what to do. Then "Check again".')),
              faq(kt('Où est l’app Terminal ?', 'Where is the Terminal app?'), kt('Sur Mac : Cmd + Espace, tapez « Terminal », Entrée. Collez la ligne avec Cmd + V puis appuyez sur Entrée. Sous Windows, ouvrez PowerShell et suivez le guide officiel de l’agent.', 'On a Mac: Cmd + Space, type "Terminal", Enter. Paste the line with Cmd + V then press Enter. On Windows, open PowerShell and follow the agent’s official guide.'))
            )))
      }

      // ── the page ──
      return function Panel () {
        const [loaded, setLoaded] = React.useState({ state: 'loading', data: null })
        const [busy, setBusy] = React.useState({})
        const [drafts, setDrafts] = React.useState({})
        const [msgs, setMsgs] = React.useState({})
        const [pending, setPending] = React.useState(0)
        const [open, setOpen] = React.useState({})
        const [asks, setAsks] = React.useState({})
        const [jobs, setJobs] = React.useState({})
        const [stored, setStored] = React.useState({})
        const [typed, setTyped] = React.useState({})
        const [replacing, setReplacing] = React.useState({})
        const [guide, setGuide] = React.useState(false)
        const profileRef = React.useRef(null)
        const handled = React.useRef({})

        const reload = React.useCallback(async () => {
          const tools = await lireJson('/kybernos/tools/state')
          let profile = tools != null && typeof tools.profile === 'string' ? tools.profile : null
          let d = await lireJson('/kybernos-workers/state' + (profile !== null ? '?profile=' + encodeURIComponent(profile) : ''))
          if ((d === null || d.ok !== true) && profile !== null) { profile = null; d = await lireJson('/kybernos-workers/state') }
          if (d === null || d.ok !== true) { setLoaded({ state: 'error', data: null }); return null }
          profileRef.current = d.profil
          setLoaded({ state: 'ok', data: d })
          setJobs(() => { const next = {}; for (const w of d.workers) if (w.job != null) next[w.id] = w.job; return next })
          // Which API keys are already stored: names only, never a value.
          try {
            const refs = []
            for (const w of d.workers) if (w.connect != null && w.connect.mode === 'key') for (const r of w.connect.refs) if (refs.indexOf(r) < 0) refs.push(r)
            if (refs.length > 0 && creds.get() !== null && typeof creds.get().describe === 'function') {
              const r = await creds.get().describe(refs)
              const view = r != null && r.ok === true && r.value != null ? r.value : {}
              const next = {}
              for (const w of d.workers) if (w.connect != null && w.connect.mode === 'key') next[w.id] = w.connect.refs.some((ref) => view[ref] != null && view[ref].configured === true)
              setStored(next)
            }
          } catch (e) { /* a missing credentials service only hides the "already stored" hint */ }
          return d
        }, [])

        React.useEffect(() => { reload() }, [])

        const occupy = (id, v) => setBusy((o) => { const n = Object.assign({}, o); if (v === null) delete n[id]; else n[id] = v; return n })
        const say = (id, type, text) => setMsgs((m) => Object.assign({}, m, { [id]: { type, text } }))
        const toggle = (id) => setOpen((o) => Object.assign({}, o, { [id]: o[id] === true ? false : true }))
        const show = (id) => setOpen((o) => Object.assign({}, o, { [id]: true }))

        const checkOne = async (id) => {
          occupy(id, 'check'); say(id, 'ok', '')
          const r = await post('/kybernos-workers/check', { worker: id, profile: profileRef.current })
          occupy(id, null)
          if (r.ok !== true) { say(id, 'bad', r.error === 'busy' ? kt('Une vérification est déjà en cours.', 'A check is already running.') : kt('Vérification impossible : ', 'Check failed: ') + String(r.error || '')); return }
          await reload()
        }
        const checkAll = async () => {
          const list = (loaded.data ? loaded.data.workers : []).filter((w) => w.connexion === true)
          for (const w of list) await checkOne(w.id)
        }
        const activate = async (w) => {
          occupy(w.id, 'activate'); say(w.id, 'ok', '')
          const r = w.activation === 'workers'
            ? await post('/kybernos-workers/activate', { worker: w.id, profile: profileRef.current })
            : await post('/kybernos/tools/apply', { family: w.id, profile: profileRef.current })
          occupy(w.id, null)
          if (r.ok !== true) { say(w.id, 'bad', refusalText(r, 'Activation impossible : ', 'Could not turn it on: ')); show(w.id); return }
          say(w.id, 'ok', r.already === true ? kt('Déjà activé.', 'Already turned on.') : kt('Activé : connexion ajoutée au profil (sauvegarde créée). DSH la charge dans quelques secondes.', 'Turned on: connection added to the profile (backup created). DSH loads it in a few seconds.'))
          show(w.id)
          await reload()
        }
        const apply = async (w, wanted) => {
          occupy(w.id, 'apply'); say(w.id, 'ok', '')
          const r = await post('/kybernos-workers/policy', { worker: w.id, expose: wanted.expose, background: wanted.background, profile: profileRef.current })
          occupy(w.id, null)
          if (r.ok !== true) { say(w.id, 'bad', refusalText(r, 'Écriture refusée : ', 'Write refused: ')); return }
          setDrafts((b) => { const n = Object.assign({}, b); delete n[w.id]; return n })
          say(w.id, 'ok', r.action === 'inchange' ? kt('Rien à changer.', 'Nothing to change.') : kt('Écrit dans le profil (sauvegarde ' + r.backup + '). DSH l’applique dans quelques secondes.', 'Written to the profile (backup ' + r.backup + '). DSH applies it in a few seconds.'))
          await reload()
        }

        // ── install: confirm → run on the host → poll → check again ──
        const askInstall = (id) => setAsks((a) => Object.assign({}, a, { [id]: 'confirm' }))
        const cancelAsk = (id) => setAsks((a) => { const n = Object.assign({}, a); delete n[id]; return n })
        const diy = (id) => setAsks((a) => Object.assign({}, a, { [id]: a[id] === 'diy' ? undefined : 'diy' }))
        const runInstall = async (w) => {
          say(w.id, 'ok', '')
          const r = await post('/kybernos-workers/install', { worker: w.id, command: w.install.cmd })
          if (r.ok !== true) { say(w.id, 'bad', refusalText(r, 'Installation impossible : ', 'Install failed: ')); cancelAsk(w.id); if (r.error === 'already-installed') await checkOne(w.id); return }
          cancelAsk(w.id)
          handled.current[w.id] = null
          setJobs((j) => Object.assign({}, j, { [w.id]: { phase: 'running', journal: [], code: null } }))
        }
        const running = Object.keys(jobs).filter((id) => jobs[id] != null && jobs[id].phase === 'running')
        React.useEffect(() => {
          if (running.length === 0) return undefined
          let alive = true
          const tick = async () => {
            for (const id of running) {
              const r = await lireJson('/kybernos-workers/install?worker=' + encodeURIComponent(id))
              if (!alive || r == null || r.ok !== true || r.job == null) continue
              setJobs((j) => Object.assign({}, j, { [id]: r.job }))
              if (r.job.phase !== 'running' && handled.current[id] !== r.job.fini) {
                handled.current[id] = r.job.fini
                if (r.job.phase === 'done') {
                  if (r.job.surLePath === false) { setPending((n) => n + 1); say(id, 'ok', kt('Installé, mais DSH ne le voit pas encore dans son PATH : redémarrez DSH, puis « Revérifier ».', 'Installed, but DSH does not see it in its PATH yet: restart DSH, then "Check again".')) }
                  else say(id, 'ok', kt('Installé. DSH revérifie…', 'Installed. DSH is checking again…'))
                  await checkOne(id)
                } else await reload()
              }
            }
          }
          const t = setInterval(tick, 1200)
          return () => { alive = false; clearInterval(t) }
        }, [running.join()])

        // ── API key (Gemini, Qwen) ──
        const saveKey = async (w) => {
          const value = String(typed[w.id] || '').trim()
          if (value === '') { say(w.id, 'bad', kt('Collez d’abord votre clé.', 'Paste your key first.')); return }
          let ok = false
          try { const r = creds.get() !== null ? await creds.get().set(w.connect.env, value) : null; ok = r != null && r.ok !== false } catch (e) { ok = false }
          if (!ok) { say(w.id, 'bad', kt('La clé n’a pas pu être enregistrée.', 'The key could not be saved.')); return }
          setTyped((t) => { const n = Object.assign({}, t); delete n[w.id]; return n })
          setReplacing((r) => { const n = Object.assign({}, r); delete n[w.id]; return n })
          setStored((s) => Object.assign({}, s, { [w.id]: true }))
          setPending((n) => n + 1)
          say(w.id, 'ok', kt('Clé enregistrée. Redémarrez DSH pour qu’elle soit prise en compte.', 'Key saved. Restart DSH so it is taken into account.'))
        }

        React.useEffect(() => {
          // publishes the collected vocabulary for the i18n corpus of the Language page —
          // ids prefixed 'workers.' (the 08/10 i18n contract)
          try {
            if (typeof window !== 'undefined') {
              const packs = window.__KB_I18N_PACKS__ = window.__KB_I18N_PACKS__ || []
              let p = packs.find((x) => x.id === NAME)
              if (p === undefined) { p = { id: NAME, keys: {} }; packs.push(p) }
              for (const k of Object.keys(PACK_STRINGS)) {
                const kk = 'workers.' + k
                if (p.keys[kk] === undefined) p.keys[kk] = PACK_STRINGS[k]
              }
            }
          } catch (e) { /* publishing is optional */ }
        })

        if (loaded.state === 'loading') return h('div', { className: 'kbwk' }, h('div', { className: 'kbwk-empty' }, kt('Chargement des workers…', 'Loading workers…')))
        if (loaded.state === 'error') {
          return h('div', { className: 'kbwk' },
            h('div', { className: 'kbwk-head' }, h('div', null, h('h4', null, 'Workers'))),
            h('div', { className: 'kbwk-banner', role: 'alert' }, h('strong', null, ic('alert'), kt('Les workers sont injoignables.', 'Workers cannot be reached.')),
              h('span', null, kt('Le serveur DSH ne répond pas sur /kybernos-workers/state. Les routes de l’hôte ne se montent qu’au démarrage : relancez DSH après l’installation.', 'The DSH server does not answer on /kybernos-workers/state. Host routes only mount at startup: restart DSH after installing.'))),
            h('div', null, h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: () => { setLoaded({ state: 'loading', data: null }); reload() } }, ic('refresh'), kt('Réessayer', 'Retry'))))
        }

        const d = loaded.data
        // de-duplicated by id: if the host returns the same id twice, the first wins
        const seen = new Set()
        const workers = []
        for (const w of d.workers) if (!seen.has(w.id)) { seen.add(w.id); workers.push(w) }

        // closed-equation counters (every worker counts exactly once)
        let ready = 0
        for (const w of workers) if (statusOf(w, busy[w.id]) === 'pret') ready += 1
        const toFix = workers.length - ready
        const anyBusy = Object.keys(busy).length > 0

        // An older Suite knows nothing of the help card's action button: the guide then gets a button of its own.
        const helpHasAction = typeof window !== 'undefined' && window.__KB_HELP__ != null && window.__KB_HELP__.Help != null && window.__KB_HELP__.actions === true

        const detail = (w, status, job) => {
          const c = (id) => control(w, id)
          const mcp = w.genre === 'mcp'
          const items = []
          const running = job != null && job.phase === 'running'
          const ask = asks[w.id]
          items.push({
            done: w.connexion === true, t: kt('Activer dans DSH', 'Turn on in DSH'),
            d: w.connexion === true ? kt('L’agent est dans votre configuration.', 'The agent is in your configuration.') : kt('DSH doit d’abord connaître cet agent. Une copie de sauvegarde de votre configuration est faite.', 'DSH has to know this agent first. A backup copy of your configuration is made.'),
            btn: w.connexion !== true ? h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'wk-activate-' + w.id, disabled: busy[w.id] !== undefined, onClick: () => activate(w) }, ic('plug'), busy[w.id] === 'activate' ? kt('Activation…', 'Turning on…') : kt('Activer', 'Turn on')) : null
          })
          if (mcp) {
            items.push({ warn: true, t: kt('Connexion gérée par ZCode', 'Sign-in handled by ZCode'), d: kt('ZCode garde sa connexion dans son propre coffre : DSH ne peut pas la lire. Seule une vraie délégation prouve qu’il répond.', 'ZCode keeps its sign-in in its own vault: DSH cannot read it. Only a real delegation proves it answers.') })
          } else {
            const bin = c('binaire')
            // The check decides whether the program is there; a job the host remembers (failed, or done long ago) must never
            // contradict it — a program installed by hand after a failed install is installed.
            const binOk = bin !== undefined && bin.etat === 'ok' && !running
            const failed = job != null && job.phase === 'error' && !binOk
            const pathMiss = job != null && job.phase === 'done' && job.surLePath === false && !binOk
            const needInstall = !binOk && ((bin !== undefined && bin.etat === 'ko') || running)
            let extra = null
            if (needInstall) {
              const inst = w.install
              const possible = inst != null && inst.possible === true
              let box = null
              if (pathMiss) {
                box = h('div', { className: 'kbwk-box', 'data-kb': 'wk-path-' + w.id }, h('p', null, h('b', null, '✓ ' + kt('Installé.', 'Installed.'))), h('p', null, kt('DSH ne le voit pas encore dans son PATH (il le lit au démarrage) : redémarrez DSH, puis « Revérifier ».', 'DSH does not see it in its PATH yet (it reads it at startup): restart DSH, then "Check again".')))
              } else if (running) {
                box = h('div', { className: 'kbwk-box' }, h('p', null, h('b', null, ic('refresh', 'spin'), ' ' + kt('Installation de ' + w.nom + ' en cours…', 'Installing ' + w.nom + '…'))), h('pre', { className: 'kbwk-log', 'data-kb': 'wk-log-' + w.id }, (job.journal || []).join('\n')), h('p', { className: 'kbwk-alt' }, kt('Vous pouvez laisser cette page : DSH revérifie dès que c’est fini.', 'You can leave this page: DSH checks again as soon as it is done.')))
              } else if (ask === 'confirm' && possible) {
                box = h('div', { className: 'kbwk-box', 'data-kb': 'wk-confirm-' + w.id }, h('p', null, h('b', null, kt('DSH va lancer cette commande sur votre ordinateur :', 'DSH will run this command on your computer:'))), cmdBox(inst.cmd),
                  h('p', { className: 'kbwk-alt' }, kt('Source : ', 'Source: ') + inst.src + kt(' (installation officielle de ' + w.nom + '). Vous pourrez revérifier ensuite.', ' (the official ' + w.nom + ' install). You can check again afterwards.') + (inst.src === 'npm' ? kt(' Utilise npm, fourni avec Node.js.', ' Uses npm, which comes with Node.js.') : '') + (w.id === 'hermes' ? kt(' Installe aussi Python, Node.js et d’autres outils : comptez plusieurs minutes.', ' Also installs Python, Node.js and other tools: allow several minutes.') : '')),
                  h('div', { className: 'kbwk-acts' }, h('button', { type: 'button', className: 'kbwk-btn accent', 'data-kb': 'wk-run-' + w.id, onClick: () => runInstall(w) }, ic('download'), kt('Lancer l’installation', 'Run the install')), h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: () => cancelAsk(w.id) }, kt('Annuler', 'Cancel'))))
              } else {
                if (pathMiss) { /* the box above says it all */ } else if (failed) box = h('div', { className: 'kbwk-box err', role: 'alert', 'data-kb': 'wk-failed-' + w.id }, h('p', null, h('b', null, kt('L’installation n’a pas abouti.', 'The install did not complete.'))), h('pre', { className: 'kbwk-log' }, (job.journal || []).slice(-8).join('\n')), h('p', null, failureText(job)))
                if (inst != null && !pathMiss) {
                  extra = h(React.Fragment, null, box,
                    h('div', { className: 'kbwk-acts', style: { marginTop: 8 } },
                      possible ? h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'wk-install-' + w.id, onClick: () => askInstall(w.id) }, ic('download'), failed ? kt('Réessayer', 'Try again') : kt('Installer ' + w.nom, 'Install ' + w.nom)) : null,
                      h('button', { type: 'button', className: 'kbwk-btn ghost', 'data-kb': 'wk-diy-' + w.id, onClick: () => diy(w.id) }, possible ? kt('Je préfère le faire moi-même', 'I would rather do it myself') : kt('Voir comment l’installer', 'See how to install it'))),
                    ask === 'diy' || !possible ? h(React.Fragment, null,
                      h('p', { style: { marginTop: 10 } }, kt('Ouvrez l’app Terminal (Cmd + Espace, tapez « Terminal »), collez cette ligne, puis appuyez sur Entrée.', 'Open the Terminal app (Cmd + Space, type "Terminal"), paste this line, then press Enter.')), cmdBox(inst.cmd),
                      inst.alt ? h('p', { className: 'kbwk-alt' }, kt('Avec Homebrew : ', 'With Homebrew: '), h('code', null, inst.alt)) : null,
                      h('p', { className: 'kbwk-alt' }, kt('Pour Mac et Linux. Sous Windows, suivez le guide officiel : ', 'For Mac and Linux. On Windows, follow the official guide: '), h('a', { href: inst.doc, target: '_blank', rel: 'noreferrer noopener' }, inst.doc))) : null)
                } else extra = box
              }
              if (box !== null && extra === null) extra = box
            }
            items.push({
              done: binOk, t: kt('Installer le programme', 'Install the program'),
              d: binOk ? kt('Trouvé : ', 'Found: ') + (bin.detail || '') : (needInstall ? '' : kt('DSH le dira après la première vérification.', 'DSH will tell after the first check.')), extra
            })
            const auth = c('auth')
            const authOk = auth !== undefined && auth.etat === 'ok'
            const authKo = auth !== undefined && auth.etat === 'ko'
            let authExtra = null
            if (authKo && w.connect != null) {
              if (w.connect.mode === 'key') {
                const have = stored[w.id] === true
                const info = { gemini: ['DSH utilise Gemini avec une clé API Google : ce connecteur ne passe pas par la connexion à un compte Google.', 'DSH uses Gemini with a Google API key: this connector does not go through a Google account sign-in.'], qwen: ['Qwen s’utilise avec la clé de votre forfait Token Plan d’Alibaba.', 'Qwen is used with the key of your Alibaba Token Plan.'] }[w.id]
                authExtra = h(React.Fragment, null,
                  info !== undefined ? h('p', null, kt(info[0], info[1]) + (w.id === 'gemini' ? kt(' Créez-la sur aistudio.google.com/apikey.', ' Create it at aistudio.google.com/apikey.') : '')) : null,
                  have && replacing[w.id] !== true
                    ? h(React.Fragment, null, h('p', { 'data-kb': 'wk-key-stored-' + w.id }, kt('Une clé est enregistrée : redémarrez DSH pour qu’elle soit prise en compte.', 'A key is saved: restart DSH so it is taken into account.')), h('div', { className: 'kbwk-acts', style: { marginTop: 6 } }, h('button', { type: 'button', className: 'kbwk-btn ghost', onClick: () => setReplacing((r) => Object.assign({}, r, { [w.id]: true })) }, kt('Remplacer la clé', 'Replace the key'))))
                    : (creds.get() !== null
                      ? h(React.Fragment, null, h('p', null, kt('Collez-la ici : DSH la range avec les identifiants de vos autres fournisseurs, sous le nom ', 'Paste it here: DSH keeps it with the credentials of your other providers, under the name '), h('code', null, w.connect.env), '.'),
                        h('div', { className: 'kbwk-cmd' }, h('input', { type: 'password', autoComplete: 'off', id: 'kbwk-key-' + w.id, 'data-kb': 'wk-key-' + w.id, placeholder: kt('Votre clé API', 'Your API key'), 'aria-label': kt('Votre clé API', 'Your API key'), value: typed[w.id] || '', onChange: (e) => { const v = e.target.value; setTyped((t) => Object.assign({}, t, { [w.id]: v })) }, onKeyDown: (e) => { if (e.key === 'Enter') saveKey(w) } }),
                          h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'wk-savekey-' + w.id, onClick: () => saveKey(w) }, kt('Enregistrer la clé', 'Save the key'))))
                      : h('p', null, kt('Ajoutez la clé dans les identifiants de DSH, sous le nom ', 'Add the key to DSH’s credentials, under the name '), h('code', null, w.connect.env), '.')))
              } else {
                authExtra = h(React.Fragment, null,
                  h('p', null, kt('La connexion se fait avec votre compte : DSH ne peut pas la faire à votre place. Dans le Terminal, tapez ceci puis Entrée. ', 'Signing in uses your account: DSH cannot do it for you. In the Terminal, type this then press Enter. ') + ({
                    'claude-code': kt('Une page s’ouvre dans votre navigateur : connectez-vous avec votre compte Claude.', 'A page opens in your browser: sign in with your Claude account.'),
                    codex: kt('Choisissez « Sign in with ChatGPT » : votre navigateur s’ouvre.', 'Choose "Sign in with ChatGPT": your browser opens.'),
                    opencode: kt('Choisissez un fournisseur dans la liste, puis collez votre clé.', 'Pick a provider from the list, then paste your key.'),
                    hermes: kt('Choisissez un fournisseur ; « Nous Portal » ouvre une page de connexion.', 'Pick a provider; "Nous Portal" opens a sign-in page.')
                  }[w.id] || '')), cmdBox(w.connect.cmd))
              }
            }
            items.push({
              done: authOk, t: kt('Se connecter', 'Sign in'),
              d: authOk ? (w.connect != null && w.connect.mode === 'key' ? kt('Clé API trouvée.', 'API key found.') : kt('Connecté.', 'Signed in.')) : (authKo ? '' : kt('Votre compte ou votre clé, jamais ceux de DSH.', 'Your account or your key, never DSH’s.')), extra: authExtra
            })
          }
          items.push({
            done: status === 'pret', t: kt('Vérifier', 'Check'),
            d: status === 'pret' ? kt('5 contrôles sur 5. Rien n’a été dépensé : aucun modèle n’est appelé.', '5 checks out of 5. Nothing was spent: no model is called.') : kt('Cinq contrôles, sans appeler d’IA : rien n’est dépensé sur votre abonnement.', 'Five checks, without calling an AI: nothing is spent on your subscription.'),
            btn: w.connexion === true ? h('button', { type: 'button', className: 'kbwk-btn ghost', 'data-kb': 'wk-check-' + w.id, disabled: busy[w.id] !== undefined, onClick: () => checkOne(w.id) }, ic('refresh', busy[w.id] === 'check' ? 'spin' : ''), busy[w.id] === 'check' ? kt('Vérification…', 'Checking…') : (w.dernier != null ? kt('Revérifier', 'Check again') : kt('Vérifier', 'Check'))) : null
          })
          const cur = w.connexion !== true ? 0 : (w.dernier == null ? items.length - 1 : items.findIndex((x) => !x.done && !x.warn))
          const restartNote = status === 'a-relancer' ? h('p', { className: 'kbwk-note', 'data-kb': 'wk-restart-' + w.id }, kt('La connexion est dans le profil mais son paquet n’est pas chargé : relancez DSH (panneau Kybernos Suite › Relancer DSH), puis « Revérifier ».', 'The connection is in the profile but its package is not loaded: restart DSH (Kybernos Suite panel › Restart DSH), then "Check again".')) : null
          return h(React.Fragment, null, restartNote, h('ol', { className: 'kbwk-todo', 'data-kb': 'wk-todo-' + w.id }, items.map((x, i) => h('li', { key: i, className: x.done ? 'done' : (i === cur || x.warn ? 'cur' : 'wait') },
            h('span', { className: 'kbwk-n' }, x.done ? '✓' : (x.warn ? '?' : i + 1)),
            h('div', null, h('b', null, x.t), x.d ? h('p', null, x.d) : null, x.extra || null, x.btn ? h('div', { className: 'kbwk-acts', style: { marginTop: 7 } }, x.btn) : null)))))
        }

        const policyBlock = (w, draft, current, changed) => {
          if (w.genre !== 'connexion' || w.connexion !== true) return null
          if (w.ligne != null && w.ligne.nous !== true) {
            return h('div', { className: 'kbwk-pol' }, h('h5', null, kt('Autorisations', 'Permissions')),
              h('p', { className: 'kbwk-note' }, kt('Une ligne d’outil définie ailleurs dans votre profil gère déjà cet agent (' + w.ligne.id + ') : exposé ' + (w.ligne.expose ? 'oui' : 'non') + ', arrière-plan ' + (w.ligne.arrierePlan ? 'oui' : 'non') + '. Elle reste à modifier à la main.',
                'A tool line defined elsewhere in your profile already handles this worker (' + w.ligne.id + '): exposed ' + (w.ligne.expose ? 'yes' : 'no') + ', background ' + (w.ligne.arrierePlan ? 'yes' : 'no') + '. Edit it by hand.')))
          }
          const occ = busy[w.id]
          const setDraft = (key) => setDrafts((b) => Object.assign({}, b, { [w.id]: Object.assign({}, draft, { [key]: !draft[key] }, key === 'expose' && draft.expose ? { background: false } : {}) }))
          return h('div', { className: 'kbwk-pol' }, h('h5', null, kt('Autorisations', 'Permissions')),
            h('div', { className: 'kbwk-prow' }, h('div', null, h('b', null, kt('L’agent principal peut lui confier des tâches', 'The main agent can hand it tasks')), h('p', null, kt('Sans cet interrupteur, ' + w.nom + ' reste installé mais personne ne l’appelle.', 'Without this switch, ' + w.nom + ' stays installed but nobody calls it.'))),
              swtch({ on: draft.expose, label: kt('Exposé à l’agent principal', 'Exposed to the main agent'), title: kt('Exposé à l’agent principal — il peut lui déléguer des tâches.', 'Exposed to the main agent — it can delegate tasks to it.'), disabled: occ !== undefined, kb: 'wk-' + w.id + '-expose', onClick: () => setDraft('expose') })),
            h('div', { className: 'kbwk-prow' }, h('div', null, h('b', null, kt('Il peut travailler en arrière-plan', 'It can work in the background')), h('p', null, kt('Vous continuez la conversation pendant qu’il avance, le résultat revient tout seul.', 'You keep the conversation going while it works, and the result comes back by itself.'))),
              swtch({ on: draft.background, label: kt('Arrière-plan autorisé', 'Background allowed'), title: kt('Arrière-plan autorisé — il peut lancer une délégation sans attendre son résultat.', 'Background allowed — it can start a delegation without waiting for its result.'), disabled: !draft.expose || occ !== undefined, kb: 'wk-' + w.id + '-background', onClick: () => setDraft('background') })),
            h('div', { className: 'kbwk-acts' }, h('button', { type: 'button', className: 'kbwk-btn accent', 'data-kb': 'wk-apply-' + w.id, disabled: !changed || occ !== undefined, onClick: () => apply(w, draft) }, occ === 'apply' ? ic('refresh', 'spin') : null, kt('Enregistrer', 'Save')), h('span', { className: 'kbwk-note' }, kt('DSH applique le changement en quelques secondes.', 'DSH applies the change in a few seconds.'))))
        }

        const item = (w) => {
          const occ = busy[w.id]
          const status = statusOf(w, occ)
          const job = jobs[w.id]
          const installing = job != null && job.phase === 'running'
          const current = currentPolicy(w)
          const draft = drafts[w.id] || current
          const changed = draft.expose !== current.expose || draft.background !== current.background
          const mine = w.genre === 'connexion' && w.connexion === true && (w.ligne == null || w.ligne.nous === true)
          const isOpen = open[w.id] === true
          const msg = msgs[w.id]
          const sub = sublineOf(w, status)
          const toDetail = (label, kb) => h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': kb, onClick: () => show(w.id) }, label)
          let ctl
          if (occ === 'check') ctl = h('button', { type: 'button', className: 'kbwk-btn', disabled: true }, ic('refresh', 'spin'), kt('Vérification…', 'Checking…'))
          else if (occ === 'activate') ctl = h('button', { type: 'button', className: 'kbwk-btn', disabled: true }, ic('refresh', 'spin'), kt('Activation…', 'Turning on…'))
          else if (status === 'inactive') ctl = h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'wk-activate-row-' + w.id, onClick: () => activate(w) }, ic('plug'), kt('Activer', 'Turn on'))
          else if (status === 'unknown') ctl = h('button', { type: 'button', className: 'kbwk-btn', 'data-kb': 'wk-check-row-' + w.id, onClick: () => checkOne(w.id) }, ic('refresh'), kt('Vérifier', 'Check'))
          else if (installing) ctl = h('button', { type: 'button', className: 'kbwk-btn', disabled: true }, ic('refresh', 'spin'), kt('Installation…', 'Installing…'))
          else if (status === 'pret') {
            ctl = h(React.Fragment, null,
              mine ? h('span', { className: 'kbwk-swl' }, kt('Autorisé', 'Allowed'), swtch({ on: draft.expose, label: kt('Autorisé', 'Allowed'), title: kt('Autorisé : l’agent principal peut confier des tâches à cet agent.', 'Allowed: the main agent can hand tasks to this agent.'), kb: 'wk-row-' + w.id + '-expose', onClick: () => setDrafts((b) => Object.assign({}, b, { [w.id]: Object.assign({}, draft, { expose: !draft.expose }, draft.expose ? { background: false } : {}) })) })) : null,
              mine && changed ? h('button', { type: 'button', className: 'kbwk-btn accent', 'data-kb': 'wk-apply-row-' + w.id, onClick: () => apply(w, draft) }, kt('Enregistrer', 'Save'))
                : h('button', { type: 'button', className: 'kbwk-btn ghost ico', 'data-kb': 'wk-recheck-' + w.id, title: kt('Revérifier', 'Check again'), 'aria-label': kt('Revérifier', 'Check again'), onClick: () => checkOne(w.id) }, ic('refresh')))
          } else if (status === 'binaire-absent') ctl = toDetail(h(React.Fragment, null, ic('download'), kt('Installer', 'Install')), 'wk-todo-row-' + w.id)
          else if (status === 'non-connecte') ctl = toDetail(kt('Se connecter', 'Sign in'), 'wk-todo-row-' + w.id)
          else ctl = toDetail(kt('Que faire ?', 'What to do?'), 'wk-todo-row-' + w.id)

          return h('li', { key: w.id, className: 'kbwk-item', 'data-kb': 'wk-card-' + w.id, 'data-ouvert': isOpen ? '1' : '0' },
            rowView({ id: w.id, logoId: w.id, name: w.nom, sub, status: STATUS[status] || STATUS.unknown, steps: stepsOf(w, occ), ctl, toggle: () => toggle(w.id), open: isOpen }),
            // messages stay visible with the detail folded: they answer a click on the row
            msg != null && msg.text !== '' ? h('p', { className: 'kbwk-msg ' + msg.type, role: msg.type === 'bad' ? 'alert' : 'status' }, msg.text) : null,
            // the detail is ALWAYS in the DOM (folded by CSS), so its text and buttons exist for tests and screen readers
            h('div', { className: 'kbwk-detail' },
              detail(w, status, job),
              policyBlock(w, draft, current, changed),
              h('details', { className: 'kbwk-tech' }, h('summary', null, kt('Détails techniques', 'Technical details')),
                w.dernier != null && Array.isArray(w.dernier.controles)
                  ? h(React.Fragment, null, h('ul', { className: 'kbwk-ev' }, w.dernier.controles.map((c) => h('li', { key: c.id, className: c.etat },
                    h('span', { 'aria-hidden': 'true' }, c.etat === 'ok' ? '✓' : (c.etat === 'ko' ? '✗' : '?')),
                    h('span', null, controlLabel(c, w), c.detail ? h('small', null, ' · ' + c.detail) : null)))),
                    h('p', { className: 'kbwk-note', style: { marginTop: 6 } }, kt('Dernier contrôle : ', 'Last check: ') + new Date(w.dernier.quand).toLocaleString()))
                  : h('p', { className: 'kbwk-note', style: { marginTop: 6 } }, kt('Pas encore vérifié.', 'Not checked yet.')))))
        }

        return h('div', { className: 'kbwk' },
          h('div', { className: 'kbwk-page' },
            h('div', { className: 'kbwk-head' },
              h('div', null, h('h4', null, 'Workers'),
                h('p', null, kt('Des assistants de code installés sur votre ordinateur. Votre agent principal peut leur confier des tâches pendant que vous faites autre chose.', 'Coding assistants installed on your computer. Your main agent can hand them tasks while you do something else.'))),
              h('span', { className: 'kbwk-hbtn' },
                typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-workers', action: { label: kt('Essayer la démo', 'Try the demo'), onClick: () => setGuide(true) } }) : null,
                !helpHasAction ? h('button', { type: 'button', className: 'kbwk-btn ghost big', 'data-kb': 'wk-guide', onClick: () => setGuide(true) }, kt('Guide et démo', 'Guide and demo')) : null,
                h('button', { type: 'button', className: 'kbwk-btn ghost big', 'data-kb': 'wk-all', disabled: anyBusy, onClick: checkAll }, ic('refresh', anyBusy ? 'spin' : ''), kt('Tout vérifier', 'Check all')))),
            h('div', { className: 'kbwk-count' }, h('span', null, h('b', null, ready), ' ' + kt(ready > 1 ? 'prêts' : 'prêt', 'ready')), h('span', null, h('b', null, toFix), ' ' + kt('à régler', 'to fix'))),
            pending > 0 ? h('div', { className: 'kbwk-relance', role: 'status' }, h('b', null, kt('Changement en attente. ', 'Change pending. ')), kt('Relancez DSH pour l’appliquer (panneau Kybernos Suite › Relancer DSH).', 'Restart DSH to apply it (Kybernos Suite panel › Restart DSH).')) : null,
            h('ul', { className: 'kbwk-list', role: 'list' }, workers.map(item)),
            h('p', { className: 'kbwk-note' }, kt('Vérifier n’appelle aucun modèle : cela ne dépense rien sur l’abonnement de l’agent. « Prêt » veut dire que tout ce qui se vérifie gratuitement est bon ; la première vraie tâche reste le test final.', 'Checking calls no model, so it spends nothing on the worker’s subscription. "Ready" means everything checkable without spending is fine; the first real delegation remains the final test.')),
            h('p', { className: 'kbwk-note' }, kt('Le modèle, le niveau de permissions et la durée des runs se règlent dans l’outil de chaque agent : les connexions de DSH n’exposent pas ces réglages. Profil : ' + d.profil + ' · ', 'Model, permission level and run duration are set in each agent’s own tool: DSH’s connections do not expose them. Profile: ' + d.profil + ' · '), h('code', null, d.patch))),
          guide ? h(Guide, { onClose: () => setGuide(false) }) : null)
      }
    }

    const mount = (ctx, scope, creds) => {
      try {
        const slots = scope.slots
        if (slots == null || typeof slots.inject !== 'function') return
        const React = typeof require === 'function' ? require('react') : null
        if (React == null) return
        ctx.effect(() => { const s = document.createElement('style'); s.dataset.plugin = '@local/kybernos-workers'; s.textContent = CSS; document.head.appendChild(s); return () => s.remove() }, 'kybernos-workers: styles')
        ctx.effect(() => {
          const holder = document.createElement('div')
          holder.setAttribute('aria-hidden', 'true'); holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
          holder.innerHTML = LOGOS; document.body.appendChild(holder)
          return () => holder.remove()
        }, 'kybernos-workers: logos')
        const Panel = buildPanel(React, creds)
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-workers', order: 30, label: 'Workers' },
          () => React.createElement(Panel))), 'kybernos-workers: section')
      } catch (e) { /* the section is optional */ }
    }

    // The page needs the Settings slots, and only them. The credentials service (to store an API key) is asked for
    // on its own: an engine without it just means the page tells where to put a key instead of asking for it.
    const start = (ctx) => {
      const found = { service: null }
      const creds = {
        get: () => {
          try {
            const c = found.service !== null ? found.service : (ctx.remote != null ? ctx.remote.credentials : null)
            return c != null && typeof c.set === 'function' ? c : null
          } catch (e) { return null }
        }
      }
      try { ctx.inject(['slots'], (scope) => { mount(ctx, scope || {}, creds) }) } catch (e) { /* optional */ }
      try {
        ctx.inject(['remote', 'remote.credentials'], (scope) => {
          try { const c = scope != null && scope.remote != null ? scope.remote.credentials : null; if (c != null && typeof c.set === 'function') found.service = c } catch (e) { /* no credentials service */ }
        })
      } catch (e) { /* optional */ }
    }

    return { name: NAME, inject: [], apply: start, __test: { STATUS, statusOf, stepsOf, controlLabel, currentPolicy, sublineOf, failureText, refusalText, identityLine, PACK_STRINGS, kt } }
  }
})
