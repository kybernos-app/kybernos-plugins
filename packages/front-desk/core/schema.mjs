// A tiny JSON-schema subset: enough to check the parameters of the closed action menu, with no dependency.
// Supported: type object (properties, required; any other key is refused), string (minLength, maxLength, pattern, enum),
// integer (minimum, maximum), boolean. Strings come back cleaned: control characters out, trimmed.

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** `{ ok, errors, value }`: `value` is the cleaned copy, only meaningful when `ok`. */
export function validate(schema, input, at = '$') {
  const errors = [];
  const value = check(schema, input, at, errors);
  return { ok: errors.length === 0, errors, value };
}

function check(schema, input, at, errors) {
  switch (schema.type) {
    case 'object': {
      if (input === null || typeof input !== 'object' || Array.isArray(input)) { errors.push(`${at}: object expected`); return undefined; }
      const props = schema.properties || {};
      const out = {};
      for (const key of Object.keys(input)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) errors.push(`${at}.${key}: not allowed`);
      }
      for (const key of Object.keys(props)) {
        if (input[key] === undefined) continue;
        out[key] = check(props[key], input[key], `${at}.${key}`, errors);
      }
      for (const key of schema.required || []) if (input[key] === undefined) errors.push(`${at}.${key}: required`);
      return out;
    }
    case 'string': {
      if (typeof input !== 'string') { errors.push(`${at}: string expected`); return undefined; }
      const s = input.replace(CONTROL, '').trim();
      if (schema.minLength !== undefined && s.length < schema.minLength) errors.push(`${at}: too short`);
      if (schema.maxLength !== undefined && s.length > schema.maxLength) errors.push(`${at}: too long`);
      if (schema.enum && !schema.enum.includes(s)) errors.push(`${at}: not one of the allowed values`);
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(s)) errors.push(`${at}: wrong format`);
      return s;
    }
    case 'integer': {
      if (!Number.isInteger(input)) { errors.push(`${at}: integer expected`); return undefined; }
      if (schema.minimum !== undefined && input < schema.minimum) errors.push(`${at}: too small`);
      if (schema.maximum !== undefined && input > schema.maximum) errors.push(`${at}: too large`);
      return input;
    }
    case 'boolean':
      if (typeof input !== 'boolean') { errors.push(`${at}: boolean expected`); return undefined; }
      return input;
    default:
      errors.push(`${at}: unsupported schema type`);
      return undefined;
  }
}
