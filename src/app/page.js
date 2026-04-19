'use client';

import { useRef, useState, useEffect } from 'react';
import { CONFIG } from '@/lib/config';
import { generateQuestions } from '@/lib/questions';
import { getPointsForCoordinate } from '@/lib/locations';
import { countRoadsNearby } from '@/lib/osm';

export default function NearMe() {
  const [screen, setScreen]           = useState('landing');
  const [errorMsg, setErrorMsg]       = useState('');
  const [progress, setProgress]       = useState(0);
  const [loadingText, setLoadingText] = useState('Initialising...');
  const [address, setAddress]         = useState('');
  const [startBtnEnabled, setStartBtnEnabled] = useState(false);

  const [questions, setQuestions]             = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [score, setScore]                     = useState(0);
  const [answered, setAnswered]               = useState(false);
  const [selectedIdx, setSelectedIdx]         = useState(-1);
  const [correctIdx, setCorrectIdx]           = useState(-1);
  const [nextEnabled, setNextEnabled]         = useState(false);

  const [hasPin, setHasPin]                   = useState(false);
  const [isVagueAddress, setIsVagueAddress]   = useState(false);
  const [roadCount, setRoadCount]             = useState(null); // null = unknown / not yet queried
  const [roadCountLoading, setRoadCountLoading] = useState(false);

  const selectedPlaceRef = useRef(null);
  const addressInputRef  = useRef(null);
  const mapDivRef        = useRef(null);
  const mapInstanceRef   = useRef(null);
  const markerRef        = useRef(null);
  const circleRef        = useRef(null);
  const markerLatLngRef  = useRef(null);

  useEffect(() => {
    if (screen !== 'start') {
      // Map DOM node is unmounted when we leave this screen; drop refs so a
      // later return to 'start' re-initialises against the new div.
      mapInstanceRef.current = null;
      markerRef.current      = null;
      circleRef.current      = null;
      markerLatLngRef.current = null;
      return;
    }
    // Re-entering the start screen: clear any stale pin state.
    setHasPin(false);
    setIsVagueAddress(false);
    setRoadCount(null);
    setRoadCountLoading(false);

    if (typeof google === 'undefined') return;
    if (!addressInputRef.current) return;
    const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current);
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const valid = !!(place && place.geometry);
      selectedPlaceRef.current = valid ? place : null;
      setStartBtnEnabled(valid);
      if (!valid) {
        alert('Please select a valid address from the suggestions');
        return;
      }
      showPlaceOnMap(place);
    });
  }, [screen]);

  // Types Google returns for specific-enough places. Anything outside this set
  // (localities, postcodes, admin areas) is treated as vague and we prompt the
  // user to drag the pin.
  const SPECIFIC_PLACE_TYPES = ['street_address', 'premise', 'subpremise', 'route', 'establishment', 'point_of_interest'];

  function showPlaceOnMap(place) {
    const loc = place.geometry.location;
    const lat = typeof loc.lat === 'function' ? loc.lat() : loc.lat;
    const lng = typeof loc.lng === 'function' ? loc.lng() : loc.lng;
    const specific = (place.types || []).some(t => SPECIFIC_PLACE_TYPES.includes(t));

    markerLatLngRef.current = { lat, lng };
    setIsVagueAddress(!specific);
    setHasPin(true);

    if (!mapDivRef.current) return;

    const position = { lat, lng };
    const zoom = specific ? 17 : 13;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new google.maps.Map(mapDivRef.current, {
        center: position,
        zoom,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      markerRef.current = new google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        draggable: true,
      });
      circleRef.current = new google.maps.Circle({
        map: mapInstanceRef.current,
        center: position,
        radius: CONFIG.radius,
        strokeColor: '#5C6BC0',
        strokeOpacity: 0.7,
        strokeWeight: 2,
        fillColor: '#5C6BC0',
        fillOpacity: 0.10,
        clickable: false,
      });
      circleRef.current.bindTo('center', markerRef.current, 'position');
      markerRef.current.addListener('dragend', () => {
        const p = markerRef.current.getPosition();
        const coords = { lat: p.lat(), lng: p.lng() };
        markerLatLngRef.current = coords;
        setIsVagueAddress(false); // user has now been specific
        checkRoadDensity(coords.lat, coords.lng);
      });
    } else {
      mapInstanceRef.current.setCenter(position);
      mapInstanceRef.current.setZoom(zoom);
      markerRef.current.setPosition(position);
    }

    checkRoadDensity(lat, lng);

    // The map div grows from height:0 to 220 on the very first pin — Google
    // Maps caches the initial (empty) size and won't redraw without a resize
    // nudge. Fire one after React flushes the height change.
    setTimeout(() => {
      if (mapInstanceRef.current) {
        google.maps.event.trigger(mapInstanceRef.current, 'resize');
        mapInstanceRef.current.setCenter(position);
      }
    }, 80);
  }

  async function checkRoadDensity(lat, lng) {
    setRoadCountLoading(true);
    setRoadCount(null);
    const count = await countRoadsNearby(lat, lng, CONFIG.radius);
    setRoadCountLoading(false);
    setRoadCount(count); // null if Overpass failed — banner stays hidden
  }

  function updateProgress(pct, text) {
    setProgress(pct);
    setLoadingText(text);
  }

  async function startGame() {
    const place = selectedPlaceRef.current;
    if (!place?.geometry) { alert('Please select an address first'); return; }

    // Use the marker's current position (may have been dragged) rather than
    // the raw autocomplete result.
    const pin = markerLatLngRef.current || {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
    const lat = pin.lat;
    const lng = pin.lng;
    setAddress(place.formatted_address);
    setScreen('loading');

    try {
      const records = await getPointsForCoordinate(lat, lng, updateProgress);

      updateProgress(86, 'Building questions...');
      const qs = generateQuestions(records, lat, lng);
      if (!qs.length) throw new Error('Could not generate enough questions. Try a different address.');

      updateProgress(92, 'Preloading images...');
      qs.forEach(q => { const img = new Image(); img.src = q.image_url; });
      updateProgress(100, 'Ready!');

      setQuestions(qs);
      setCurrentQuestion(0);
      setScore(0);
      setAnswered(false);
      setSelectedIdx(-1);
      setCorrectIdx(qs[0].options.findIndex(o => o.isCorrect));
      setNextEnabled(false);

      await new Promise(r => setTimeout(r, 400));
      setScreen('game');
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      setScreen('error');
    }
  }

  function selectOption(idx) {
    if (answered) return;
    setAnswered(true);
    setSelectedIdx(idx);
    const ci = questions[currentQuestion].options.findIndex(o => o.isCorrect);
    setCorrectIdx(ci);
    if (idx === ci) setScore(s => s + 1);
    setTimeout(() => setNextEnabled(true), 800);
  }

  function nextQuestionHandler() {
    const next = currentQuestion + 1;
    if (next >= questions.length) { setScreen('results'); return; }
    setCurrentQuestion(next);
    setAnswered(false);
    setSelectedIdx(-1);
    setCorrectIdx(questions[next].options.findIndex(o => o.isCorrect));
    setNextEnabled(false);
  }

  const q   = questions[currentQuestion];
  const pct = questions.length ? Math.round((score / questions.length) * 100) : 0;

  const inputStyle = {
    width: '100%', padding: 15, fontSize: 16,
    border: '2px solid #ddd', borderRadius: 8, marginBottom: 15,
  };
  const primaryBtn = { width: '100%', padding: '15px 24px', fontSize: 16, background: '#5C6BC0' };
  const secondaryBtn = {
    display: 'inline-block', background: '#f0f0f0', color: '#333',
    padding: '12px 24px', fontSize: 14, border: 'none', borderRadius: 8,
    cursor: 'pointer', textDecoration: 'none',
  };

  return (
    <div className="container">
      {/* Landing */}
      {screen === 'landing' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{'\uD83D\uDCCD'}</div>
          <h1 style={{ fontSize: 42, marginBottom: 4 }}>NearMe</h1>
          <p style={{ color: '#999', fontSize: 13, marginBottom: 16 }}>v0.5.0</p>
          <p style={{ color: '#555', fontSize: 18, marginBottom: 8, lineHeight: 1.5 }}>
            How well do you <em>really</em> know your neighbourhood?
          </p>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 36, lineHeight: 1.4 }}>
            (Works best in urban areas — based on Street View.)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320, margin: '0 auto' }}>
            <button onClick={() => setScreen('start')} style={{ ...primaryBtn, background: '#5C6BC0' }}>
              {'\uD83C\uDFAF'} Play Solo
            </button>
            <a href="/multiplayer/host" style={{ textDecoration: 'none' }}>
              <button type="button" style={{ ...primaryBtn, background: '#7E57C2' }}>
                {'\uD83C\uDFE0'} Host Game
              </button>
            </a>
            <a href="/multiplayer/join" style={{ textDecoration: 'none' }}>
              <button type="button" style={{ ...primaryBtn, background: '#26A69A' }}>
                {'\uD83D\uDD17'} Join Game
              </button>
            </a>
          </div>
        </div>
      )}

      {/* Solo Setup */}
      {screen === 'start' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <h1>Solo Mode</h1>
          <p className="subtitle">10 Street View images near your address. How many can you get?</p>
          <label style={{ display: 'block', marginBottom: 8, color: '#333', fontWeight: 'bold', textAlign: 'left' }}>
            Enter Your Address:
          </label>
          <input ref={addressInputRef} id="addressInput" type="text" placeholder="Start typing your address..." style={inputStyle} />

          {isVagueAddress && (
            <div style={{
              background: '#fff4d1',
              border: '1px solid #e8b800',
              color: '#7a5a00',
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: 14,
              marginBottom: 10,
              textAlign: 'left',
              lineHeight: 1.4,
            }}>
              <strong>That&apos;s a broad area.</strong> Drag the pin to the exact spot you want to play from.
            </div>
          )}

          <div
            ref={mapDivRef}
            style={{
              width: '100%',
              height: hasPin ? 220 : 0,
              borderRadius: 8,
              marginBottom: hasPin ? 15 : 0,
              overflow: 'hidden',
              transition: 'height 0.2s ease',
            }}
          />

          {hasPin && (
            <p style={{ fontSize: 12, color: '#888', marginBottom: 8, textAlign: 'left' }}>
              Tip: drag the pin to adjust. The blue circle shows the search area.
            </p>
          )}

          {hasPin && roadCountLoading && (
            <p style={{ fontSize: 13, color: '#888', marginBottom: 12, textAlign: 'left' }}>
              Checking nearby streets…
            </p>
          )}

          {hasPin && !roadCountLoading && roadCount !== null && roadCount >= 10 && (
            <p style={{
              fontSize: 13,
              color: '#2e7d32',
              background: '#e8f5e9',
              border: '1px solid #a5d6a7',
              padding: '6px 10px',
              borderRadius: 6,
              marginBottom: 12,
              textAlign: 'left',
            }}>
              {roadCount} streets nearby — good to go.
            </p>
          )}

          {hasPin && !roadCountLoading && roadCount !== null && roadCount < 10 && (
            <p style={{
              fontSize: 13,
              color: '#7a5a00',
              background: '#fff4d1',
              border: '1px solid #e8b800',
              padding: '6px 10px',
              borderRadius: 6,
              marginBottom: 12,
              textAlign: 'left',
            }}>
              Only {roadCount} {roadCount === 1 ? 'street' : 'streets'} nearby — the game may be short. Try dragging the pin somewhere denser.
            </p>
          )}

          <button disabled={!startBtnEnabled} onClick={startGame} style={primaryBtn}>
            Let&apos;s Go!
          </button>
          <div style={{ marginTop: 15 }}>
            <button onClick={() => setScreen('landing')} style={secondaryBtn}>&larr; Back</button>
          </div>
        </div>
      )}

      {/* Loading */}
      {screen === 'loading' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 20 }}>Generating Your Quiz...</h2>
          <div className="loading-progress">
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="loading-text">{loadingText}</div>
          </div>
          <div style={{ background: '#f0f0ff', borderRadius: 8, padding: '12px 20px', marginTop: 30, wordBreak: 'break-word' }}>
            <span style={{ fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Playing Near</span>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#333', marginTop: 4 }}>{address}</div>
          </div>
        </div>
      )}

      {/* Game */}
      {screen === 'game' && q && (
        <div className="screen">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: '#666', fontSize: 16 }}>Q{currentQuestion + 1}/{questions.length}</span>
            <span style={{ fontSize: 18, fontWeight: 'bold', color: '#667eea' }}>Score: {score}/{answered ? currentQuestion + 1 : currentQuestion}</span>
          </div>
          <div style={{ textAlign: 'center', margin: '10px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.image_url} alt="Street View" style={{ maxWidth: 600, width: '100%', borderRadius: 8, boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
          </div>
          <h3 style={{ textAlign: 'center', margin: '15px 0', color: '#333' }}>Where Is This?</h3>
          <div style={{ maxWidth: 600, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, gridAutoRows: '1fr' }}>
            {q.options.map((opt, idx) => {
              const colors = ['#667eea','#e74c3c','#2ecc71','#f39c12'];
              let bg = colors[idx];
              let opacity = 1;
              if (answered) {
                if (opt.isCorrect) { bg = '#28a745'; }
                else if (idx === selectedIdx) { bg = '#dc3545'; }
                else { opacity = 0.4; }
              }
              return (
                <button
                  key={idx}
                  onClick={() => selectOption(idx)}
                  disabled={answered}
                  style={{
                    padding: '20px 15px', background: bg, border: 'none',
                    borderRadius: 12, textAlign: 'center', fontSize: 16,
                    color: 'white', fontWeight: 'bold',
                    minHeight: 80, cursor: answered ? 'default' : 'pointer',
                    opacity, transition: 'all 0.3s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span>
                    {opt.name} ({opt.distance}m)
                    {answered && opt.isCorrect && <span style={{ display: 'block', marginTop: 4, fontSize: 14 }}>{'\u2713'} Correct</span>}
                    {answered && !opt.isCorrect && idx === selectedIdx && <span style={{ display: 'block', marginTop: 4, fontSize: 14 }}>{'\u2717'} Wrong</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button disabled={!nextEnabled} onClick={nextQuestionHandler} style={{ padding: '15px 40px', fontSize: 16 }}>
              {currentQuestion === questions.length - 1 ? 'See Results' : 'Next Question \u2192'}
            </button>
          </div>
        </div>
      )}

      {/* Results */}
      {screen === 'results' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <h1>Game Complete!</h1>
          <div style={{ fontSize: 64, color: '#667eea', fontWeight: 'bold', margin: '20px 0' }}>{score}/{questions.length}</div>
          <div style={{ fontSize: 20, color: '#333', marginBottom: 30 }}>
            {pct >= 90 ? '\uD83C\uDFC6 Amazing! You really know your local area!'
              : pct >= 70 ? '\uD83D\uDC4F Great job! You know your neighbourhood well!'
              : pct >= 50 ? '\uD83D\uDC4D Not bad! Time to explore more!'
              : '\uD83D\uDDFA\uFE0F Maybe take a walk around your area!'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <button onClick={() => window.location.reload()} style={{ ...primaryBtn, maxWidth: 320 }}>Play Again!</button>
            <a href="/" style={secondaryBtn}>Back to Menu</a>
          </div>
        </div>
      )}

      {/* Error */}
      {screen === 'error' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 10 }}>{'\u26A0\uFE0F'}</div>
          <h2 style={{ color: '#dc3545', marginBottom: 15 }}>Something Went Wrong</h2>
          <p style={{ color: '#666', marginBottom: 20 }}>{errorMsg}</p>
          <button onClick={() => window.location.reload()} style={{ ...primaryBtn, maxWidth: 320, background: '#dc3545' }}>Try Again</button>
        </div>
      )}
    </div>
  );
}
