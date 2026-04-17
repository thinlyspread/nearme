// OpenStreetMap (Overpass API) helpers for finding real road geometry within a
// radius. We use this to bias sampling onto actual roads rather than random 2D
// points, which is especially important for rural areas where most random
// points land in fields.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Highway types that are game-appropriate. We exclude motorways, trunks,
// footways, cycleways, paths, and pedestrian-only areas — Street View either
// isn't there or the resulting questions aren't fun to guess.
const PLAYABLE_HIGHWAYS = [
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
];

/**
 * Query Overpass for playable road ways within radius, and return a flat list
 * of {lat, lng} points sampled along their geometry.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @param {object} opts
 * @param {number} [opts.maxPoints=100]   - total points to return
 * @param {number} [opts.maxPerRoad=8]    - cap per road so one long road can't dominate
 * @returns {Promise<Array<{lat:number,lng:number}>>}
 */
export async function fetchRoadPoints(lat, lng, radiusMeters, opts = {}) {
  const { maxPoints = 100, maxPerRoad = 8 } = opts;
  const filter = PLAYABLE_HIGHWAYS.join('|');
  const query = `[out:json][timeout:25];way(around:${radiusMeters},${lat},${lng})[highway~"^(${filter})$"];out geom;`;

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    });
    if (!res.ok) {
      console.warn('Overpass returned', res.status);
      return [];
    }
    const data = await res.json();

    const points = [];
    for (const way of data.elements || []) {
      if (!way.geometry?.length) continue;
      const nodes = way.geometry.map(g => ({ lat: g.lat, lng: g.lon }));
      shuffle(nodes);
      points.push(...nodes.slice(0, maxPerRoad));
    }
    shuffle(points);
    return points.slice(0, maxPoints);
  } catch (err) {
    console.warn('Overpass query failed:', err.message);
    return [];
  }
}

// Fisher-Yates
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
