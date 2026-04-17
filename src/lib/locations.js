import { CONFIG } from './config';
import { generateRandomPointNearby, getCoordinateHash } from './geo';
import { checkStreetViewCoverage, getStreetName, analyzeImageQuality } from './api';
import { fetchFromSupabase, saveToSupabase } from './supabase';
import { fetchRoadPoints } from './osm';

// Minimum OSM points to count as a usable road-biased pool. If Overpass
// returns fewer than this (e.g. the mirrors are down, or the area is
// genuinely road-sparse) we fall back to random 2D sampling so the game
// still works — OSM is a bonus, not a hard dependency.
const MIN_OSM_POINTS = 50;

function randomSamplePoints(lat, lng) {
  const bands = [
    { minDist:  50, maxDist: 150, count: 20 },
    { minDist: 150, maxDist: 250, count: 20 },
    { minDist: 250, maxDist: 350, count: 30 },
    { minDist: 350, maxDist: 450, count: 30 },
  ];
  return bands.flatMap(b =>
    Array.from({ length: b.count }, () =>
      generateRandomPointNearby(lat, lng, b.minDist, b.maxDist)
    )
  );
}

async function processPoint(point, hash) {
  try {
    const meta = await checkStreetViewCoverage(point.lat, point.lng);
    if (meta.status !== 'OK') return null;

    const streetName = await getStreetName(point.lat, point.lng);
    if (!streetName) return null;

    const imageUrl = `/api/streetview-image?lat=${point.lat}&lng=${point.lng}`;
    const visionResult = await analyzeImageQuality(point.lat, point.lng);

    if (!visionResult.accept) {
      console.log(`\u2717 ${streetName} — score ${visionResult.score} (${visionResult.reason})`);
      return null;
    }

    console.log(`\u2713 ${streetName} — score ${visionResult.score} (${visionResult.reason})`);
    return {
      coordinate_hash:   hash,
      location_name:     streetName,
      latitude:          point.lat,
      longitude:         point.lng,
      image_url:         imageUrl,
      quality_score:     visionResult.score,
      vision_labels:     visionResult.labels,
      quality_flag:      'good',
      familiarity_score: 5,
      times_used:        0,
      types:             'random_street_view',
    };
  } catch (err) {
    console.warn('Point skipped (error):', err.message);
    return null;
  }
}

/**
 * Fetch cached locations or generate new ones.
 * @param {number} lat
 * @param {number} lng
 * @param {function} onProgress - callback(percent, text) for UI updates
 */
export async function getPointsForCoordinate(lat, lng, onProgress = () => {}) {
  const hash = getCoordinateHash(lat, lng, CONFIG.radius);

  onProgress(10, 'Checking for cached locations...');

  const cached = await fetchFromSupabase(hash);
  if (cached.length >= CONFIG.minCachedLocations) {
    onProgress(30, `Found ${cached.length} cached locations!`);
    console.log('Cache HIT:', hash, cached.length, 'rows');
    return cached;
  }

  console.log('Cache MISS:', hash);
  onProgress(12, 'Finding roads nearby...');

  const osmPoints = await fetchRoadPoints(lat, lng, CONFIG.radius, { maxPoints: 100, maxPerRoad: 8 });

  let samplePoints;
  if (osmPoints.length >= MIN_OSM_POINTS) {
    samplePoints = osmPoints;
    console.log(`OSM returned ${osmPoints.length} road-biased points`);
  } else {
    samplePoints = randomSamplePoints(lat, lng);
    console.log(`OSM returned only ${osmPoints.length} points (below ${MIN_OSM_POINTS} threshold) — falling back to ${samplePoints.length} random points`);
  }

  const totalBatches   = Math.ceil(samplePoints.length / CONFIG.batchSize);
  const validLocations = [];
  let processed        = 0;

  onProgress(20, `Checking ${samplePoints.length} points in ${totalBatches} batches...`);

  for (let i = 0; i < samplePoints.length; i += CONFIG.batchSize) {
    if (validLocations.length >= CONFIG.targetLocations) {
      console.log(`Reached target of ${CONFIG.targetLocations} — stopping early.`);
      break;
    }

    const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
    const batch    = samplePoints.slice(i, i + CONFIG.batchSize);

    const results = await Promise.all(batch.map(p => processPoint(p, hash)));
    validLocations.push(...results.filter(r => r !== null));
    processed += batch.length;

    onProgress(
      20 + (processed / samplePoints.length) * 38,
      `Batch ${batchNum}/${totalBatches} done — ${validLocations.length} locations found`
    );
  }

  onProgress(62, `Found ${validLocations.length} quality locations`);

  if (!validLocations.length) {
    throw new Error('No usable Street View images found. Try a different address.');
  }

  onProgress(72, `Saving ${validLocations.length} locations to database...`);
  const saved = await saveToSupabase(validLocations);
  onProgress(82, 'Saved!');
  return saved;
}
