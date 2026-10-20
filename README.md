# Tamada

## WebSocket contract and CI

JSON messages exchanged between the React client and Go backend are defined in
[`shared/websocket.schema.json`](./shared/websocket.schema.json). Generate the
frontend types after changing the schema:

```sh
npm run generate:protocol
```

The CI workflow checks that generated types are current, type-checks the
protocol client, and runs the frontend lint/build and Go formatting, vet, test,
and build checks. Run the protocol checks locally with:

```sh
npm run check:protocol
npm run typecheck
cd backend && go test ./...
```
