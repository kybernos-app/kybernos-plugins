// Test setup: the host half takes the full app list from an address set ON PURPOSE (KYBERNOS_COMPOSIO_APPS_URL), never from a built-in one.
// These tests exercise that opt-in path with the stand-in address their stubs answer; import this file FIRST (before ./index.js reads it).
process.env.KYBERNOS_COMPOSIO_APPS_URL = 'https://kybernos-proxy-production.up.railway.app/v1/connections/apps'
