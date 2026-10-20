package main

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

func TestWebSocketMessagesMatchSharedSchema(t *testing.T) {
	schemaJSON, err := os.ReadFile("../shared/websocket.schema.json")
	if err != nil {
		t.Fatalf("read shared WebSocket schema: %v", err)
	}

	var schemaDocument any
	if err := json.Unmarshal(schemaJSON, &schemaDocument); err != nil {
		t.Fatalf("decode shared WebSocket schema: %v", err)
	}

	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("websocket.schema.json", schemaDocument); err != nil {
		t.Fatalf("add shared WebSocket schema: %v", err)
	}
	schema, err := compiler.Compile("websocket.schema.json")
	if err != nil {
		t.Fatalf("compile shared WebSocket schema: %v", err)
	}

	messages := []struct {
		name    string
		message any
	}{
		{"client text", clientTextMessage{Type: clientTextType, Text: "Давайте танцевать"}},
		{"user transcript", transcriptMessage{Type: transcriptType, Role: userTranscriptRole, Text: "Давайте танцевать"}},
		{"tamada transcript", transcriptMessage{Type: transcriptType, Role: tamadaTranscriptRole, Text: "С удовольствием!"}},
		{"live status", statusMessage{Type: statusType, State: statusLive}},
		{"reconnecting status", statusMessage{Type: statusType, State: statusReconnecting}},
		{"interrupted", interruptedMessage{Type: interruptedType}},
		{"turn complete", turnCompleteMessage{Type: turnCompleteType}},
		{"error", errorMessage{Type: errorType, Message: "Соединение потеряно"}},
	}

	for _, test := range messages {
		t.Run(test.name, func(t *testing.T) {
			payload, err := json.Marshal(test.message)
			if err != nil {
				t.Fatalf("marshal message: %v", err)
			}

			var value any
			if err := json.Unmarshal(payload, &value); err != nil {
				t.Fatalf("decode marshaled message: %v", err)
			}
			if err := schema.Validate(value); err != nil {
				t.Errorf("message does not match shared WebSocket schema: %v", err)
			}
		})
	}

	invalidMessages := []any{
		map[string]any{"type": transcriptType, "text": "missing role"},
		map[string]any{"type": statusType, "state": "offline"},
		map[string]any{"type": interruptedType, "unexpected": true},
	}
	for _, message := range invalidMessages {
		if err := schema.Validate(message); err == nil {
			t.Errorf("invalid message unexpectedly matched shared WebSocket schema: %#v", message)
		}
	}
}
