export const HEATMAP_CONTROLS = {
  threshold: { label: 'threshold', min: 0, max: 1, initial: 0.08, step: 0.01 },
  decay: { label: 'decay', min: 0, max: 0.995, initial: 0.95, step: 0.005 },
  mix: { label: 'mix', min: 0, max: 1, initial: 1, step: 0.01 },
  intensity: { label: 'intensity', min: 0, max: 3, initial: 1.25, step: 0.01 },
  opacity: { label: 'video opacity', min: 0, max: 1, initial: 0, step: 0.01 },
} as const;

export type HeatmapTarget = keyof typeof HEATMAP_CONTROLS;
export type HeatmapValues = Record<HeatmapTarget, number>;

export interface MappingSettings {
  target: HeatmapTarget;
  amount: number;
  attack: number;
  release: number;
  velocitySensitive: boolean;
}

export const INITIAL_VALUES: HeatmapValues = Object.fromEntries(
  (Object.keys(HEATMAP_CONTROLS) as HeatmapTarget[]).map((target) => [
    target,
    HEATMAP_CONTROLS[target].initial,
  ]),
) as HeatmapValues;

export const INITIAL_MAPPING: MappingSettings = {
  target: 'threshold',
  amount: -0.055,
  attack: 0,
  release: 0.18,
  velocitySensitive: true,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const smoothstep = (value: number) => value * value * (3 - 2 * value);

export class MidiEnvelope {
  private active = false;
  private startTime = 0;
  private startLevel = 0;
  private peakLevel = 0;
  private currentLevel = 0;
  private attack = 0;
  private release = 0.18;

  trigger(velocity: number, settings: MappingSettings, time = performance.now() / 1000) {
    this.sample(time);
    this.startLevel = this.currentLevel;
    this.peakLevel = settings.velocitySensitive ? clamp(velocity, 0, 1) : 1;
    this.attack = Math.max(0, settings.attack);
    this.release = Math.max(0.001, settings.release);
    this.startTime = time;
    this.active = true;

    if (this.attack === 0) {
      this.currentLevel = this.peakLevel;
    }
  }

  sample(time = performance.now() / 1000) {
    if (!this.active) {
      return 0;
    }

    const elapsed = Math.max(0, time - this.startTime);
    if (this.attack > 0 && elapsed < this.attack) {
      const progress = smoothstep(clamp(elapsed / this.attack, 0, 1));
      this.currentLevel = this.startLevel + (this.peakLevel - this.startLevel) * progress;
      return this.currentLevel;
    }

    const releaseElapsed = elapsed - this.attack;
    if (releaseElapsed >= this.release) {
      this.active = false;
      this.currentLevel = 0;
      return 0;
    }

    this.currentLevel = this.peakLevel * (1 - smoothstep(clamp(releaseElapsed / this.release, 0, 1)));
    return this.currentLevel;
  }

  clear() {
    this.active = false;
    this.currentLevel = 0;
  }
}

export function sampleHeatmapValues(
  base: HeatmapValues,
  mapping: MappingSettings,
  envelope: MidiEnvelope,
): HeatmapValues {
  const values = { ...base };
  const definition = HEATMAP_CONTROLS[mapping.target];
  values[mapping.target] = clamp(
    base[mapping.target] + mapping.amount * envelope.sample(),
    definition.min,
    definition.max,
  );
  return values;
}
