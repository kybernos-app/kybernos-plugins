// token.mjs — signed, expiring tokens, and the owner's API token. The code is kybernos-db's (remote/token.mjs): one copy, shared with the side that mints the owner's API token,
// and reached from here like everything else of kybernos-db, through lib/db.mjs.
export { hexKey, mintOwnerApiToken, signToken, verifyOwnerApiToken, verifyToken } from './db.mjs'
