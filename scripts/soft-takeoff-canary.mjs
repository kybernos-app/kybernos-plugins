#!/usr/bin/env node
// Canary fixtures of the soft-takeoff recette: a tester that cannot tell these two apart is not trusted with the others.
//   node scripts/soft-takeoff-canary.mjs pass   → prints a green line, exits 0
//   node scripts/soft-takeoff-canary.mjs fail   → prints a red line, exits 1 (on purpose)
const kind = process.argv[2]
if (kind === 'pass') { console.log('  ✓ canary: this one passes'); process.exit(0) }
if (kind === 'fail') { console.log('  ✗ canary: this one fails on purpose — a tester must report fail'); process.exit(1) }
console.error('usage: soft-takeoff-canary.mjs pass|fail')
process.exit(2)
