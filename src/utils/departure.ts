export type DepartureWindow = 'Morning' | 'Evening'

export function matchesDepartureWindow(departure: string, window: DepartureWindow) {
  const normalized = departure.trim().replaceAll('.', '').toLowerCase()
  if (!normalized) return false
  if (normalized.includes('morning')) return window === 'Morning'
  if (normalized.includes('evening')) return window === 'Evening'

  const meridiem = normalized.match(/\b(am|pm)\b/)
  if (meridiem) return window === (meridiem[1] === 'am' ? 'Morning' : 'Evening')

  const time = normalized.match(/^(\d{1,2})(?::\d{2})?(?::\d{2})?$/)
  if (!time) return false
  const hour = Number(time[1])
  if (hour < 0 || hour > 23) return false
  return window === (hour < 12 ? 'Morning' : 'Evening')
}