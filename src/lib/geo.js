export function generateRandomPointNearby(cLat, cLng, minDist, maxDist) {
  const angle = Math.random() * 2 * Math.PI;
  const dist  = minDist + Math.random() * (maxDist - minDist);
  const R     = 6371000;
  const lat1  = cLat * Math.PI / 180;
  const lng1  = cLng * Math.PI / 180;
  const lat2  = Math.asin(
    Math.sin(lat1) * Math.cos(dist / R) +
    Math.cos(lat1) * Math.sin(dist / R) * Math.cos(angle)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(angle) * Math.sin(dist / R) * Math.cos(lat1),
    Math.cos(dist / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const R     = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a     =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function getCoordinateHash(lat, lng, radius) {
  // 3 decimals ≈ 100m grid — neighbours within the same cell share cached results.
  return `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
}
