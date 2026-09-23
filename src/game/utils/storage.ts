import { IS_TOUCH } from '../ui/device';
import type { CarId } from '../data/cars';
import type { WeaponId } from '../data/weapons';

/** Everything persisted locally. Nothing sensitive is stored. */
export interface Settings {
  masterVolume: number; // 0..1
  sfxVolume: number; // 0..1
  cameraShake: number; // 0..1
  /** high = sun shadows + sharper image, low = faster on weak GPUs */
  quality: 'high' | 'low';
}

export interface Loadout {
  car: CarId;
  primary: WeaponId;
  secondary: WeaponId;
  laps: number;
}

export interface Records {
  /** best race time per lap count, ms */
  bestRace: Record<string, { time: number; car: CarId }>;
  bestLapTime: number | null; // ms
  bestLapCar: CarId | null;
  racesFinished: number;
  wins: number;
}

const KEY_SETTINGS = 'rageCircuit.settings.v1';
const KEY_LOADOUT = 'rageCircuit.loadout.v1';
const KEY_RECORDS = 'rageCircuit.records.v1';
const KEY_ONLINE = 'rageCircuit.online.v1';

export interface OnlinePrefs {
  name: string;
  server: string;
}

const DEFAULT_SETTINGS: Settings = { masterVolume: 0.7, sfxVolume: 0.8, cameraShake: 0.8, quality: IS_TOUCH ? 'low' : 'high' }; // phones start on the lighter setting
const DEFAULT_LOADOUT: Loadout = { car: 'viper', primary: 'machinegun', secondary: 'rocket', laps: 5 };
const DEFAULT_RECORDS: Records = {
  bestRace: {},
  bestLapTime: null,
  bestLapCar: null,
  racesFinished: 0,
  wins: 0,
};

function read<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return { ...fallback };
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode etc.) – ignore */
  }
}

let settingsCache: Settings | null = null;

export const Storage = {
  getSettings(): Settings {
    if (!settingsCache) settingsCache = read(KEY_SETTINGS, DEFAULT_SETTINGS);
    return settingsCache;
  },
  saveSettings(s: Settings): void {
    settingsCache = { ...s };
    write(KEY_SETTINGS, s);
  },
  getLoadout(): Loadout {
    return read(KEY_LOADOUT, DEFAULT_LOADOUT);
  },
  saveLoadout(l: Loadout): void {
    write(KEY_LOADOUT, l);
  },
  getRecords(): Records {
    return read(KEY_RECORDS, DEFAULT_RECORDS);
  },
  saveRecords(r: Records): void {
    write(KEY_RECORDS, r);
  },
  getOnline(fallbackServer: string): OnlinePrefs {
    return read(KEY_ONLINE, { name: '', server: fallbackServer });
  },
  saveOnline(o: OnlinePrefs): void {
    write(KEY_ONLINE, o);
  },
};
