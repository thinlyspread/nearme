'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '@/lib/supabase';
import { generateQuestions } from '@/lib/questions';
import { getPointsForCoordinate } from '@/lib/locations';
import { TIME_LIMIT_MS } from '@/lib/scoring';

export default function HostGame() {
  // Screen: setup | lobby | loading | question | reveal | finished
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

  const selectedPlaceRef = useRef(null);
  const addressInputRef  = useRef(null);
  const channelRef       = useRef(null);
  const timerRef         = useRef(null);

  const isObserver = hostMode === 'observer';
  // How many players need to answer before auto-reveal
  const expectedAnswers = isObserver ? players.filter(p => !p.is_host).length : players.length;

  // Google Places autocomplete
  useEffect(() => {
    if (typeof google === 'undefined') return;
    const autocomplete = new google.maps.places.Autocomplete(addressInputRef.current);
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      const valid = !!(place && place.geometry);
      selectedPlaceRef.current = valid ? place : null;
      setStartBtnEnabled(valid && nickname.trim().length > 0);
      if (!valid) alert('Please select a valid address from the suggestions');
    });
  }, [nickname]);

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

    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

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
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();

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

    channelRef.current?.send({
      type: 'broadcast',
      event: 'question:reveal',
      payload: {
        index: currentQuestion,
        correct_index: correctIndex,
        correct_name: q.options[correctIndex].name,
        scores: broadcastScores,
      },
    });

    setScreen('reveal');
  }

  async function nextQuestion() {
    const next = currentQuestion + 1;
    if (next >= questions.length) {
      // Game over
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
      return;
    }

    setCurrentQuestion(next);
    setRevealData(null);
    await broadcastQuestion(next);
    setScreen('question');
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

  // ── Render ─────────────────────────────────────────────

  const q = questions[currentQuestion];
  const OPTION_COLORS = ['#667eea','#e74c3c','#2ecc71','#f39c12'];

  return (
    <div className="container">
      {/* Setup */}
      {screen === 'setup' && (
        <div className="screen">
          <h1>Host a Game <span style={{ fontSize: 14, color: '#999', fontWeight: 'normal' }}>v0.5.0</span></h1>
          <p className="subtitle">Set up a multiplayer quiz for your group.</p>
          {errorMsg && <p style={{ color: 'red', marginBottom: 10 }}>{errorMsg}</p>}
          <label style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>Your nickname:</label>
          <input
            type="text" maxLength={12} placeholder="e.g. Dad"
            value={nickname} onChange={e => { setNickname(e.target.value); setStartBtnEnabled(!!selectedPlaceRef.current && e.target.value.trim().length > 0); }}
            style={{ width: '100%', padding: 15, fontSize: 16, border: '2px solid #ddd', borderRadius: 8, marginBottom: 20 }}
          />
          <label style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>Host mode:</label>
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
              Play along
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
              Observe only
            </button>
          </div>
          <label style={{ display: 'block', marginBottom: 10, color: '#333', fontWeight: 'bold' }}>Enter your address:</label>
          <input ref={addressInputRef} id="addressInput" type="text" placeholder="Start typing your address..." />
          <button disabled={!startBtnEnabled} onClick={createRoom}>Create Room</button>
          <div style={{ marginTop: 15 }}><a href="/" style={{ color: '#667eea', fontSize: 14 }}>&larr; Back</a></div>
        </div>
      )}

      {/* Lobby */}
      {screen === 'lobby' && (() => {
        const joinUrl = typeof window !== 'undefined'
          ? `${window.location.origin}/multiplayer/join`
          : '';
        return (
        <div className="screen" style={{ textAlign: 'center' }}>
          <div style={{ background: '#f0f0ff', borderRadius: 8, padding: '12px 20px', marginBottom: 20 }}>
            <span style={{ fontSize: 13, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Playing near</span>
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
        <div className="screen">
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
          <div style={{ textAlign: 'center' }}>
            <button onClick={handleReveal}>Reveal Answer</button>
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
                        Locked in
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
          <div style={{ textAlign: 'center' }}>
            <button onClick={handleReveal}>Reveal Answer</button>
          </div>
        </div>
      )}

      {/* Reveal */}
      {screen === 'reveal' && revealData && (() => {
        const hostAnswer = !isObserver && revealData.answers.find(a => a.player_id === playerId);
        return (
        <div className="screen" style={{ textAlign: 'center' }}>
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
          <div style={{ marginTop: 20 }}>
            <button onClick={nextQuestion}>
              {currentQuestion === questions.length - 1 ? 'See Final Results' : 'Next Question \u2192'}
            </button>
          </div>
        </div>
        );
      })()}

      {/* Finished */}
      {screen === 'finished' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          <h1>{'\uD83C\uDFC6'} Final Results!</h1>
          <div style={{ margin: '30px 0' }}>
            {leaderboard.filter(p => !(isObserver && p.is_host)).map((p, i) => (
              <div key={p.id} style={{
                padding: '15px 20px', margin: '10px auto', maxWidth: 400,
                borderRadius: 12, background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : '#f8f8f8',
                fontSize: i === 0 ? 28 : i < 3 ? 22 : 18, fontWeight: 'bold',
                boxShadow: i < 3 ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
              }}>
                #{i + 1} {p.nickname} — {p.total_score} pts
              </div>
            ))}
          </div>
          <button onClick={playAgain}>Play Again</button>
          <div style={{ marginTop: 10 }}>
            <a href="/" style={{ color: '#667eea', fontSize: 14 }}>Solo mode</a>
          </div>
        </div>
      )}
    </div>
  );
}
