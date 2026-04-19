'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '@/lib/supabase';
import { CONFIG } from '@/lib/config';
import { generateQuestions } from '@/lib/questions';
import { getPointsForCoordinate } from '@/lib/locations';
import { countRoadsNearby } from '@/lib/osm';
import { TIME_LIMIT_MS } from '@/lib/scoring';
import { useConfetti } from '@/lib/useConfetti';

export default function HostGame() {
  // Screen: setup | lobby | loading | question | reveal | countdown | finished
  const [screenRaw, setScreenRaw]   = useState('setup');
  function setScreen(s) { setScreenRaw(s); window.scrollTo(0, 0); }
  const screen = screenRaw;
  const [errorMsg, setErrorMsg]     = useState('');
  const [nickname, setNickname]     = useState('');
  const [hostMode, setHostMode]     = useState('player'); // 'player' | 'observer'
  const [startBtnEnabled, setStartBtnEnabled] = useState(false);

  // Room state
  const [roomId, setRoomId]         = useState(null);
  const [joinCode, setJoinCode]     = useState('');
  const [playerId, setPlayerId]     = useState(null);
  const [players, setPlayers]       = useState([]);
  const [address, setAddress]       = useState('');

  // Loading
  const [progress, setProgress]     = useState(0);
  const [loadingText, setLoadingText] = useState('');

  // Game state
  const [questions, setQuestions]             = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answeredCount, setAnsweredCount]     = useState(0);
  const [revealData, setRevealData]           = useState(null);
  const [timeLeft, setTimeLeft]               = useState(TIME_LIMIT_MS / 1000);
  const [leaderboard, setLeaderboard]         = useState([]);
  const [hostAnswered, setHostAnswered]       = useState(false);
  const [hostSelectedIdx, setHostSelectedIdx] = useState(-1);
  const [countdownNum, setCountdownNum]       = useState(null); // 'ready' | 3 | 2 | 1

  const selectedPlaceRef = useRef(null);
  const addressInputRef  = useRef(null);
  const channelRef       = useRef(null);
  const timerRef         = useRef(null);
  const mapDivRef        = useRef(null);
  const mapInstanceRef   = useRef(null);
  const markerRef        = useRef(null);
  const circleRef        = useRef(null);
  const markerLatLngRef  = useRef(null);

  const [hasPin, setHasPin]                   = useState(false);
  const [isVagueAddress, setIsVagueAddress]   = useState(false);
  const [roadCount, setRoadCount]             = useState(null);
  const [roadCountLoading, setRoadCountLoading] = useState(false);

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
        setIsVagueAddress(false);
        checkRoadDensity(coords.lat, coords.lng);
      });
    } else {
      mapInstanceRef.current.setCenter(position);
      mapInstanceRef.current.setZoom(zoom);
      markerRef.current.setPosition(position);
    }

    checkRoadDensity(lat, lng);

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
    setRoadCount(count);
  }

  const isObserver = hostMode === 'observer';
  // How many players need to answer before auto-reveal
  const expectedAnswers = isObserver ? players.filter(p => !p.is_host).length : players.length;

  // Google Places autocomplete
  useEffect(() => {
    if (screen !== 'setup') {
      // Drop map refs so a later return to setup re-initialises cleanly.
      mapInstanceRef.current = null;
      markerRef.current      = null;
      circleRef.current      = null;
      markerLatLngRef.current = null;
      return;
    }
    if (typeof google === 'undefined') return;
    if (!addressInputRef.current) return;
    const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current);
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const valid = !!(place && place.geometry);
      selectedPlaceRef.current = valid ? place : null;
      setStartBtnEnabled(valid && nickname.trim().length > 0);
      if (!valid) {
        alert('Please select a valid address from the suggestions');
        return;
      }
      showPlaceOnMap(place);
    });
  }, [nickname, screen]);

  // Poll for new players in lobby
  useEffect(() => {
    if (!roomId || screen !== 'lobby') return;
    const interval = setInterval(async () => {
      const { data } = await db.from('game_players').select('*').eq('room_id', roomId).order('created_at');
      if (data) setPlayers(data);
    }, 2000);
    return () => clearInterval(interval);
  }, [roomId, screen]);

  // Subscribe to Realtime channel for player answers
  useEffect(() => {
    if (!joinCode || screen === 'setup' || screen === 'lobby') return;

    const channel = db.channel(`room:${joinCode}`);
    channel
      .on('broadcast', { event: 'player:answer' }, ({ payload }) => {
        setAnsweredCount(c => c + 1);
      })
      .subscribe();

    channelRef.current = channel;
    return () => { channel.unsubscribe(); };
  }, [joinCode, screen]);

  // Timer countdown during questions
  useEffect(() => {
    if (screen !== 'question') return;
    setTimeLeft(TIME_LIMIT_MS / 1000);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          handleReveal();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [screen, currentQuestion]);

  // Auto-reveal when all players have answered
  useEffect(() => {
    if (screen === 'question' && answeredCount > 0 && answeredCount >= expectedAnswers) {
      handleReveal();
    }
  }, [answeredCount, expectedAnswers, screen]);

  async function createRoom() {
    const place = selectedPlaceRef.current;
    if (!place?.geometry || !nickname.trim()) return;

    // Use the marker's current position (may have been dragged) rather than
    // the raw autocomplete result.
    const pin = markerLatLngRef.current || {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
    const lat = pin.lat;
    const lng = pin.lng;

    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat, lng,
        address: place.formatted_address,
        nickname: nickname.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setErrorMsg(data.error); return; }

    setRoomId(data.room_id);
    setJoinCode(data.join_code);
    setPlayerId(data.player_id);
    setAddress(place.formatted_address);
    setPlayers([{ id: data.player_id, nickname: nickname.trim(), avatar_color: '#667eea', is_host: true, total_score: 0 }]);
    setScreen('lobby');
  }

  async function startGameGeneration() {
    const place = selectedPlaceRef.current;
    // Marker may have been dragged on the setup screen — use the final pin
    // position, falling back to the raw place coords if somehow unset.
    const pin = markerLatLngRef.current || {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
    };
    const lat = pin.lat;
    const lng = pin.lng;

    setScreen('loading');

    try {
      const records = await getPointsForCoordinate(lat, lng, (pct, text) => {
        setProgress(pct);
        setLoadingText(text);
      });

      setProgress(86);
      setLoadingText('Building questions...');
      const qs = generateQuestions(records, lat, lng);
      if (!qs.length) throw new Error('Could not generate enough questions. Try a different address.');

      // Store questions on server
      await fetch(`/api/rooms/${joinCode}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: qs, player_id: playerId }),
      });

      setProgress(92);
      setLoadingText('Preloading images...');
      qs.forEach(q => { const img = new Image(); img.src = q.image_url; });

      setQuestions(qs);
      setCurrentQuestion(0);
      setAnsweredCount(0);

      // Broadcast question to players
      await broadcastQuestion(0, qs);
      setScreen('question');

    } catch (err) {
      console.error(err);
      setErrorMsg(err.message);
      setScreen('setup');
    }
  }

  async function broadcastQuestion(index, qs = questions) {
    const q = qs[index];
    const startedAt = new Date().toISOString();

    // Update DB timestamp
    await db.from('game_rooms').update({
      current_question_index: index,
      question_started_at: startedAt,
    }).eq('id', roomId);

    // Broadcast to players (no isCorrect)
    channelRef.current?.send({
      type: 'broadcast',
      event: 'question:show',
      payload: {
        index,
        total: qs.length,
        options: q.options.map(({ name, distance }) => ({ name, distance })),
        started_at: startedAt,
        image_url: q.image_url,
        host_mode: hostMode,
      },
    });

    setAnsweredCount(0);
    setHostAnswered(false);
    setHostSelectedIdx(-1);
  }

  async function hostSubmitAnswer(selectedOption) {
    if (hostAnswered || isObserver) return;
    setHostAnswered(true);
    setHostSelectedIdx(selectedOption);

    const res = await fetch(`/api/rooms/${joinCode}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: playerId,
        question_index: currentQuestion,
        selected_option: selectedOption,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setAnsweredCount(c => c + 1);
    }
  }

  async function handleReveal() {
    clearInterval(timerRef.current);

    const q = questions[currentQuestion];
    const correctIndex = q.options.findIndex(o => o.isCorrect);

    // Signal reveal in DB — null timestamp tells sync "reveal has happened"
    await db.from('game_rooms').update({
      question_started_at: null,
    }).eq('id', roomId);

    // Fetch answers for this question
    const { data: answers } = await db
      .from('game_answers')
      .select('*, game_players(nickname, avatar_color)')
      .eq('room_id', roomId)
      .eq('question_index', currentQuestion);

    // Fetch updated player scores
    const { data: updatedPlayers } = await db
      .from('game_players')
      .select('*')
      .eq('room_id', roomId)
      .order('total_score', { ascending: false });

    const reveal = {
      correct_index: correctIndex,
      correct_name: q.options[correctIndex].name,
      answers: answers || [],
      scores: updatedPlayers || [],
    };

    setRevealData(reveal);
    setPlayers(updatedPlayers || []);

    // Broadcast reveal — exclude host from scores if observer
    const broadcastScores = (updatedPlayers || [])
      .filter(p => !(isObserver && p.is_host))
      .map(p => ({
        player_id: p.id,
        nickname: p.nickname,
        total_score: p.total_score,
        avatar_color: p.avatar_color,
      }));

    const broadcastAnswers = (answers || [])
      .filter(a => !(isObserver && a.player_id === playerId))
      .map(a => ({
        nickname: a.game_players?.nickname,
        is_correct: a.is_correct,
        points_awarded: a.points_awarded,
      }));

    channelRef.current?.send({
      type: 'broadcast',
      event: 'question:reveal',
      payload: {
        index: currentQuestion,
        correct_index: correctIndex,
        correct_name: q.options[correctIndex].name,
        answers: broadcastAnswers,
        scores: broadcastScores,
      },
    });

    setScreen('reveal');

    // Auto-advance: wait 4s on reveal, then countdown, then next question
    setTimeout(() => startCountdown(), 4000);
  }

  async function startCountdown() {
    // If it's the last question, go straight to finished
    if (currentQuestion >= questions.length - 1) {
      await finishGame();
      return;
    }

    setScreen('countdown');

    // Broadcast countdown to players
    channelRef.current?.send({
      type: 'broadcast',
      event: 'game:countdown',
      payload: {},
    });

    setCountdownNum('ready');
    await new Promise(r => setTimeout(r, 1000));
    setCountdownNum(3);
    await new Promise(r => setTimeout(r, 1000));
    setCountdownNum(2);
    await new Promise(r => setTimeout(r, 1000));
    setCountdownNum(1);
    await new Promise(r => setTimeout(r, 1000));

    // Advance to next question
    const next = currentQuestion + 1;
    setCurrentQuestion(next);
    setRevealData(null);
    await broadcastQuestion(next);
    setScreen('question');
  }

  async function finishGame() {
    const { data: finalPlayers } = await db
      .from('game_players')
      .select('*')
      .eq('room_id', roomId)
      .order('total_score', { ascending: false });

    setLeaderboard(finalPlayers || []);

    const finalLeaderboard = (finalPlayers || [])
      .filter(p => !(isObserver && p.is_host))
      .map((p, i) => ({
        rank: i + 1,
        player_id: p.id,
        nickname: p.nickname,
        total_score: p.total_score,
        avatar_color: p.avatar_color,
      }));

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game:finished',
      payload: { leaderboard: finalLeaderboard },
    });

    await db.from('game_rooms').update({ status: 'finished' }).eq('id', roomId);
    setScreen('finished');
  }

  async function playAgain() {
    await db.from('game_players').update({ total_score: 0 }).eq('room_id', roomId);
    await db.from('game_answers').delete().eq('room_id', roomId);
    await db.from('game_rooms').update({
      status: 'lobby',
      questions: null,
      current_question_index: -1,
      question_started_at: null,
    }).eq('id', roomId);

    channelRef.current?.send({
      type: 'broadcast',
      event: 'game:restart',
      payload: {},
    });

    setQuestions([]);
    setCurrentQuestion(0);
    setAnsweredCount(0);
    setRevealData(null);
    setLeaderboard([]);
    setHostAnswered(false);
    setHostSelectedIdx(-1);

    const { data } = await db.from('game_players').select('*').eq('room_id', roomId).order('created_at');
    setPlayers(data || []);

    setScreen('lobby');
  }

  // Confetti for observer (always) or host-player who won
  const hostWon = !isObserver && leaderboard.length > 0 && leaderboard[0]?.id === playerId;
  useConfetti(screen === 'finished' && (isObserver || hostWon));

  // ── Render ─────────────────────────────────────────────

  const q = questions[currentQuestion];
  const OPTION_COLORS = ['#667eea','#e74c3c','#2ecc71','#f39c12'];

  return (
    <div className="container">
      {/* Setup */}
      {screen === 'setup' && (
        <div className="screen screen-narrow">
          <h1>Host a Game <span style={{ fontSize: 14, color: '#999', fontWeight: 'normal' }}>v0.5.0</span></h1>
          <p className="subtitle">Set up a multiplayer quiz for your group.</p>
          {errorMsg && <p style={{ color: 'red', marginBottom: 10 }}>{errorMsg}</p>}
          <label style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>Your Nickname:</label>
          <input
            type="text" maxLength={12} placeholder="e.g. Dad"
            value={nickname} onChange={e => { setNickname(e.target.value); setStartBtnEnabled(!!selectedPlaceRef.current && e.target.value.trim().length > 0); }}
            style={{ width: '100%', maxWidth: 300, padding: 15, fontSize: 16, border: '2px solid #ddd', borderRadius: 8, marginBottom: 20 }}
          />
          <label style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>Host Mode:</label>
          <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
            <button
              type="button"
              onClick={() => setHostMode('player')}
              style={{
                flex: 1, padding: '12px 16px', fontSize: 14,
                background: hostMode === 'player' ? '#667eea' : '#f0f0f0',
                color: hostMode === 'player' ? 'white' : '#333',
                border: '2px solid', borderColor: hostMode === 'player' ? '#667eea' : '#ddd',
              }}
            >
              Play Along
            </button>
            <button
              type="button"
              onClick={() => setHostMode('observer')}
              style={{
                flex: 1, padding: '12px 16px', fontSize: 14,
                background: hostMode === 'observer' ? '#667eea' : '#f0f0f0',
                color: hostMode === 'observer' ? 'white' : '#333',
                border: '2px solid', borderColor: hostMode === 'observer' ? '#667eea' : '#ddd',
              }}
            >
              Observe Only
            </button>
          </div>
          <label style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>Enter Your Address:</label>
          <input ref={addressInputRef} id="addressInput" type="text" placeholder="Start typing your address..." style={{ marginBottom: 12 }} />

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

          <div style={{
            position: 'relative',
            width: '100%',
            height: 220,
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 15,
            background: '#eef1f5',
            border: '1px dashed #c4cbd6',
          }}>
            <div ref={mapDivRef} style={{ width: '100%', height: '100%' }} />
            {!hasPin && (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#8a93a4',
                fontSize: 14,
                pointerEvents: 'none',
                textAlign: 'center',
                padding: 12,
              }}>
                <div style={{ fontSize: 28, marginBottom: 6 }}>{'\uD83D\uDDFA\uFE0F'}</div>
                <div>Pick an address — a map will appear here.</div>
              </div>
            )}
          </div>

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

          <button disabled={!startBtnEnabled} onClick={createRoom}>Create Room</button>
          <div style={{ marginTop: 15 }}><a href="/" style={{ display: 'inline-block', background: '#f0f0f0', color: '#333', padding: '12px 24px', fontSize: 14, border: 'none', borderRadius: 8, cursor: 'pointer', textDecoration: 'none' }}>&larr; Back</a></div>
        </div>
      )}

      {/* Lobby */}
      {screen === 'lobby' && (() => {
        const joinUrl = typeof window !== 'undefined'
          ? `${window.location.origin}/multiplayer/join`
          : '';
        return (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <div style={{ background: '#f0f0ff', borderRadius: 8, padding: '12px 20px', marginBottom: 20, wordBreak: 'break-word' }}>
            <span style={{ fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Playing Near</span>
            <div style={{ fontSize: 18, fontWeight: 'bold', color: '#333', marginTop: 4 }}>{address}</div>
          </div>
          <h2>Join Code</h2>
          <div style={{ fontSize: 72, fontWeight: 'bold', color: '#667eea', letterSpacing: 8, margin: '20px 0' }}>{joinCode}</div>
          {joinUrl && (
            <div style={{ margin: '20px 0' }}>
              <QRCodeSVG value={joinUrl} size={180} />
              <p style={{ color: '#666', marginTop: 10, fontSize: 14 }}>Scan to join, then enter code <strong>{joinCode}</strong></p>
            </div>
          )}
          <div style={{ margin: '20px 0' }}>
            <h3 style={{ marginBottom: 10 }}>
              {isObserver
                ? `${players.length - 1} player${players.length - 1 !== 1 ? 's' : ''}, 1 host`
                : `${players.length} players`} (max 8)
            </h3>
            {players.map(p => (
              <div key={p.id} style={{
                display: 'inline-block', margin: 5, padding: '8px 16px',
                borderRadius: 20, background: p.avatar_color, color: 'white', fontWeight: 'bold',
              }}>
                {p.nickname} {p.is_host && (isObserver ? '(Host - Observing)' : '(Host)')}
              </div>
            ))}
          </div>
          <button disabled={players.length < 2} onClick={startGameGeneration}>
            {players.length < 2 ? 'Waiting for players...'
              : isObserver ? `Start Game (${players.length - 1} player${players.length - 1 !== 1 ? 's' : ''})`
              : `Start Game (${players.length} players)`}
          </button>
        </div>
        );
      })()}

      {/* Loading */}
      {screen === 'loading' && (
        <div className="screen screen-narrow">
          <h2 style={{ textAlign: 'center', marginBottom: 20 }}>Generating Quiz...</h2>
          <div className="loading-progress">
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="loading-text">{loadingText}</div>
          </div>
        </div>
      )}

      {/* Question — Observer: display-only with large image */}
      {screen === 'question' && q && isObserver && (
        <div className="screen">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span className="progress-text">Question {currentQuestion + 1} of {questions.length}</span>
            <span style={{ fontSize: 24, fontWeight: 'bold', color: timeLeft <= 5 ? '#e74c3c' : '#667eea' }}>{timeLeft}s</span>
          </div>
          <div style={{ textAlign: 'center', margin: '10px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.image_url} alt="Street View" style={{ maxWidth: 700, width: '100%', borderRadius: 8, boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
          </div>
          <h3 style={{ textAlign: 'center', margin: '15px 0', color: '#333' }}>Where is this?</h3>
          <div style={{ maxWidth: 600, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, gridAutoRows: '1fr' }}>
            {q.options.map((opt, idx) => (
              <div key={idx} style={{
                padding: '20px 15px', background: OPTION_COLORS[idx], border: 'none',
                borderRadius: 8, textAlign: 'center', fontSize: 16,
                color: 'white', fontWeight: 'bold', minHeight: 80,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {opt.name} ({opt.distance}m)
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', margin: '15px 0', color: '#666' }}>
            {answeredCount} of {expectedAnswers} answered
          </div>
        </div>
      )}

      {/* Question — Player mode: same UI as mobile players */}
      {screen === 'question' && q && !isObserver && (
        <div className="screen">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span className="progress-text">Question {currentQuestion + 1} of {questions.length}</span>
            <span style={{ fontSize: 24, fontWeight: 'bold', color: timeLeft <= 5 ? '#e74c3c' : '#667eea' }}>{timeLeft}s</span>
          </div>
          <div style={{ textAlign: 'center', margin: '10px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.image_url} alt="Street View" style={{ maxWidth: 700, width: '100%', borderRadius: 8, boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
          </div>
          <h3 style={{ textAlign: 'center', margin: '15px 0', color: '#333' }}>Where is this?</h3>
          <div style={{ maxWidth: 600, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, gridAutoRows: '1fr' }}>
            {q.options.map((opt, idx) => {
              let opacity = hostAnswered ? (idx === hostSelectedIdx ? 1 : 0.5) : 1;
              return (
                <button
                  key={idx}
                  onClick={() => hostSubmitAnswer(idx)}
                  disabled={hostAnswered}
                  style={{
                    padding: '20px 15px', background: OPTION_COLORS[idx], border: 'none',
                    borderRadius: 8, textAlign: 'center', fontSize: 16,
                    color: 'white', fontWeight: 'bold',
                    cursor: hostAnswered ? 'default' : 'pointer',
                    opacity, transition: 'all 0.3s',
                    minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span>
                    {opt.name} ({opt.distance}m)
                    {hostAnswered && idx === hostSelectedIdx && (
                      <span style={{ display: 'block', marginTop: 4, fontSize: 14, opacity: 0.9 }}>
                        Locked In
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ textAlign: 'center', margin: '15px 0', color: '#666' }}>
            {answeredCount} of {expectedAnswers} answered
          </div>
        </div>
      )}

      {/* Reveal */}
      {screen === 'reveal' && revealData && (() => {
        const hostAnswer = !isObserver && revealData.answers.find(a => a.player_id === playerId);
        return (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <h2>Answer: {revealData.correct_name}</h2>
          {q && (
            <div style={{ textAlign: 'center', margin: '10px 0' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.image_url} alt="Street View" style={{ maxWidth: 500, width: '100%', borderRadius: 8, boxShadow: '0 4px 8px rgba(0,0,0,0.2)' }} />
            </div>
          )}
          {hostAnswer && (
            <div style={{ margin: '10px 0 20px' }}>
              <div style={{ fontSize: 48 }}>{hostAnswer.is_correct ? '\u2713' : '\u2717'}</div>
              <div style={{
                fontSize: 24, fontWeight: 'bold',
                color: hostAnswer.is_correct ? '#28a745' : '#dc3545',
              }}>
                {hostAnswer.is_correct ? `+${hostAnswer.points_awarded} points!` : 'Wrong!'}
              </div>
            </div>
          )}
          <div style={{ margin: '20px 0' }}>
            {revealData.answers.map((a, i) => (
              <div key={i} style={{
                display: 'inline-block', margin: 5, padding: '8px 16px',
                borderRadius: 20,
                background: a.is_correct ? '#d4edda' : '#f8d7da',
                color: a.is_correct ? '#28a745' : '#dc3545',
                fontWeight: 'bold',
              }}>
                {a.game_players?.nickname}: {a.is_correct ? `\u2713 +${a.points_awarded}` : '\u2717'}
              </div>
            ))}
          </div>
          <h3 style={{ marginBottom: 10 }}>Standings</h3>
          {revealData.scores.filter(p => !(isObserver && p.is_host)).map((p, i) => (
            <div key={p.id} style={{ padding: '8px 0', fontSize: 18, borderBottom: '1px solid #eee' }}>
              <strong>{i + 1}.</strong> {p.nickname} — <span style={{ color: '#667eea' }}>{p.total_score} pts</span>
            </div>
          ))}
        </div>
        );
      })()}

      {/* Countdown */}
      {screen === 'countdown' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          <div key={countdownNum} className="countdown-num" style={{
            fontSize: countdownNum === 'ready' ? 48 : 96,
            fontWeight: 'bold',
            color: '#667eea',
            margin: '60px 0',
          }}>
            {countdownNum === 'ready' ? 'Ready?!' : countdownNum}
          </div>
          <p style={{ color: '#666' }}>Question {currentQuestion + 2} of {questions.length}</p>
        </div>
      )}

      {/* Finished */}
      {screen === 'finished' && (
        <div className="screen screen-narrow" style={{ textAlign: 'center' }}>
          <h1>Final Results!</h1>
          <div style={{ margin: '30px 0' }}>
            {leaderboard.filter(p => !(isObserver && p.is_host)).map((p, i) => (
              <div key={p.id} style={{
                padding: '15px 20px', margin: '10px auto', maxWidth: 400,
                borderRadius: 12, background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#f8f8f8',
                fontSize: i === 0 ? 28 : i < 3 ? 22 : 18, fontWeight: 'bold',
                boxShadow: i < 3 ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
              }}>
                {i === 0 && '\uD83C\uDFC6 '}#{i + 1} {p.nickname} — {p.total_score} pts
              </div>
            ))}
          </div>
          <button onClick={playAgain}>Play Again!</button>
          <div style={{ marginTop: 10 }}>
            <a href="/" style={{ display: 'inline-block', background: '#f0f0f0', color: '#333', padding: '12px 24px', fontSize: 14, border: 'none', borderRadius: 8, cursor: 'pointer', textDecoration: 'none' }}>Back to Menu</a>
          </div>
        </div>
      )}
    </div>
  );
}
