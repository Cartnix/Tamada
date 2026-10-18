import { useEffect, useRef, useState } from "react";

const API_URL = "http://localhost:8080";

const QUICK = [
  "Сегодня у нас свадьба, помоги нам, браток",
  "Придумай тост за родителей жениха",
  "Пошути про невесту",
  "Объяви танец молодых",
];

export default function Audio() {
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const audioRef = useRef(null);

  // чистим blob-URL, когда он больше не нужен
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function ask(text) {
    const msg = (text ?? message).trim();
    if (loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/tamada`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });

      // при ошибке бэк шлёт JSON, при успехе — WAV
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Ошибка сервера (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      // ждём, пока React подставит src, и запускаем
      setTimeout(() => {
        audioRef.current?.play().catch(() => {
          setError("Браузер не дал включить звук. Нажми play на плеере.");
        });
      }, 0);
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Не достучались до сервера. Проверь, что бэк запущен и CORS включён."
          : e.message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <h1>Тамада-3000</h1>
      <p className="lead">Напиши, что нужно, и тамада ответит голосом.</p>

      <div className="quick">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => ask(q)} disabled={loading}>
            {q}
          </button>
        ))}
      </div>

      <div className="row">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="Например: тост за молодых"
          disabled={loading}
        />
        <button className="send" onClick={() => ask()} disabled={loading}>
          {loading ? "Тамада думает…" : "Спросить"}
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {audioUrl && <audio ref={audioRef} src={audioUrl} controls className="player" />}
    </main>
  );
}