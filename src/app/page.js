'use client';

import { useRef, useState, useEffect } from 'react';
import { CONFIG } from '@/lib/config';
import { generateQuestions } from '@/lib/questions';
import { getPointsForCoordinate } from '@/lib/locations';

export default function NearMe() {
  const [screen, setScreen]           = useState('start');
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
    if (typeof google === 'undefined') return;
    const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current);
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const valid = !!(place && place.geometry);
      selectedPlaceRef.current = valid ? place : null;
      setStartBtnEnabled(valid);
      if (!valid) alert('Please select a valid address from the suggestions');
    });
  }, []);

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
      {screen === 'start' && (
        <div className="screen">
          <h1>NearMe <span style={{ fontSize: 14, color: '#999', fontWeight: 'normal' }}>v0.5.0</span></h1>
          <p className="subtitle">Test your local knowledge with 10 nearby images.</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <a href="/multiplayer" style={{ color: '#667eea', fontSize: 14 }}>Play with friends &rarr;</a>
          </div>
          <label htmlFor="addressInput" style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>
            Enter your address:
          </label>
          <input ref={addressInputRef} id="addressInput" type="text" placeholder="Start typing your address..." />
          <button disabled={!startBtnEnabled} onClick={startGame}>Let&apos;s go!</button>
        </div>
      )}

      {screen === 'loading' && (
        <div className="screen">
          <h2 style={{ textAlign: 'center', marginBottom: 20 }}>Generating Your Quiz...</h2>
          <div className="loading-progress">
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="loading-text">{loadingText}</div>
          </div>
          <p style={{ textAlign: 'center', color: '#666', marginTop: 30 }}>Playing from: {address}</p>
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
        <div className="screen">
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
        <div className="screen">
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
