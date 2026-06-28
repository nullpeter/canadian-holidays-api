# Canadian Holidays API

Statutory public holidays for all 13 Canadian provinces and territories.

- Per-holiday closures data (federal offices, Canada Post, banks, schools, retail)
- Algorithmic date calculation — no hardcoded data
- Supports years 2000–3000
- All 13 provinces and territories including NL nearest-Monday holidays

## Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/provinces` | All province and territory codes |
| GET | `/holidays?year=YYYY&province=XX` | Holidays for a specific province |
| GET | `/holidays?year=YYYY` | All provinces in one response |
| GET | `/next?province=XX` | Next upcoming holiday |

## Live API

Available on RapidAPI: [Canadian Holidays API](https://rapidapi.com/poodleapis/api/canadian-holidays-api)

## Built with

- Cloudflare Workers
- Zero dependencies
