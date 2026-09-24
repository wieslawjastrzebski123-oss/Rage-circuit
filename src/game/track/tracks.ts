import { CANYON_RUN } from './CanyonRun';
import { Track } from './Track';
import { INDUSTRIAL_DISTRICT, type TrackDef, type TrackId } from './TrackData';

/** Every circuit in the game, in menu order. */
export const TRACKS: Record<TrackId, TrackDef> = {
  industrial: INDUSTRIAL_DISTRICT,
  canyon: CANYON_RUN,
};
export const TRACK_IDS = Object.keys(TRACKS) as TrackId[];

export function isTrackId(v: unknown): v is TrackId {
  return typeof v === 'string' && v in TRACKS;
}

const cache = new Map<TrackId, Track>();

/** Built once per circuit (sampling, AI routes and lookup grids take a moment). */
export function getTrack(id: TrackId): Track {
  let t = cache.get(id);
  if (!t) {
    t = new Track(TRACKS[id]);
    cache.set(id, t);
  }
  return t;
}
