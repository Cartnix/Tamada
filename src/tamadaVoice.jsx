import { useCallback, useEffect, useRef, useState } from "react";
import { createClientTextMessage, parseServerMessage } from "./protocol";

/**
 * <TamadaVoice />
 * Голосовой клиент для Go-бэкенда Тамада-3000 (WebSocket /ws).
 *
 * Протокол:
 *   клиент → сервер: binary = PCM16 mono 16 kHz; text = {"type":"Text","text":"..."}
 *   сервер → клиент: binary = PCM16 mono 24 kHz;
 *                    text   = {type: transcript|interrupted|turn_complete|status|error}
 *
 * Props:
 *   wsUrl    — адрес WebSocket (по умолчанию тот же хост, порт 8080)
 *   token    — значение APP_TOKEN, если включил на сервере
 *   greeting — что «сказать» Тамаде при старте, чтобы он заговорил первым
 *
 * Микрофон работает только на HTTPS или localhost.
 */

const IN_RATE = 16000;
const OUT_RATE = 24000;

const defaultWsUrl = () => {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:8080/ws`;
};

// AudioWorklet: берёт микрофон, ресемплирует в 16 kHz и отдаёт PCM16 кусками по 40 мс.
const WORKLET_CODE = `
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${IN_RATE};
    this.pos = 0;
    this.prev = 0;
    this.buf = new Int16Array(640);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let pos = this.pos;
    while (Math.floor(pos) + 1 < ch.length) {
      const i = Math.floor(pos);
      const f = pos - i;
      const a = i < 0 ? this.prev : ch[i];
      const b = ch[i + 1];
      let v = a + (b - a) * f;
      v = Math.max(-1, Math.min(1, v));
      this.buf[this.n++] = v < 0 ? v * 32768 : v * 32767;
      if (this.n === this.buf.length) {
        const out = this.buf.slice();
        this.port.postMessage(out.buffer, [out.buffer]);
        this.n = 0;
      }
      pos += this.ratio;
    }
    this.pos = pos - ch.length;
    this.prev = ch[ch.length - 1];
    return true;
  }
}
registerProcessor("mic-capture", MicCapture);
`;

const STATUS_TEXT = {
  idle: "Нажмите, чтобы позвать Тамаду",
  connecting: "Соединяю…",
  live: "Слушаю вас",
  speaking: "Тамада говорит",
  reconnecting: "Связь пропала, возвращаю Тамаду…",
};

export default function TamadaVoice({
  wsUrl,
  token,
  greeting = "Поприветствуй гостей и представься",
  onSpeakingChange,
  onUserMessage,
}) {
  const [status, setStatus] = useState("idle"); // idle | connecting | live | reconnecting
  const [speaking, setSpeaking] = useState(false);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const nodeRef = useRef(null);
  const streamRef = useRef(null);
  const sourcesRef = useRef(new Set());
  const nextTimeRef = useRef(0);
  const newBubbleRef = useRef(true);
  const closingRef = useRef(false);
  const listRef = useRef(null);
  const idRef = useRef(0);

  // ---------- воспроизведение ----------
  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((src) => {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* уже остановлен */
      }
    });
    sourcesRef.current.clear();
    nextTimeRef.current = 0;
    setSpeaking(false);
  }, []);

  const playPcm = useCallback((buf) => {
    const ctx = ctxRef.current;
    const n = buf.byteLength >> 1;
    if (!ctx || !n) return;
    const i16 = new Int16Array(buf, 0, n);
    const f32 = new Float32Array(n);
    for (let i = 0; i < n; i++) f32[i] = i16[i] / 32768;

    const audio = ctx.createBuffer(1, n, OUT_RATE);
    audio.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.03, nextTimeRef.current);
    src.start(startAt);
    nextTimeRef.current = startAt + audio.duration;

    sourcesRef.current.add(src);
    setSpeaking(true);
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (sourcesRef.current.size === 0) setSpeaking(false);
    };
  }, []);

  // ---------- транскрипты ----------
  const addTranscript = useCallback((role, text) => {
    const forceNew = newBubbleRef.current;
    newBubbleRef.current = false;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && !forceNew) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: ++idRef.current, role, text }];
    });
  }, []);

  // ---------- остановка ----------
  const stop = useCallback(() => {
    closingRef.current = true;
    stopPlayback();
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    }
    if (nodeRef.current) {
      nodeRef.current.port.onmessage = null;
      nodeRef.current.disconnect();
      nodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setStatus("idle");
  }, [stopPlayback]);

  // ---------- старт ----------
  const start = useCallback(async () => {
    setError("");
    closingRef.current = false;
    newBubbleRef.current = true;

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Микрофон доступен только по HTTPS или на localhost.");
      return;
    }

    setStatus("connecting");
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const url = URL.createObjectURL(
        new Blob([WORKLET_CODE], { type: "application/javascript" })
      );
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const base = wsUrl || defaultWsUrl();
      const full = token
        ? `${base}${base.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
        : base;
      const ws = new WebSocket(full);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        const mic = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "mic-capture");
        nodeRef.current = node;
        node.port.onmessage = (e) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
        };
        // worklet должен быть подключён к выходу, иначе часть браузеров его не гоняет
        const mute = ctx.createGain();
        mute.gain.value = 0;
        mic.connect(node);
        node.connect(mute);
        mute.connect(ctx.destination);

        if (greeting) ws.send(JSON.stringify({ type: "Text", text: greeting }));
      };

      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          playPcm(e.data);
          return;
        }
        const msg = parseServerMessage(e.data);
        if (!msg) return;
        switch (msg.type) {
          case "transcript":
            addTranscript(msg.role, msg.text);
            if (msg.role === "user" && typeof msg.text === "string") {
              onUserMessage?.(msg.text);
            }
            break;
          case "interrupted":
            stopPlayback();
            newBubbleRef.current = true;
            break;
          case "turn_complete":
            newBubbleRef.current = true;
            break;
          case "status":
            setStatus(msg.state === "reconnecting" ? "reconnecting" : "live");
            break;
          case "error":
            setError(msg.message || "Что-то пошло не так");
            break;
          default:
        }
      };

      ws.onclose = () => {
        if (!closingRef.current) {
          setError((prev) => prev || "Соединение закрыто. Попробуйте ещё раз.");
          stop();
        }
      };
      ws.onerror = () => {
        setError("Не удалось подключиться к серверу.");
      };
    } catch (err) {
      const denied = err && err.name === "NotAllowedError";
      setError(
        denied
          ? "Нет доступа к микрофону. Разрешите его в настройках браузера."
          : "Не получилось запустить звук: " + (err?.message || err)
      );
      stop();
    }
  }, [wsUrl, token, greeting, onUserMessage, playPcm, stopPlayback, addTranscript, stop]);

  const sendText = useCallback(() => {
    const text = draft.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(createClientTextMessage(text)));
    newBubbleRef.current = true;
    setMessages((prev) => [...prev, { id: ++idRef.current, role: "user", text }]);
    onUserMessage?.(text);
    setDraft("");
  }, [draft, onUserMessage]);

  useEffect(() => () => stop(), [stop]);

    // Отправляем состояние speaking наружу
  useEffect(() => {
    if (onSpeakingChange) {
      onSpeakingChange(speaking);
    }
  }, [speaking, onSpeakingChange]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const active = status !== "idle";
  const shown = status === "live" && speaking ? "speaking" : status;
  const orbLabel = status === "idle" ? "Позвать" : status === "connecting" ? "…" : "Закончить";

  return (
    <section className="tm-root" aria-label="Броди">
      <style>{CSS}</style>

      <h2 className="tm-title">Броди</h2>

      <div className={`tm-stage ${speaking ? "is-speaking" : ""} ${active ? "is-active" : ""}`}>
        <button
          type="button"
          className="tm-orb"
          onClick={active ? stop : start}
          disabled={status === "connecting"}
          aria-label={active ? "Закончить разговор" : "Позвать Тамаду"}
        >
          {orbLabel}
        </button>
      </div>

      <p className="tm-status" role="status">
        {STATUS_TEXT[shown]}
      </p>
      {error && (
        <p className="tm-error" role="alert">
          {error}
        </p>
      )}

      <div className="tm-log" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="tm-empty">
            Здесь появится разговор. Говорите в микрофон или напишите Тамаде ниже.
          </p>
        ) : (
          messages.map((m) => (
            <p key={m.id} className={`tm-msg tm-${m.role}`}>
              {m.text}
            </p>
          ))
        )}
      </div>

      <div className="tm-compose">
        <input
          className="tm-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendText()}
          placeholder="Написать Тамаде"
          disabled={status !== "live"}
          aria-label="Сообщение Тамаде"
        />
        <button
          type="button"
          className="tm-send"
          onClick={sendText}
          disabled={status !== "live" || !draft.trim()}
        >
          Отправить
        </button>
      </div>
    </section>
  );
}

