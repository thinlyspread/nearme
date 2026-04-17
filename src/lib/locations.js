import { CONFIG } from './config';
import { generateRandomPointNearby, getCoordinateHash } from './geo';
import { checkStreetViewCoverage, getStreetName, analyzeImageQuality } from './api';
import { fetchFromSupabase, saveToSupabase } from './supabase';
import { fetchRoadPoints } from './osm';

// Total candidate samples we aim for each search. OSM contributes whatever
// it can (0 for rural or when Overpass is down, 60-ish for dense urban),
// and we top up the rest with random 2D points so the candidate count is
// always the same — urban doesn't lose its historical sample count, rural
// gets road bias on top.
const TOTAL_SAMPLE_POINTS = 100;

function randomSamplePoints(lat, lng, count) {
  // Four equal-sized bands from 50m to 450m, roughly matching the old
  // generator's distribution but scaled to the requested count.
  const perBand = Math.ceil(count / 4);
  const bands = [
    { minDist:  50, maxDist: 150 },
    { minDist: 150, maxDist: 250 },
    { minDist: 250, maxDist: 350 },
    { minDist: 350, maxDist: 450 },
  ];
  const points = bands.flatMap(b =>
    Array.from({ length: perBand }, () =>
      generateRandomPointNearby(lat, lng, b.minDist, b.maxDist)
    )
  );
  return points.slice(0, count);
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

  const osmPoints = await fetchRoadPoints(lat, lng, CONFIG.radius, { maxPoints: TOTAL_SAMPLE_POINTS, maxPerRoad: 8 });
  const needed = Math.max(0, TOTAL_SAMPLE_POINTS - osmPoints.length);
  const randomPoints = needed > 0 ? randomSamplePoints(lat, lng, needed) : [];

  const samplePoints = [...osmPoints, ...randomPoints];
  console.log(`Samples: ${osmPoints.length} from OSM + ${randomPoints.length} random = ${samplePoints.length} total`);

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
