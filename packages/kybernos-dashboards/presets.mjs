// kybernos-dashboards: the dashboards that ship with the plugin. Each is a template: using one gives the person their own
// copy, which they change by chatting. Only sources that exist on every machine are used here (no connected app needed).
// Plain data, validated by model.mjs like any dashboard (test-presets.mjs checks every one against the real catalogue).

export const PRESETS = [
  {
    id: 'usage-tokens',
    name: 'Usage and tokens',
    desc: 'What your own keys and local models use, by day, model and session.',
    widgets: [
      { type: 'card', title: 'Tokens, 14 days', source: { provider: 'usage.daily', params: { days: 14 } }, metric: { agg: 'sum', field: 'tokens' }, format: 'compact', sub: { template: '{v} output tokens', metric: { agg: 'sum', field: 'output' } }, spark: { x: 'day', y: 'tokens', agg: 'sum' }, w: 3, h: 2 },
      { type: 'card', title: 'Models used', source: { provider: 'usage.daily', params: { days: 14 } }, metric: { agg: 'distinct', field: 'model' }, sub: { template: 'in the last 14 days' }, w: 3, h: 2 },
      { type: 'card', title: 'Cache read', source: { provider: 'usage.daily', params: { days: 14 } }, metric: { agg: 'sum', field: 'cache_read' }, format: 'compact', sub: { template: 'tokens served from cache' }, w: 3, h: 2 },
      { type: 'card', title: 'Sessions', source: { provider: 'usage.sessions', params: { days: 14 } }, metric: { agg: 'count' }, sub: { template: 'used tokens in 14 days' }, w: 3, h: 2 },
      { type: 'chart', title: 'Tokens per day', kind: 'stacked', x: 'day', y: 'tokens', series: 'model', agg: 'sum', source: { provider: 'usage.daily', params: { days: 14 } }, w: 8, h: 4 },
      { type: 'chart', title: 'By provider', kind: 'donut', x: 'provider', y: 'tokens', agg: 'sum', source: { provider: 'usage.daily', params: { days: 14 } }, w: 4, h: 4 },
      { type: 'chart', title: 'Tokens by model', kind: 'bars', x: 'model', y: 'tokens', agg: 'sum', limit: 8, source: { provider: 'usage.daily', params: { days: 14 } }, w: 6, h: 4 },
      { type: 'list', title: 'Busiest sessions', label: 'title', sub: 'day', when: 'seen', source: { provider: 'usage.sessions', params: { days: 14 } }, sort: '-tokens', limit: 8, w: 6, h: 4 },
    ],
  },
  {
    id: 'automations-health',
    name: 'Automations health',
    desc: 'Runs, failures and what is planned this week.',
    widgets: [
      { type: 'card', title: 'Runs, 14 days', source: { provider: 'automations.runs', params: { days: 14 } }, metric: { agg: 'count' }, sub: { template: '{v} failed', metric: { agg: 'count', where: [{ field: 'state', op: '=', value: 'failed' }] }, warnAbove: 0 }, spark: { x: 'day', agg: 'count' }, w: 3, h: 2 },
      { type: 'card', title: 'Automations', source: { provider: 'automations.list' }, metric: { agg: 'count' }, sub: { template: '{v} paused', metric: { agg: 'count', where: [{ field: 'active', op: '=', value: 'no' }] } }, w: 3, h: 2 },
      { type: 'card', title: 'Failing now', source: { provider: 'automations.list' }, metric: { agg: 'count', where: [{ field: 'state', op: '=', value: 'failed' }] }, alertAbove: 0, sub: { template: 'last run failed' }, w: 3, h: 2 },
      { type: 'card', title: 'Never run', source: { provider: 'automations.list' }, metric: { agg: 'count', where: [{ field: 'state', op: '=', value: 'none' }] }, sub: { template: 'active, no run yet' }, w: 3, h: 2 },
      { type: 'chart', title: 'Runs per day', kind: 'stacked', x: 'day', series: 'state', agg: 'count', source: { provider: 'automations.runs', params: { days: 14 } }, w: 8, h: 4 },
      { type: 'chart', title: 'Runs by automation', kind: 'donut', x: 'automation', agg: 'count', source: { provider: 'automations.runs', params: { days: 14 } }, w: 4, h: 4 },
      { type: 'calendar', title: 'This week', source: { provider: 'automations.timeline' }, at: 'at', label: 'automation', state: 'state', w: 8, h: 5 },
      { type: 'list', title: 'Latest runs', label: 'automation', sub: 'error', when: 'at', state: 'state', source: { provider: 'automations.runs', params: { days: 14 } }, sort: '-at', limit: 10, failedChip: true, w: 4, h: 5 },
      { type: 'kanban', title: 'By last result', groupBy: 'state', label: 'name', sub: 'last', columns: [{ value: 'failed', label: 'Last run failed' }, { value: 'done', label: 'Last run done' }, { value: 'none', label: 'Never run' }, { value: 'paused', label: 'Paused' }], source: { provider: 'automations.list' }, w: 12, h: 4 },
    ],
  },
  {
    id: 'agent-teams',
    name: 'Agent Teams',
    desc: 'Your Agent Teams, what they know and what they learned.',
    widgets: [
      { type: 'card', title: 'Teams defined', source: { provider: 'teams.list' }, metric: { agg: 'count' }, sub: { template: '{v} declared skills', metric: { agg: 'sum', field: 'skills' } }, w: 3, h: 2 },
      { type: 'card', title: 'Lessons recorded', source: { provider: 'teams.lessons' }, metric: { agg: 'sum', field: 'lessons' }, sub: { template: '{v} runs in total', metric: { agg: 'sum', field: 'runs' } }, w: 3, h: 2 },
      { type: 'card', title: 'Skills installed', source: { provider: 'skills.list' }, metric: { agg: 'count' }, sub: { template: '{v} switched off', metric: { agg: 'count', where: [{ field: 'active', op: '=', value: 'no' }] } }, w: 3, h: 2 },
      { type: 'card', title: 'Roles', source: { provider: 'teams.list' }, metric: { agg: 'sum', field: 'roles' }, sub: { template: 'across all teams' }, w: 3, h: 2 },
      { type: 'chart', title: 'Lessons per team', kind: 'bars', x: 'team', y: 'lessons', agg: 'sum', source: { provider: 'teams.lessons' }, w: 6, h: 4 },
      { type: 'chart', title: 'Declared skills per team', kind: 'bars', x: 'team', y: 'skills', agg: 'sum', source: { provider: 'teams.list' }, w: 6, h: 4 },
      { type: 'list', title: 'Agent Teams', label: 'team', sub: 'mission', source: { provider: 'teams.list' }, limit: 12, w: 12, h: 5 },
    ],
  },
  {
    id: 'workspace-pulse',
    name: 'Workspace pulse',
    desc: 'Sessions, deliverables and where the tokens go, at a glance.',
    widgets: [
      { type: 'card', title: 'Sessions with runs', source: { provider: 'sessions.runs', params: { limit: 100 } }, metric: { agg: 'count' }, sub: { template: '{v} runs', metric: { agg: 'sum', field: 'runs' } }, w: 3, h: 2 },
      { type: 'card', title: 'Deliverables', source: { provider: 'deliverables.list', params: { limit: 60 } }, metric: { agg: 'count' }, sub: { template: 'files made by your teams' }, w: 3, h: 2 },
      { type: 'chart', title: 'Runs per day', kind: 'columns', x: 'day', y: 'runs', agg: 'sum', source: { provider: 'sessions.runs', params: { limit: 100 } }, w: 6, h: 4 },
      { type: 'sankey', title: 'Where tokens go, 14 days', stages: ['provider', 'model'], value: 'tokens', source: { provider: 'usage.daily', params: { days: 14 } }, w: 8, h: 5 },
      { type: 'carousel', title: 'Latest deliverables', label: 'name', sub: 'workspace', kind: 'kind', source: { provider: 'deliverables.list', params: { limit: 12 } }, limit: 12, w: 12, h: 3 },
      { type: 'note', title: 'Notes', text: 'Write what matters here. Notes live in this dashboard.', tint: 'amber', w: 4, h: 3 },
    ],
  },
]
