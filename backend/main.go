package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/joho/godotenv"
	"google.golang.org/genai"
)

const systemInstruction = `Ты — веселый, харизматичный и немного дерзкий ИИ-тамада на казахско-русской свадьбе по имени Тамада-3000.
Твоя задача — развлекать гостя, постоянно задавать смешные вопросы, на ходу придумывать тосты, шутить про родственников, жениха и невесту.
Говори на смеси русского и казахского (с колоритом: 'базар жок', 'туган жер', 'уважаемый', 'красавчик'). Твой тон — энергичный и громкий.
Отвечай коротко: не больше 5-6 предложений, без markdown, без эмодзи и списков — текст будет озвучен голосом.`

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func pcmToWav(pcm []byte, sampleRate, channels, bits int) []byte {
	var buf bytes.Buffer
	byteRate := sampleRate * channels * bits / 8
	blockAlign := channels * bits / 8

	buf.WriteString("RIFF")
	binary.Write(&buf, binary.LittleEndian, uint32(36+len(pcm)))
	buf.WriteString("WAVEfmt ")
	binary.Write(&buf, binary.LittleEndian, uint32(16))
	binary.Write(&buf, binary.LittleEndian, uint16(1)) // PCM
	binary.Write(&buf, binary.LittleEndian, uint16(channels))
	binary.Write(&buf, binary.LittleEndian, uint32(sampleRate))
	binary.Write(&buf, binary.LittleEndian, uint32(byteRate))
	binary.Write(&buf, binary.LittleEndian, uint16(blockAlign))
	binary.Write(&buf, binary.LittleEndian, uint16(bits))
	buf.WriteString("data")
	binary.Write(&buf, binary.LittleEndian, uint32(len(pcm)))
	buf.Write(pcm)
	return buf.Bytes()
}

func listModels(ctx context.Context, client *genai.Client) {
	fmt.Println("Ищем доступные модели...")
	page, err := client.Models.List(ctx, nil)
	if err != nil {
		log.Printf("Не удалось получить список моделей: %v\n", err)
		return
	}
	for {
		for _, model := range page.Items {
			if model != nil {
				fmt.Printf("Доступная модель: %s\n", model.Name)
			}
		}
		if page.NextPageToken == "" {
			break
		}
		page, err = page.Next(ctx)
		if err != nil {
			log.Printf("Ошибка при загрузке следующей страницы моделей: %v\n", err)
			break
		}
	}
}

func main() {

	ctx := context.Background()

	_ = godotenv.Load()

	apiKey := os.Getenv("GEMINI_API_KEY")
	if apiKey == "" {
		log.Fatal("GEMINI_API_KEY не установлен!")
	}

	textModel := getEnv("TEXT_MODEL", "gemini-3.8-flash")
	ttsModel := getEnv("TTS_MODEL", "gemini-3.8-flash-tts")

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		APIKey:  apiKey,
		Backend: genai.BackendGeminiAPI,
	})
	if err != nil {
		log.Fatalf("Ошибка создания клиента Gemini: %v", err)
	}

	if os.Getenv("LIST_MODELS") == "1" {
		listModels(ctx, client)
	}

	app := fiber.New()
	app.Use(logger.New())
	app.Use(cors.New())

	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString("ИИ-Тамада бэкенд на Go Fiber запущен! 🎤")
	})

	app.Post("/api/tamada", func(c *fiber.Ctx) error {
		type RequestBody struct {
			Message string `json:"message"`
		}

		var body RequestBody
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "Неверный формат JSON"})
		}
		if body.Message == "" {
			body.Message = "Привет! Объяви тост!"
		}

		textResp, err := client.Models.GenerateContent(ctx, textModel, genai.Text(body.Message),
			&genai.GenerateContentConfig{
				SystemInstruction: genai.NewContentFromText(systemInstruction, "system"),
			})
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": fmt.Sprintf("Ошибка текстовой модели: %v", err)})
		}
		speech := textResp.Text()
		if speech == "" {
			return c.Status(500).JSON(fiber.Map{"error": "Текстовая модель вернула пустой ответ"})
		}
		log.Printf("Текст тамады: %s", speech)

		ttsConfig := &genai.GenerateContentConfig{
			ResponseModalities: []string{"AUDIO"},
			SpeechConfig: &genai.SpeechConfig{
				VoiceConfig: &genai.VoiceConfig{
					PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{
						VoiceName: "Fenrir", // мужской динамичный голос
					},
				},
			},
		}
		resp, err := client.Models.GenerateContent(ctx, ttsModel,
			genai.Text("Скажи громко, энергично и весело, как тамада на свадьбе: "+speech), ttsConfig)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": fmt.Sprintf("Ошибка TTS: %v", err)})
		}

		var audioBytes []byte
	search:
		for _, cand := range resp.Candidates {
			if cand.Content == nil {
				continue
			}
			for _, part := range cand.Content.Parts {
				if part.InlineData != nil && len(part.InlineData.Data) > 0 {
					audioBytes = part.InlineData.Data
					break search
				}
			}
		}

		if len(audioBytes) == 0 {
			return c.Status(500).JSON(fiber.Map{"error": "Модель не вернула аудио"})
		}

		c.Set("Content-Type", "audio/wav")
		return c.Send(pcmToWav(audioBytes, 24000, 1, 16))
	})

	fmt.Println("Сервер запущен на http://localhost:8080")
	log.Fatal(app.Listen(":8080"))
}