const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,600;0,800;1,400&display=swap");

.tm-root {
  --lapis: #12264a;
  --deep: #0b1830;
  --gold: #e2b25a;
  --gold-soft: rgba(226, 178, 90, 0.16);
  --ivory: #f5eddb;
  --ruby: #d4566a;
  box-sizing: border-box;
  max-width: 460px;
  margin: 0 auto;
  padding: 28px 22px 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--ivory);
  background: linear-gradient(170deg, var(--lapis), var(--deep));
  border-radius: 28px;
  font-family: "Alegreya", Georgia, "Times New Roman", serif;
  font-size: 18px;
  line-height: 1.5;
}
.tm-root *, .tm-root *::before, .tm-root *::after { box-sizing: border-box; }

.tm-title {
  margin: 0;
  font-size: 34px;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: var(--gold);
}

.tm-stage {
  position: relative;
  width: 200px;
  height: 200px;
  margin: 18px 0 14px;
  display: grid;
  place-items: center;
}
.tm-stage::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px dashed rgba(226, 178, 90, 0.55);
  pointer-events: none;
}
.tm-stage.is-speaking::before { animation: tm-spin 14s linear infinite; }
.tm-stage::after {
  content: "";
  position: absolute;
  inset: 12px;
  border-radius: 50%;
  border: 1px solid var(--gold-soft);
  pointer-events: none;
}

