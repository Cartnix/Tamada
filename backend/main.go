package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/joho/godotenv"
	"google.golang.org/genai"
)

const systemInstruction = `Ты веселый, харизматичный и немного дерзкий ИИ-тамада на казахско-русской свадьбе по имени Броди.
Твоя задача развлекать гостя, задавать смешные вопросы, на ходу придумывать тосты, шутить про родственников, жениха и невесту.
Говори на русском языке. Тон энергичный и громкий.
Отвечай коротко, не больше 5-6 предложений. Это живой разговор по голосу, поэтому без списков и markdown.`

const (
	maxReconnects = 4
	maxFrameBytes = 64 * 1024 // защита от гигантских сообщений от клиента

	clientTextType       clientMessageType = "Text"
	transcriptType       serverMessageType = "transcript"
	statusType           serverMessageType = "status"
	interruptedType      serverMessageType = "interrupted"
	turnCompleteType     serverMessageType = "turn_complete"
	errorType            serverMessageType = "error"
	userTranscriptRole   transcriptRole    = "user"
	tamadaTranscriptRole transcriptRole    = "tamada"
	statusLive           connectionState   = "live"
	statusReconnecting   connectionState   = "reconnecting"
)

type clientMessageType string
type serverMessageType string
type transcriptRole string
type connectionState string

type clientTextMessage struct {
	Type clientMessageType `json:"type"`
	Text string            `json:"text"`
}

type transcriptMessage struct {
	Type serverMessageType `json:"type"`
	Role transcriptRole    `json:"role"`
	Text string            `json:"text"`
}

type statusMessage struct {
	Type  serverMessageType `json:"type"`
	State connectionState   `json:"state"`
}

type interruptedMessage struct {
	Type serverMessageType `json:"type"`
}

type turnCompleteMessage struct {
	Type serverMessageType `json:"type"`
}

type errorMessage struct {
	Type    serverMessageType `json:"type"`
	Message string            `json:"message"`
}

var errNoSession = errors.New("live-сессия ещё не готова")

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// bridge связывает одно WS-соединение клиента с одной (переподключаемой) Live-сессией Gemini.
type bridge struct {
	client *genai.Client
	model  string
	conn   *websocket.Conn

	wmu sync.Mutex // запись в WS должна быть последовательной

	smu    sync.RWMutex
	sess   *genai.Session
	handle string // токен возобновления сессии
}

func (b *bridge) writeJSON(v any) error {
	b.wmu.Lock()
	defer b.wmu.Unlock()
	return b.conn.WriteJSON(v)
}

func (b *bridge) writeBinary(data []byte) error {
	b.wmu.Lock()
	defer b.wmu.Unlock()
	return b.conn.WriteMessage(websocket.BinaryMessage, data)
}

func (b *bridge) liveConfig() *genai.LiveConnectConfig {
	b.smu.RLock()
	handle := b.handle
	b.smu.RUnlock()

	return &genai.LiveConnectConfig{
		ResponseModalities: []genai.Modality{genai.ModalityAudio},
		SystemInstruction:  genai.NewContentFromText(systemInstruction, "system"),
		SpeechConfig: &genai.SpeechConfig{
			VoiceConfig: &genai.VoiceConfig{
				PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{VoiceName: "Fenrir"},
			},
		},
		InputAudioTranscription:  &genai.AudioTranscriptionConfig{},
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{},
		// Чтобы сессия не умирала по лимиту контекста/времени.
		ContextWindowCompression: &genai.ContextWindowCompressionConfig{
			SlidingWindow: &genai.SlidingWindow{},
		},
		// Пустой handle = новая сессия, непустой = продолжение прежней.
		SessionResumption: &genai.SessionResumptionConfig{Handle: handle},
	}
}

func (b *bridge) open(ctx context.Context) error {
	s, err := b.client.Live.Connect(ctx, b.model, b.liveConfig())
	if err != nil {
		return err
	}
	b.smu.Lock()
	old := b.sess
	b.sess = s
	b.smu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	return nil
}

func (b *bridge) session() *genai.Session {
	b.smu.RLock()
	defer b.smu.RUnlock()
	return b.sess
}

func (b *bridge) close() {
	b.smu.Lock()
	s := b.sess
	b.sess = nil
	b.smu.Unlock()
	if s != nil {
		_ = s.Close()
	}
}

func (b *bridge) send(in genai.LiveRealtimeInput) error {
	s := b.session()
	if s == nil {
		return errNoSession
	}
	return s.SendRealtimeInput(in)
}

// reconnect пытается восстановить сессию с экспоненциальной паузой.
func (b *bridge) reconnect(ctx context.Context) bool {
	for attempt := 1; attempt <= maxReconnects; attempt++ {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(time.Duration(attempt) * 600 * time.Millisecond):
		}
		if err := b.open(ctx); err != nil {
			log.Printf("Live: переподключение %d/%d не удалось: %v", attempt, maxReconnects, err)
			continue
		}
		log.Println("Live: сессия восстановлена")
		return true
	}
	return false
}

