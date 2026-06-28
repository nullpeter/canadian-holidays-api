# Canadian Holidays API

Statutory and public holidays for all 13 Canadian provinces and territories — algorithmically calculated, no hardcoded dates, no database.

## Built for AI agents and LLM tool use

LLMs hallucinate holiday dates. This API doesn't. It's designed as a reliable, low-latency tool call for agents and AI-powered applications that need ground-truth Canadian holiday data:

- **Deterministic** — algorithmic date calculation (Easter, floating Mondays, observed weekend shifts) with no ambiguity
- **Structured JSON** — clean, consistent responses with predictable schemas, ideal for function calling and tool use
- **OpenAPI 3.1 spec** — drop the [`openapi.yaml`](./openapi.yaml) into any agent framework for automatic tool generation
- **Closure context** — each holiday includes whether federal offices, Canada Post, banks, schools, and retail are closed, so agents can reason about business-day availability
- **`/next` endpoint** — purpose-built for "is today/tomorrow a holiday?" agent queries
- **Stateless** — no sessions, no pagination, no side effects; safe to call at any frequency

Supports any year 2000–3000, all 13 provinces and territories.

## Get started

Subscribe via RapidAPI: **[Canadian Holidays API on RapidAPI](https://rapidapi.com/poodleapis/api/canadian-holidays-api)**

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/provinces` | All province and territory codes and names |
| GET | `/holidays?year=YYYY&province=XX` | Holidays for a specific province |
| GET | `/holidays?year=YYYY` | Holidays for all provinces in one response |
| GET | `/next?province=XX` | Next upcoming holiday for a province |

## Example response

`GET /next?province=ON`

```json
{
  "province": "ON",
  "provinceName": "Ontario",
  "next": {
    "name": "Canada Day",
    "date": "2026-07-01",
    "closures": {
      "federal_offices": true,
      "canada_post": true,
      "banks": true,
      "schools": true,
      "retail": "open"
    }
  }
}
```

## OpenAPI spec

Machine-readable definition at [`openapi.yaml`](./openapi.yaml), indexed on [apis.guru](https://apis.guru).

## Built with

- Cloudflare Workers
- Zero dependencies
