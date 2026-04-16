'use client';

import { useRef, useState, useEffect } from 'react';
import { CONFIG } from '@/lib/config';
import { generateQuestions } from '@/lib/questions';
import { getPointsForCoordinate } from '@/lib/locations';

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

  const selectedPlaceRef = useRef(null);
  const addressInputRef  = useRef(null);

  useEffect(() => {
    if (screen !== 'start') return;
    if (typeof google === 'undefined') return;
    if (!addressInputRef.current) return;
    const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current);
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const valid = !!(place && place.geometry);
      selectedPlaceRef.current = valid ? place : null;
      setStartBtnEnabled(valid);
      if (!valid) alert('Please select a valid address from the suggestions');
    });
  }, [screen]);

  function updateProgress(pct, text) {
    setProgress(pct);
    setLoadingText(text);
  }

  async function startGame() {
    const place = selectedPlaceRef.current;
    if (!place?.geometry) { alert('Please select an address first'); return; }

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
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

  return (
    <div className="container">
      {/* Landing — mode select */}
      {screen === 'landing' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{'\uD83D\uDCCD'}</div>
          <h1 style={{ fontSize: 42, marginBottom: 4 }}>NearMe</h1>
          <p style={{ color: '#999', fontSize: 13, marginBottom: 16 }}>v0.5.0</p>
          <p style={{ color: '#555', fontSize: 18, marginBottom: 36, lineHeight: 1.5 }}>
            How well do you <em>really</em> know your neighbourhood?
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320, margin: '0 auto' }}>
            <button
              onClick={() => setScreen('start')}
              style={{ width: '100%', padding: '18px 24px', fontSize: 18, background: '#5C6BC0' }}
            >
              {'\uD83C\uDFAF'} Play Solo
            </button>
            <a href="/multiplayer/host" style={{ textDecoration: 'none' }}>
              <button
                type="button"
                style={{ width: '100%', padding: '18px 24px', fontSize: 18, background: '#7E57C2' }}
              >
                {'\uD83C\uDFE0'} Host Game
              </button>
            </a>
            <a href="/multiplayer/join" style={{ textDecoration: 'none' }}>
              <button
                type="button"
                style={{ width: '100%', padding: '18px 24px', fontSize: 18, background: '#26A69A' }}
              >
                {'\uD83D\uDD17'} Join Game
              </button>
            </a>
          </div>
        </div>
      )}

      {/* Solo — address entry */}
      {screen === 'start' && (
        <div className="screen screen-narrow">
          <h1>Solo Mode</h1>
          <p className="subtitle">10 Street View images near your address. How many can you get?</p>
          <label htmlFor="addressInput" style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>
            Enter Your Address:
          </label>
          <input ref={addressInputRef} id="addressInput" type="text" placeholder="Start typing your address..." />
          <button disabled={!startBtnEnabled} onClick={startGame}>Let&apos;s Go!</button>
          <div style={{ marginTop: 15 }}>
            <button onClick={() => setScreen('landing')} style={{ background: '#f0f0f0', color: '#333', padding: '12px 24px', fontSize: 14, border: 'none', borderRadius: 8, cursor: 'pointer' }}>
              &larr; Back
            </button>
          </div>
        </div>
      )}

      {screen === 'loading' && (
        <div className="screen screen-narrow">
          <h2 style={{ textAlign: 'center', marginBottom: 20 }}>Generating Your Quiz...</h2>
          <div className="loading-progress">
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="loading-text">{loadingText}</div>
          </div>
          <div style={{ background: '#f0f0ff', borderRadius: 8, padding: '12px 20px', marginTop: 30, textAlign: 'center', wordBreak: 'break-word' }}>
            <span style={{ fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Playing Near</span>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#333', marginTop: 4 }}>{address}</div>
          </div>
        </div>
      )}

      {screen === 'game' && q && (
        <div className="screen">
          <div className="progress-text">Question {currentQuestion + 1} of {questions.length}</div>
          <div className="score">Score: {score}/{answered ? currentQuestion + 1 : currentQuestion}</div>
          <div style={{ textAlign: 'center', margin: '20px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.image_url} alt="Street View" style={{ maxWidth: 600, width: '100%', borderRadius: 8, boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
          </div>
          <h3 style={{ textAlign: 'center', margin: '20px 0', color: '#333' }}>Where are you?!</h3>
          <div style={{ maxWidth: 500, margin: '0 auto' }}>
            {q.options.map((opt, idx) => {
              let cls = 'option';
              if (answered) {
                cls += ' answered';
                if (opt.isCorrect) cls += ' correct';
                else if (idx === selectedIdx) cls += ' incorrect';
              }
              return (
                <label key={idx} className={cls} onClick={() => selectOption(idx)}>
                  <input type="radio" name="location" value={idx} checked={idx === selectedIdx} readOnly />
                  <span className="option-text">{opt.name} ({opt.distance}m away)</span>
                  {answered && opt.isCorrect && <span className="result-marker correct">{'\u2713'}</span>}
                  {answered && !opt.isCorrect && idx === selectedIdx && <span className="result-marker incorrect">{'\u2717'}</span>}
                </label>
              );
            })}
          </div>
          <div className="next-btn-container">
            <button disabled={!nextEnabled} onClick={nextQuestionHandler}>
              {currentQuestion === questions.length - 1 ? 'See Results' : 'Next Question \u2192'}
            </button>
          </div>
        </div>
      )}

      {screen === 'results' && (
        <div className="screen screen-narrow">
          <div className="results-screen">
            <h1>{'\uD83C\uDF89'} Game Complete!</h1>
            <div className="final-score">{score}/{questions.length}</div>
            <div className="results-message">
              {pct >= 90 ? '\uD83C\uDFC6 Amazing! You really know your local area!'
                : pct >= 70 ? '\uD83D\uDC4F Great job! You know your neighbourhood well!'
                : pct >= 50 ? '\uD83D\uDC4D Not bad! Time to explore more!'
                : '\uD83D\uDDFA\uFE0F Maybe take a walk around your area!'}
            </div>
            <button onClick={() => window.location.reload()}>Play Again</button>
          </div>
        </div>
      )}

      {screen === 'error' && (
        <div className="screen screen-narrow">
          <div className="error">
            <h2>{'\u26A0\uFE0F'} Error</h2>
            <p>{errorMsg}</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: 20 }}>Try Again</button>
          </div>
        </div>
      )}
    </div>
  );
}
