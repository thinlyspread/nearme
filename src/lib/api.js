import { VISION_CONFIG } from './config';

export async function checkStreetViewCoverage(lat, lng) {
  const res = await fetch(`/api/streetview-meta?lat=${lat}&lng=${lng}`);
  return res.json();
}

export function isValidLocationName(name) {
  if (!name || name === 'Street View') return false;
  const t = name.trim();
  if (/^\d+$/.test(t))        return false;
  if (/^\d/.test(t))           return false;
  if (/\b[A-Z]\d+\b/.test(t)) return false;
  if (t.length < 3)            return false;
  if (t.replace(/\s/g,'').length < 3) return false;
  if (!/[a-zA-Z]/.test(t))    return false;
  return true;
}

export async function getStreetName(lat, lng) {
  const res  = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
  const data = await res.json();

  if (data.status !== 'OK' || !data.results?.length) return null;

  const parts = data.results[0].address_components;
  const route = parts.find(c => c.types.includes('route'));
  if (route && isValidLocationName(route.long_name)) return route.long_name;

  const hood = parts.find(c => c.types.includes('neighborhood'));
  if (hood && isValidLocationName(hood.long_name)) return hood.long_name;

  const first = data.results[0].formatted_address.split(',')[0];
  if (
    isValidLocationName(first) &&
    /\b(Road|Street|Avenue|Lane|Drive|Close|Way|Court|Place|Crescent|Gardens|Rise|Grove|Terrace|Hill|Walk)\b/i.test(first)
  ) return first;

  return null;
}

export async function analyzeImageQuality(lat, lng) {
  if (!VISION_CONFIG.enabled) return { accept: true, score: 5, reason: 'Disabled' };

  try {
    const res  = await fetch('/api/vision', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lat, lng }),
    });
    const data = await res.json();

    if (!data.responses?.[0]?.labelAnnotations) {
      return { accept: false, score: 0, reason: 'No labels', labels: '' };
    }

    const labels = data.responses[0].labelAnnotations.map(l => l.description.toLowerCase());

    const tier1 = VISION_CONFIG.tier1Features.filter(f =>
      labels.some(l => l.includes(f) || f.includes(l))
    );
    if (tier1.length) {
      return { accept: true, score: 10, reason: `Tier1: ${tier1[0]}`, labels: labels.join(',') };
    }

    const tier2 = VISION_CONFIG.tier2Features.filter(f =>
      labels.some(l => l.includes(f) || f.includes(l))
    );
    const score =
      tier2.length >= VISION_CONFIG.tier2ForScore7 ? 7 :
      tier2.length >= VISION_CONFIG.tier2ForScore5 ? 5 :
      tier2.length >= 1                            ? 3 : 0;
    const reason = score > 0 ? `${tier2.length} Tier2 feature(s)` : 'No usable features';

    return { accept: score >= VISION_CONFIG.minScoreToAccept, score, reason, labels: labels.join(',') };

  } catch (err) {
    console.warn('Vision API error — accepting by default:', err);
    return { accept: true, score: 5, reason: 'Vision error (fail open)', labels: '' };
  }
}
