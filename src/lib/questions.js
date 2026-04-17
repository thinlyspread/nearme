import { CONFIG } from './config';
import { haversineDistance } from './geo';

export function generateQuestions(locationRecords, userLat, userLng) {
  const places = locationRecords
    .filter(r => r.latitude && r.longitude)
    .map(r => ({
      id:        r.id,
      name:      r.location_name,
      image_url: r.image_url,
      latitude:  r.latitude,
      longitude: r.longitude,
      distance:  Math.round(haversineDistance(userLat, userLng, r.latitude, r.longitude)),
    }))
    .filter(p => p.distance > 0 && p.distance <= CONFIG.radius);

  const questions = [];
  const usedIds   = new Set();

  for (let attempt = 0; attempt < 100 && questions.length < CONFIG.questionsPerGame; attempt++) {
    const available = places.filter(p => !usedIds.has(p.id));
    if (!available.length) break;

    const correct   = available[Math.floor(Math.random() * available.length)];
    const minDist   = correct.distance * 0.5;
    const maxDist   = correct.distance * 1.5;
    const usedNames = new Set([correct.name]);

    const decoys = [];
    const pool   = places
      .filter(p =>
        p.distance >= minDist && p.distance <= maxDist &&
        p.id !== correct.id && !usedIds.has(p.id)
      )
      .sort(() => Math.random() - 0.5);

    for (const c of pool) {
      if (!usedNames.has(c.name)) {
        decoys.push(c);
        usedNames.add(c.name);
      }
      if (decoys.length === 3) break;
    }

    if (decoys.length < 3) continue;

    const options = [
      { name: correct.name, distance: correct.distance, isCorrect: true },
      ...decoys.map(d => ({ name: d.name, distance: d.distance, isCorrect: false })),
    ].sort(() => Math.random() - 0.5);

    questions.push({
      question_number: questions.length + 1,
      image_url:       correct.image_url,
      options,
    });

    usedIds.add(correct.id);
    decoys.forEach(d => usedIds.add(d.id));
  }

  console.log(`Generated ${questions.length} questions from ${places.length} locations`);
  return questions;
}
