/** The log viewer and anything shown on screen hide the sign-in token and model keys. */
export const redact = (text: string): string =>
  text
    .replace(/token=[^\s&"']+/g, 'token=…')
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-…')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-…')