.tm-orb {
  width: 150px;
  height: 150px;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  font: inherit;
  font-size: 24px;
  font-weight: 800;
  color: var(--deep);
  background: radial-gradient(circle at 35% 28%, #f6dc98, var(--gold) 50%, #b8862e);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.tm-orb:hover:not(:disabled) { transform: scale(1.03); }
.tm-orb:active:not(:disabled) { transform: scale(0.97); }
.tm-orb:disabled { cursor: progress; opacity: 0.8; }
.tm-stage.is-active .tm-orb { background: radial-gradient(circle at 35% 28%, #f9ead0, var(--ivory) 55%, #cdbd98); }
.tm-stage.is-speaking .tm-orb { animation: tm-pulse 1.1s ease-in-out infinite; }

.tm-orb:focus-visible,
.tm-send:focus-visible,
.tm-input:focus-visible { outline: 3px solid var(--ivory); outline-offset: 3px; }

.tm-status { margin: 0; min-height: 1.5em; font-style: italic; color: rgba(245, 237, 219, 0.85); text-align: center; }
.tm-error {
  margin: 0;
  padding: 8px 14px;
  border-radius: 12px;
  color: #ffd9de;
  background: rgba(212, 86, 106, 0.2);
  border: 1px solid var(--ruby);
  text-align: center;
}

.tm-log {
  width: 100%;
  height: 240px;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-radius: 18px;
  background: rgba(0, 0, 0, 0.22);
}
.tm-empty { margin: auto; text-align: center; color: rgba(245, 237, 219, 0.6); }
.tm-msg { margin: 0; padding: 8px 14px; max-width: 86%; border-radius: 16px; overflow-wrap: anywhere; }
.tm-tamada { align-self: flex-start; background: var(--gold-soft); border: 1px solid rgba(226, 178, 90, 0.4); }
.tm-user { align-self: flex-end; background: rgba(245, 237, 219, 0.12); }

.tm-compose { width: 100%; display: flex; gap: 8px; }
.tm-input {
  flex: 1;
  min-width: 0;
  padding: 10px 14px;
  font: inherit;
  color: var(--ivory);
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(245, 237, 219, 0.3);
  border-radius: 14px;
}
.tm-input::placeholder { color: rgba(245, 237, 219, 0.5); }
.tm-input:disabled, .tm-send:disabled { opacity: 0.5; cursor: not-allowed; }
.tm-send {
  padding: 10px 16px;
  font: inherit;
  font-weight: 600;
  color: var(--deep);
  background: var(--gold);
  border: 0;
  border-radius: 14px;
  cursor: pointer;
}

@keyframes tm-spin { to { transform: rotate(360deg); } }
@keyframes tm-pulse {
  0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,.4), 0 0 0 0 rgba(226,178,90,.45); }
  50% { box-shadow: 0 10px 30px rgba(0,0,0,.4), 0 0 0 18px rgba(226,178,90,0); }
}
@media (prefers-reduced-motion: reduce) {
  .tm-stage.is-speaking::before, .tm-stage.is-speaking .tm-orb { animation: none; }
}
`;