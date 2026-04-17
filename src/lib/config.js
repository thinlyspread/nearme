export const CONFIG = {
  radius:             500,
  questionsPerGame:   10,
  minCachedLocations: 40,
  batchSize:          8,
  targetLocations:    50,
};

export const VISION_CONFIG = {
  enabled:          true,
  minScoreToAccept: 3,
  tier2ForScore7:   3,
  tier2ForScore5:   2,

  tier1Features: [
    'lamp post','street light','light fixture',
    'post box','mailbox','letter box',
    'house number','building number',
    'street sign','traffic sign','road sign',
    'roundabout','traffic circle',
    'bus stop','bus shelter',
    'fire hydrant',
    'bollard','traffic bollard',
    'telephone box','phone box',
  ],

  tier2Features: [
    'utility pole','telegraph pole','power line',
    'fence','gate','railing',
    'wall','brick wall','stone wall','flint wall',
    'sidewalk','pavement','footpath',
    'curb','kerb',
    'road surface','asphalt',
    'driveway','parking',
    'pedestrian crossing','zebra crossing',
    'brick','brickwork',
    'stone','stonework','flint',
    'chimney',
    'roof','roofing',
    'window','door',
    'garage','garage door',
    'bench','park bench',
    'street furniture',
    'bin','litter bin',
  ],
};
