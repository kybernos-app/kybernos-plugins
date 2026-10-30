// Calendar days as plain text « YYYY-MM-DD », counted in days since 1970-01-01.
//
// Integer arithmetic only (Howard Hinnant's civil-date algorithms): no Date object, so no timezone, no daylight saving and no difference between engines.
// « Today » is never read from a clock here: a caller passes it in (`ctx.today`).

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const daysFromCivil = (year, month, day) => {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

const civilFromDays = (days) => {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp < 10 ? mp + 3 : mp - 9
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day]
}

const pad = (n, width) => String(n).padStart(width, '0')

/** Days since 1970-01-01 of a « YYYY-MM-DD » text, or `null` when it is not a real calendar day (« 2026-02-30 », « 2026-13-01 », a number…). */
export const dayNumber = (text) => {
  if (typeof text !== 'string') return null
  const m = DAY.exec(text)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const n = daysFromCivil(year, month, day)
  const back = civilFromDays(n)
  return back[0] === year && back[1] === month && back[2] === day ? n : null
}

export const isDate = (text) => dayNumber(text) !== null

/** The « YYYY-MM-DD » text of a day number. */
export const fromDayNumber = (n) => {
  const [year, month, day] = civilFromDays(n)
  return pad(year, 4) + '-' + pad(month, 2) + '-' + pad(day, 2)
}

/** A day text moved by `n` days (negative goes back), or `null` when the text is not a day. */
export const addDays = (text, n) => {
  const base = dayNumber(text)
  return base === null ? null : fromDayNumber(base + n)
}
