// mailer.mjs — the port that sends an invitation. The app is given one; this default sends nothing and says so, so the owner copies the link themselves.
// A real mailer is `{ send({ to, link, role, expires }) → Promise<{ sent: boolean }> }`: it may throw, and the app then answers as if nothing was sent.
export const linkOnlyMailer = Object.freeze({ send: async () => ({ sent: false }) })
