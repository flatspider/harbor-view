const SYNODIC_MONTH = 29.53058868;
const KNOWN_NEW_MOON_JD = 2451550.1;

function toJulianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export interface MoonPhaseInfo {
  phase: number;
  illumination: number;
  phaseName: string;
  isSpringTide: boolean;
}

const PHASE_NAMES = [
  "New Moon",
  "Waxing Crescent",
  "First Quarter",
  "Waxing Gibbous",
  "Full Moon",
  "Waning Gibbous",
  "Last Quarter",
  "Waning Crescent",
] as const;

export function computeMoonPhase(date: Date): MoonPhaseInfo {
  const jd = toJulianDate(date);
  const daysSinceKnown = jd - KNOWN_NEW_MOON_JD;
  const phase = ((daysSinceKnown % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH / SYNODIC_MONTH;

  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2;

  const octant = Math.floor(phase * 8) % 8;
  const phaseName = PHASE_NAMES[octant];

  const isSpringTide = phase < 0.1 || phase > 0.9 || Math.abs(phase - 0.5) < 0.1;

  return { phase, illumination, phaseName, isSpringTide };
}
