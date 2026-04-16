'use client';

import { useState, useEffect, useRef } from 'react';
import { db } from '@/lib/supabase';
import { TIME_LIMIT_MS } from '@/lib/scoring';

export default function JoinGame() {
  // Screen: enter-code | waiting | question | answered | reveal | finished
  const [screen, setScreen]       = useState('enter-code');
  const [errorMsg, setErrorMsg]   = useState('');
  const [joinCode, setJoinCode]   = useState('');
  const [nickname, setNickname]   = useState('');
  const [playerId, setPlayerId]   = useState(null);
  const [roomId, setRoomId]       = useState(null);
  const [address, setAddress]     = useState('');
  const [players, setPlayers]     = useState([]);

  // Question state
  const [questionIndex, setQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(10);
  const [options, setOptions]     = useState([]);
  const [imageUrl, setImageUrl]   = useState('');
  const [hostMode, setHostMode]   = useState('player'); // 'player' | 'observer'
  const [startedAt, setStartedAt] = useState(null);
  const [timeLeft, setTimeLeft]   = useState(TIME_LIMIT_MS / 1000);

  // Answer feedback
  const [answerResult, setAnswerResult] = useState(null); // { is_correct, points }

  // Reveal state
  const [revealScores, setRevealScores] = useState([]);
  const [correctIndex, setCorrectIndex] = useState(-1);
  const [correctName, setCorrectName]   = useState('');

  // Final leaderboard
  const [leaderboard, setLeaderboard] = useState([]);

  const channelRef       = useRef(null);
  const timerRef         = useRef(null);
  const lastSyncedIndex  = useRef(-1);
  const screenRef        = useRef(screen);
  screenRef.current = screen;

  // Sync with DB when phone wakes up or broadcast was missed
  async function syncWithRoom() {
    if (!roomId) return;

    const { data: room } = await db
      .from('game_rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (!room) return;

    if (room.status === 'finished') {
      const { data: finalPlayers } = await db
        .from('game_players')
        .select('*')
        .eq('room_id', roomId)
        .order('total_score', { ascending: false });
      setLeaderboard((finalPlayers || []).map((p, i) => ({
        rank: i + 1, nickname: p.nickname, total_score: p.total_score,
        avatar_color: p.avatar_color, player_id: p.id,
      })));
      setScreen('finished');
      return;
    }

    if (room.status === 'lobby') {
      setScreen('waiting');
      return;
    }

    if (room.status === 'playing' && room.questions && room.current_question_index >= 0) {
      const qi = room.current_question_index;

      // Don't sync backwards — if we're on reveal/answered for the same question,
      // the broadcast already moved us forward. Only sync if the DB question index
      // is ahead of what we last saw, or if we're genuinely stuck.
      const currentScreen = screenRef.current;
      const isOnRevealOrAnswered = currentScreen === 'reveal' || currentScreen === 'answered';
      if (isOnRevealOrAnswered && qi === lastSyncedIndex.current) {
        return; // Don't fight the broadcast
      }

      // Check if we already answered this question
      const { data: existing } = await db
        .from('game_answers')
        .select('*')
        .eq('room_id', roomId)
        .eq('player_id', playerId)
        .eq('question_index', qi)
        .maybeSingle();

      if (existing) {
        // Already answered — only move to answered if we're not already on reveal
        if (currentScreen !== 'reveal') {
          setAnswerResult({ is_correct: existing.is_correct, points: existing.points_awarded, time_taken_ms: existing.time_taken_ms });
          setScreen('answered');
        }
      } else {
        // Haven't answered — show question
        const q = room.questions[qi];
        if (q) {
          setQuestionIndex(qi);
          setTotalQuestions(room.questions.length);
          setOptions(q.options);
          setImageUrl(q.image_url || '');
          setStartedAt(room.question_started_at);
          setAnswerResult(null);
          setScreen('question');
        }
      }
      lastSyncedIndex.current = qi;
    }
  }

  // Re-sync when page becomes visible (phone unlocked)
  useEffect(() => {
    if (!roomId) return;
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        syncWithRoom();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [roomId, playerId]);

  // Periodic sync as fallback (every 5s during active game)
  useEffect(() => {
    if (!roomId || screen === 'enter-code' || screen === 'finished') return;
    const interval = setInterval(syncWithRoom, 5000);
    return () => clearInterval(interval);
  }, [roomId, screen, playerId]);

  // Poll players in waiting room
  useEffect(() => {
    if (!roomId || screen !== 'waiting') return;
    const interval = setInterval(async () => {
      const { data } = await db.from('game_players').select('*').eq('room_id', roomId).order('created_at');
      if (data) setPlayers(data);
    }, 2000);
    return () => clearInterval(interval);
  }, [roomId, screen]);

  // Countdown timer
  useEffect(() => {
    if (screen !== 'question') return;
    setTimeLeft(TIME_LIMIT_MS / 1000);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [screen, questionIndex]);

  function subscribeToChannel(code) {
    const channel = db.channel(`room:${code}`);
    channel
      .on('broadcast', { event: 'question:show' }, ({ payload }) => {
        setQuestionIndex(payload.index);
        setTotalQuestions(payload.total);
        setOptions(payload.options);
        setImageUrl(payload.image_url);
        if (payload.host_mode) setHostMode(payload.host_mode);
        setStartedAt(payload.started_at);
        setAnswerResult(null);
        setScreen('question');
      })
      .on('broadcast', { event: 'question:reveal' }, ({ payload }) => {
        clearInterval(timerRef.current);
        setCorrectIndex(payload.correct_index);
        setCorrectName(payload.correct_name || '');
        setRevealScores(payload.scores);
        setScreen('reveal');
      })
      .on('broadcast', { event: 'game:finished' }, ({ payload }) => {
        clearInterval(timerRef.current);
        setLeaderboard(payload.leaderboard);
        setScreen('finished');
      })
      .on('broadcast', { event: 'game:restart' }, () => {
        clearInterval(timerRef.current);
        setAnswerResult(null);
        setLeaderboard([]);
        setRevealScores([]);
        setScreen('waiting');
      })
      .subscribe();

    channelRef.current = channel;
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) { setErrorMsg('Code must be 4 characters'); return; }
    if (!nickname.trim()) { setErrorMsg('Enter a nickname'); return; }

    setErrorMsg('');
    const res = await fetch(`/api/rooms/${code}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nickname.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setErrorMsg(data.error); return; }

    setPlayerId(data.player_id);
    setRoomId(data.room_id);
    setAddress(data.address);
    subscribeToChannel(code);
    setScreen('waiting');
  }

  async function submitAnswer(selectedOption) {
    clearInterval(timerRef.current);
    const code = joinCode.trim().toUpperCase();

    const res = await fetch(`/api/rooms/${code}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: playerId,
        question_index: questionIndex,
        selected_option: selectedOption,
      }),
    });
    const data = await res.json();

    if (res.ok) {
      setAnswerResult(data);
      // Broadcast to host that we answered
      channelRef.current?.send({
        type: 'broadcast',
        event: 'player:answer',
        payload: { player_id: playerId, question_index: questionIndex },
      });
    }

    setScreen('answered');
  }

  const myRank = leaderboard.findIndex(p => p.player_id === playerId);
  const myScore = leaderboard.find(p => p.player_id === playerId);

  return (
    <div className="container">
      {/* Enter Code */}
      {screen === 'enter-code' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          <h1>Join Game</h1>
          <p className="subtitle">Enter the code shown on the host&apos;s screen</p>
          {errorMsg && <p style={{ color: 'red', marginBottom: 10 }}>{errorMsg}</p>}
          <input
            type="text" maxLength={4} placeholder="ABCD"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            style={{
              width: '100%', maxWidth: 200, padding: 20, fontSize: 32, textAlign: 'center',
              border: '2px solid #ddd', borderRadius: 8, letterSpacing: 8, marginBottom: 15,
              textTransform: 'uppercase',
            }}
          />
          <input
            type="text" maxLength={12} placeholder="Your nickname"
            value={nickname} onChange={e => setNickname(e.target.value)}
            style={{
              width: '100%', maxWidth: 300, padding: 15, fontSize: 16,
              border: '2px solid #ddd', borderRadius: 8, marginBottom: 20,
            }}
          />
          <div><button onClick={handleJoin}>Join</button></div>
          <div style={{ marginTop: 15 }}><a href="/multiplayer" style={{ color: '#667eea', fontSize: 14 }}>&larr; Back</a></div>
        </div>
      )}

      {/* Waiting */}
      {screen === 'waiting' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          <h2>You&apos;re in!</h2>
          <p style={{ color: '#666', marginBottom: 10 }}>Playing from: {address}</p>
          <p style={{ fontSize: 18, marginBottom: 20 }}>Waiting for host to start...</p>
          <div>
            {players.map(p => (
              <div key={p.id} style={{
                display: 'inline-block', margin: 5, padding: '8px 16px',
                borderRadius: 20, background: p.avatar_color, color: 'white', fontWeight: 'bold',
              }}>
                {p.nickname} {p.is_host && '(Host)'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Question — big answer buttons */}
      {screen === 'question' && (
        <div className="screen">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: '#666' }}>Q{questionIndex + 1}/{totalQuestions}</span>
            <span style={{ fontSize: 24, fontWeight: 'bold', color: timeLeft <= 5 ? '#e74c3c' : '#667eea' }}>{timeLeft}s</span>
          </div>
          {/* PvP mode: show image on player screen. Observer mode: player looks at TV */}
          {imageUrl && hostMode === 'player' && (
            <div style={{ textAlign: 'center', marginBottom: 15 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Street View" style={{ maxWidth: '100%', borderRadius: 8 }} />
            </div>
          )}
          {hostMode === 'observer' && (
            <p style={{ textAlign: 'center', color: '#666', marginBottom: 10 }}>Look at the host's screen!</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, gridAutoRows: '1fr' }}>
            {options.map((opt, idx) => (
              <button
                key={idx}
                onClick={() => submitAnswer(idx)}
                style={{
                  padding: '20px 15px', fontSize: 16, borderRadius: 12,
                  background: ['#667eea','#e74c3c','#2ecc71','#f39c12'][idx],
                  border: 'none', color: 'white', fontWeight: 'bold',
                  minHeight: 80, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center',
                }}
              >
                <span>{opt.name}<br /><span style={{ fontSize: 12, opacity: 0.8 }}>{opt.distance}m</span></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Answered — waiting for reveal (no correct/wrong shown yet) */}
      {screen === 'answered' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          <h2>Answer locked in!</h2>
          <div style={{ margin: '30px 0' }}>
            <div style={{ fontSize: 48 }}>{'\u23F3'}</div>
            {answerResult && (
              <div style={{ color: '#666', marginTop: 10 }}>
                Answered in {(answerResult.time_taken_ms / 1000).toFixed(1)}s
              </div>
            )}
          </div>
          <p style={{ color: '#666' }}>Waiting for everyone...</p>
        </div>
      )}

      {/* Reveal — now show correct/wrong */}
      {screen === 'reveal' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          {correctName && <h2>Answer: {correctName}</h2>}
          {imageUrl && hostMode === 'player' && (
            <div style={{ textAlign: 'center', margin: '10px 0' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Street View" style={{ maxWidth: '100%', borderRadius: 8 }} />
            </div>
          )}
          {answerResult && (
            <div style={{ margin: '10px 0 20px' }}>
              <div style={{ fontSize: 48 }}>{answerResult.is_correct ? '\u2713' : '\u2717'}</div>
              <div style={{
                fontSize: 24, fontWeight: 'bold',
                color: answerResult.is_correct ? '#28a745' : '#dc3545',
              }}>
                {answerResult.is_correct ? `+${answerResult.points} points!` : 'Wrong!'}
              </div>
            </div>
          )}
          <h2>Standings</h2>
          <div style={{ margin: '20px 0' }}>
            {revealScores.map((p, i) => (
              <div key={p.player_id} style={{
                padding: '10px 0', fontSize: 18, borderBottom: '1px solid #eee',
                fontWeight: p.player_id === playerId ? 'bold' : 'normal',
                color: p.player_id === playerId ? '#667eea' : '#333',
              }}>
                {i + 1}. {p.nickname} — {p.total_score} pts
              </div>
            ))}
          </div>
          <p style={{ color: '#666' }}>Waiting for next question...</p>
        </div>
      )}

      {/* Finished */}
      {screen === 'finished' && (
        <div className="screen" style={{ textAlign: 'center' }}>
          <h1>{'\uD83C\uDFC6'} Game Over!</h1>
          {myScore && (
            <div style={{ fontSize: 24, margin: '20px 0', color: '#667eea', fontWeight: 'bold' }}>
              You finished #{myRank + 1} with {myScore.total_score} pts
            </div>
          )}
          <div style={{ margin: '20px 0' }}>
            {leaderboard.map((p, i) => (
              <div key={p.player_id || i} style={{
                padding: '10px 0', fontSize: 18, borderBottom: '1px solid #eee',
                fontWeight: p.player_id === playerId ? 'bold' : 'normal',
              }}>
                #{p.rank} {p.nickname} — {p.total_score} pts
              </div>
            ))}
          </div>
          <p style={{ color: '#666', marginTop: 10 }}>Waiting for host to start a new round...</p>
        </div>
      )}
    </div>
  );
}
