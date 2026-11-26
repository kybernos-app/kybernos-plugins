#!/usr/bin/env node
// scripts/check-headless-linux.mjs: reading the container's facts and judging them, without Docker.
import { spawnSync } from 'node:child_process'
import { INSIDE, parseResults, verdict } from './check-headless-linux.mjs'

let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

const good = parseResults('noise\nRESULT install-seconds 61\nRESULT node v24.22.2\nRESULT dsh 0.2.2-alpha.2\nRESULT headless composes\nRESULT bundles 52\nRESULT web-bare-address 401\n')
check('the RESULT lines become an object and the noise is ignored', good['install-seconds'] === '61' && good.node === 'v24.22.2' && good.headless === 'composes' && Object.keys(good).length === 6)
check('a healthy set of facts has nothing wrong', verdict(good, '0.2.2-alpha.2').length === 0)
check('an install that failed is named, and says nothing else true', verdict(parseResults('RESULT install failed'), '0.2.2-alpha.2')[0] === 'the install script did not finish')
check('Node older than 24.9 is refused', verdict({ ...good, node: 'v24.8.0' }, '0.2.2-alpha.2').some((m) => /older than 24\.9/.test(m)) && verdict({ ...good, node: 'v22.23.4' }, '0.2.2-alpha.2').length > 0 && verdict({ ...good, node: 'v24.9.0' }, '0.2.2-alpha.2').length === 0)
// From DSH 0.2.3-alpha.1 the engine declares a Node RANGE (`dsh.node.ranges` of dsh-compat.json): Node 24.22.2 is fine for 0.2.2 and not for 0.2.3-alpha.2.
const EXIGENCE = { min: '24.9.0', from: '0.2.2-alpha.2', ranges: [{ from: '0.2.3-alpha.1', node: '^24.22.3 || >=26.13.1' }] }
const goodA2 = { ...good, dsh: '0.2.3-alpha.2' }
check('on a 0.2.2 engine Node 24.22.2 still fits, with or without the ranges', verdict(good, '0.2.2-alpha.2', EXIGENCE).length === 0 && verdict(good, '0.2.2-alpha.2').length === 0)
check('on 0.2.3-alpha.2 Node 24.22.2 is refused with the range that applies', verdict({ ...goodA2, node: 'v24.22.2' }, '0.2.3-alpha.2', EXIGENCE).some((m) => /does not fit DSH 0\.2\.3-alpha\.2.*\^24\.22\.3/.test(m)))
check('on 0.2.3-alpha.2 Node 24.22.3 and 26.13.1 fit, 26.7.0 and 25.1.0 do not', ['v24.22.3', 'v26.13.1'].every((n) => verdict({ ...goodA2, node: n }, '0.2.3-alpha.2', EXIGENCE).length === 0) && ['v26.7.0', 'v25.1.0'].every((n) => verdict({ ...goodA2, node: n }, '0.2.3-alpha.2', EXIGENCE).length === 1))
check('another engine version than dsh-compat.json allows is refused', verdict({ ...good, dsh: '0.2.1-rc.2' }, '0.2.2-alpha.2').some((m) => /dsh-compat/.test(m)))
check('a headless profile that does not compose is refused', verdict({ ...good, headless: 'broken' }, '0.2.2-alpha.2').length === 1)
check('few bundles linked is refused', verdict({ ...good, bundles: '3' }, '0.2.2-alpha.2').length === 1)
check('a web server that answers 200 on the bare address is refused (it must ask for the token)', verdict({ ...good, 'web-bare-address': '200' }, '0.2.2-alpha.2').length === 1)
check('the container script is valid shell', spawnSync('bash', ['-n'], { input: INSIDE }).status === 0)

process.exit(fails === 0 ? 0 : 1)