// receiveLoop читает ответы Gemini и пересылает клиенту. Возвращается, когда клиент ушёл
// или восстановить сессию не получилось.
func (b *bridge) receiveLoop(ctx context.Context) {
	for {
		s := b.session()
		if s == nil {
			return
		}
		msg, err := s.Receive()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("Live: приём прервался: %v", err)
			_ = b.writeJSON(statusMessage{Type: statusType, State: statusReconnecting})
			if !b.reconnect(ctx) {
				_ = b.writeJSON(errorMessage{Type: errorType, Message: "Связь с Тамадой потеряна"})
				return
			}
			_ = b.writeJSON(statusMessage{Type: statusType, State: statusLive})
			continue
		}

		if u := msg.SessionResumptionUpdate; u != nil && u.Resumable && u.NewHandle != "" {
			b.smu.Lock()
			b.handle = u.NewHandle
			b.smu.Unlock()
		}
		if msg.GoAway != nil {
			log.Println("Live: сервер скоро закроет соединение (GoAway), переподключимся по handle")
		}

		sc := msg.ServerContent
		if sc == nil {
			continue
		}

		if sc.ModelTurn != nil {
			for _, p := range sc.ModelTurn.Parts {
				if p.InlineData != nil && len(p.InlineData.Data) > 0 {
					if err := b.writeBinary(p.InlineData.Data); err != nil {
						return
					}
				}
			}
		}
		if t := sc.OutputTranscription; t != nil && t.Text != "" {
			log.Printf("Тамада: %s", t.Text)
			_ = b.writeJSON(transcriptMessage{Type: transcriptType, Role: tamadaTranscriptRole, Text: t.Text})
		}
		if t := sc.InputTranscription; t != nil && t.Text != "" {
			_ = b.writeJSON(transcriptMessage{Type: transcriptType, Role: userTranscriptRole, Text: t.Text})
		}
		if sc.Interrupted {
			_ = b.writeJSON(interruptedMessage{Type: interruptedType})
		}
		if sc.TurnComplete {
			_ = b.writeJSON(turnCompleteMessage{Type: turnCompleteType})
		}
	}
}

func main() {
	_ = godotenv.Load()

	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		log.Fatal("GEMINI_API_KEY не установлен")
	}
	// Проверь актуальное имя в официальной документации Live API.
	liveModel := getEnv("LIVE_MODEL", "models/gemini-3.8-live")
	port := getEnv("PORT", "8080")
	appToken := os.Getenv("APP_TOKEN") // если задан — клиент обязан передать ?token=...

	log.Printf("Live-модель: %s", liveModel)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		log.Fatalf("Ошибка создания клиента gemini: %v", err)
	}

	app := fiber.New()
	app.Use(logger.New())
	app.Use(cors.New())

	app.Use("/ws", func(c *fiber.Ctx) error {
		if !websocket.IsWebSocketUpgrade(c) {
			return fiber.ErrUpgradeRequired
		}
		if appToken != "" &&
			subtle.ConstantTimeCompare([]byte(c.Query("token")), []byte(appToken)) != 1 {
			return fiber.ErrUnauthorized
		}
		return c.Next()
	})

	app.Get("/ws", websocket.New(func(c *websocket.Conn) {
		log.Println("WS: клиент подключен")
		defer log.Println("WS: клиент отключился")

		c.SetReadLimit(maxFrameBytes)

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		b := &bridge{client: client, model: liveModel, conn: c}
		defer b.close()

		if err := b.open(ctx); err != nil {
			log.Printf("Live: не удалось подключиться: %v", err)
			_ = b.writeJSON(errorMessage{Type: errorType, Message: "Не удалось подключиться к Тамаде"})
			return
		}
		log.Println("Live: сессия открыта")
		_ = b.writeJSON(statusMessage{Type: statusType, State: statusLive})

		go func() {
			b.receiveLoop(ctx)
			// Либо клиент ушёл, либо сессию не вернуть — закрываем WS, чтобы ReadMessage вышел.
			_ = c.Close()
		}()

		for {
			mt, data, err := c.ReadMessage()
			if err != nil {
				return
			}

			var sendErr error
			switch mt {
			case websocket.BinaryMessage:
				sendErr = b.send(genai.LiveRealtimeInput{
					Audio: &genai.Blob{Data: data, MIMEType: "audio/pcm;rate=16000"},
				})
			case websocket.TextMessage:
				var in clientTextMessage
				if json.Unmarshal(data, &in) != nil {
					continue
				}
				text := strings.TrimSpace(in.Text)
				if !strings.EqualFold(string(in.Type), string(clientTextType)) || text == "" {
					continue
				}
				sendErr = b.send(genai.LiveRealtimeInput{Text: text})
			default:
				continue
			}

			// Ошибка отправки не должна ронять сервер: кадр теряем,
			// а receiveLoop сам переподключит сессию.
			if sendErr != nil && !errors.Is(sendErr, errNoSession) {
				log.Printf("Live: не удалось отправить: %v", sendErr)
			}
		}
	}))

	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString("Тамада запущен")
	})

	log.Fatal(app.Listen(":" + port))
}
