// A deck as an agent would write it: plain HTML against the kit classes, charts declared as data. Illustrative numbers only.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
const chart = (cfg) => `<div class="chart-box"><canvas data-chart="${esc(JSON.stringify(cfg))}"></canvas></div>`

export const deck = {
  title: 'AI Cash-Flow Copilot: market opportunity (illustrative)',
  theme: 'dark',
  slides: [
    {
      html: `<section class="slide center">
  <div class="kicker">Market opportunity research</div>
  <h1>AI Cash-Flow Copilot</h1>
  <div class="rule"></div>
  <p class="lead">A lightweight forecasting and action layer for small businesses facing uneven liquidity.</p>
  <div class="source">Illustrative data for a proof of concept · November 2026</div>
</section>`,
      notes: 'Open with the one-line promise: forecast cash and tell the owner what to do about it.',
    },
    {
      html: `<section class="slide">
  <div class="kicker">Why now</div>
  <h2>The opening is defined by scale, persistent cash-flow pain, and almost no specialised AI</h2>
  <div class="stats">
    <div class="stat"><div class="num">36M</div><div class="label">Addressable businesses</div><p class="muted">Nearly all employer firms are small, and most have no finance team.</p></div>
    <div class="stat"><div class="num">51%</div><div class="label">Name uneven cash flow as a top challenge</div><p class="muted">Far ahead of access to credit or hiring.</p></div>
    <div class="stat"><div class="num">&lt;4%</div><div class="label">Use AI for core operations</div><p class="muted">A first-mover gap for vertical tools.</p></div>
  </div>
  <div class="source">Sources: placeholder survey figures, replace before use.</div>
</section>`,
      notes: 'Three numbers, one story: big market, real pain, empty niche.',
    },
    {
      html: `<section class="slide">
  <div class="kicker">Customers</div>
  <h2>Who feels the pain first</h2>
  <div class="cols">
    <div class="col">
      <div class="card"><h3>Local services</h3><p class="muted">Seasonal demand, invoices paid late.</p></div>
      <div class="card"><h3>Online retail</h3><p class="muted">Inventory bought months before revenue.</p></div>
      <div class="card"><h3>Agencies and studios</h3><p class="muted">Project billing with long payment terms.</p></div>
    </div>
    <div class="col">
      <h3>What they ask for</h3>
      <ul class="bullets">
        <li>A 13-week forecast they can trust</li>
        <li>An alert before the account runs short</li>
        <li>One suggested action, not a dashboard</li>
        <li>Setup in minutes, from the bank feed they already have</li>
      </ul>
    </div>
  </div>
</section>`,
    },
    {
      html: `<section class="slide">
  <div class="kicker">Revenue</div>
  <h2>A disciplined path to $13M annual recurring revenue by year five</h2>
  <div class="cols" style="margin-top:32px">
    <div class="col" style="flex:2">${chart({ type: 'bar', data: { labels: ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'], datasets: [{ label: 'ARR ($M)', data: [0.8, 2.4, 5.1, 8.7, 13.0], borderRadius: 8 }] } })}</div>
    <div class="col card" style="flex:1; justify-content:center">
      <h3>Assumptions</h3>
      <ul class="bullets">
        <li>8,000 paying firms in year five</li>
        <li>$135 average monthly plan</li>
        <li>Under 2% monthly churn</li>
      </ul>
    </div>
  </div>
  <div class="source">Illustrative projection, not a forecast.</div>
</section>`,
      notes: 'Walk the curve left to right; the point is the shape, the figures are placeholders.',
    },
    {
      html: `<section class="slide">
  <div class="kicker">Go to market</div>
  <h2>Four steps from a pilot to a repeatable channel</h2>
  <div class="timeline">
    <div class="step"><div class="dot">1</div><h3>Pilot</h3><p>20 firms in one segment, weekly interviews.</p></div>
    <div class="step"><div class="dot">2</div><h3>Prove</h3><p>Show forecasts that beat the owner's own guess.</p></div>
    <div class="step"><div class="dot">3</div><h3>Partner</h3><p>Accountants and bookkeepers as the channel.</p></div>
    <div class="step"><div class="dot">4</div><h3>Scale</h3><p>Self-serve onboarding from the bank feed.</p></div>
  </div>
  <div class="strip"><div class="ph">Pilot</div><div class="ph">Prove</div><div class="ph">Partner</div><div class="ph">Scale</div></div>
</section>`,
    },
    {
      html: `<section class="slide">
  <div class="kicker">Pricing</div>
  <h2>Three plans, priced on the number of connected accounts</h2>
  <table>
    <thead><tr><th>Plan</th><th>Accounts</th><th>Forecast horizon</th><th>Price per month</th></tr></thead>
    <tbody>
      <tr><td>Starter</td><td>1</td><td>4 weeks</td><td>$49</td></tr>
      <tr><td>Growth</td><td>5</td><td>13 weeks</td><td>$135</td></tr>
      <tr><td>Studio</td><td>20</td><td>26 weeks</td><td>$390</td></tr>
    </tbody>
  </table>
  <div class="source">Illustrative pricing.</div>
</section>`,
    },
    {
      html: `<section class="slide center">
  <div class="kicker">The ask</div>
  <blockquote>Fund a 12-week pilot with 20 businesses, then decide with real forecasts in hand.</blockquote>
  <div class="rule"></div>
  <p class="lead">Next step: pick the first segment and book the first five interviews.</p>
</section>`,
    },
  ],
}
