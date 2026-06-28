/**
 * Canadian Holidays API — Cloudflare Worker
 *
 * Endpoints:
 *   GET /provinces                               → all province/territory codes + names
 *   GET /holidays?year=YYYY                      → all provinces, given year
 *   GET /holidays?year=YYYY&province=XX          → single province, given year
 *   GET /next?province=XX                        → next upcoming holiday for a province
 *
 * Supports years 2000–3000. All dates are calculated algorithmically.
 */

// ── Province registry ─────────────────────────────────────────────────────────

const PROVINCES = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

// ── Closure templates ─────────────────────────────────────────────────────────
//
// federal_offices : federal government offices close
// canada_post     : mail delivery suspended
// banks           : banks close (federally regulated; also follow major provincial holidays)
// schools         : schools close
// retail          : "closed"  = restricted by legislation / near-universal closure
//                   "open"    = retail permitted and generally operating
//                   "varies"  = meaningful split — verify locally

const CL = {
  fed_closed  : { federal_offices: true,  canada_post: true,  banks: true,  schools: true,  retail: "closed"  },
  fed_open    : { federal_offices: true,  canada_post: true,  banks: true,  schools: true,  retail: "open"    },
  fed_varies  : { federal_offices: true,  canada_post: true,  banks: true,  schools: true,  retail: "varies"  },
  fed_only    : { federal_offices: true,  canada_post: true,  banks: true,  schools: false, retail: "open"    }, // federal employees only; schools + retail unaffected
  prov_open   : { federal_offices: false, canada_post: false, banks: true,  schools: true,  retail: "open"    },
  prov_closed : { federal_offices: false, canada_post: false, banks: true,  schools: true,  retail: "closed"  },
  prov_varies : { federal_offices: false, canada_post: false, banks: true,  schools: true,  retail: "varies"  },
  optional    : { federal_offices: false, canada_post: false, banks: false, schools: false, retail: "open"    },
};

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Easter Sunday — Anonymous Gregorian algorithm, valid 1583–4099 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Add n days to a Date, returning a new Date */
function addDays(d, n) {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** nth weekday (0=Sun … 6=Sat) of a given month (1-indexed) */
function nthWeekday(year, month, weekday, n) {
  const d = new Date(Date.UTC(year, month - 1, 1));
  let count = 0;
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === weekday && ++count === n) return new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/** Last occurrence of weekday (0=Sun … 6=Sat) strictly before day-of-month */
function lastWeekdayBefore(year, month, beforeDay, weekday) {
  const d = new Date(Date.UTC(year, month - 1, beforeDay - 1));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return new Date(d);
}

/**
 * Monday nearest to a specific date.
 * Tie at Thursday resolves to the previous Monday (3 days closer than +4).
 * Offsets indexed by day-of-week [Sun, Mon, Tue, Wed, Thu, Fri, Sat].
 */
function nearestMonday(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const offsets = [1, 0, -1, -2, -3, 3, 2];
  return addDays(d, offsets[d.getUTCDay()]);
}

/**
 * Observed date for fixed holidays (federal convention):
 *   Sunday  → Monday
 *   Saturday → Monday
 */
function observed(d) {
  const dow = d.getUTCDay();
  if (dow === 0) return addDays(d, 1);
  if (dow === 6) return addDays(d, 2);
  return new Date(d);
}

/** Format a Date as YYYY-MM-DD */
function fmt(d) { return d.toISOString().slice(0, 10); }

// ── Holiday record builder ────────────────────────────────────────────────────

function h(name, date, { optional = false, note = null, closures = null } = {}) {
  const rec = { name, date: fmt(date) };
  if (optional)  rec.optional  = true;
  if (note)      rec.note      = note;
  if (closures)  rec.closures  = closures;
  return rec;
}

// ── Per-province holiday definitions ─────────────────────────────────────────

function holidaysFor(year, province) {
  const easter        = easterSunday(year);
  const goodFriday    = addDays(easter, -2);
  const easterMon     = addDays(easter,  1);
  const victoriaDay   = lastWeekdayBefore(year, 5, 25, 1);   // last Mon before May 25
  const familyDay     = nthWeekday(year,  2, 1, 3);           // 3rd Mon in Feb
  const civicHoliday  = nthWeekday(year,  8, 1, 1);           // 1st Mon in Aug
  const labourDay     = nthWeekday(year,  9, 1, 1);           // 1st Mon in Sep
  const thanksgiving  = nthWeekday(year, 10, 1, 2);           // 2nd Mon in Oct

  const newYears      = observed(new Date(Date.UTC(year,  0,  1)));
  const canadaDay     = observed(new Date(Date.UTC(year,  6,  1)));
  const remembrance   =          new Date(Date.UTC(year, 10, 11));
  const christmas     = observed(new Date(Date.UTC(year, 11, 25)));
  const boxingDay     = observed(new Date(Date.UTC(year, 11, 26)));
  const ndtr          =          new Date(Date.UTC(year,  8, 30)); // Sep 30
  const indigenousDay =          new Date(Date.UTC(year,  5, 21)); // Jun 21

  switch (province) {

    case "AB": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Family Day",                                familyDay,    { closures: CL.prov_open   }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_open    }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Heritage Day",                              civicHoliday, { optional: true, note: "Optional — not all employers", closures: CL.optional }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
    ];

    case "BC": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Family Day",                                familyDay,    { closures: CL.prov_open   }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_varies, note: "Retail permitted since 2012 amendments; practice varies" }),
      h("Easter Monday",                             easterMon,    { closures: CL.fed_open    }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("BC Day",                                    civicHoliday, { closures: CL.prov_open   }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
    ];

    case "MB": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Louis Riel Day",                            familyDay,    { closures: CL.prov_open   }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_open    }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Terry Fox Day",                             civicHoliday, { optional: true,           closures: CL.optional }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
    ];

    case "NB": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Family Day",                                familyDay,    { closures: CL.prov_open   }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_closed  }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("New Brunswick Day",                         civicHoliday, { closures: CL.prov_open   }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,    { closures: CL.fed_open    }),
    ];

    case "NL": return [
      h("New Year's Day",                            newYears,                        { closures: CL.fed_open    }),
      h("St. Patrick's Day",                         nearestMonday(year, 3, 17),      { note: "Monday nearest March 17",  closures: CL.prov_closed }),
      h("Good Friday",                               goodFriday,                      { closures: CL.fed_closed  }),
      h("St. George's Day",                          nearestMonday(year, 4, 23),      { note: "Monday nearest April 23",  closures: CL.prov_closed }),
      h("Victoria Day",                              victoriaDay,                     { closures: CL.fed_open    }),
      h("Discovery Day",                             nearestMonday(year, 6, 24),      { note: "Monday nearest June 24",   closures: CL.prov_closed }),
      h("Canada Day",                                canadaDay,                       { closures: CL.fed_open    }),
      h("Orangemen's Day",                           nearestMonday(year, 7, 12),      { note: "Monday nearest July 12",   closures: CL.prov_closed }),
      h("Labour Day",                                labourDay,                       { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving,                    { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,                     { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,                       { closures: CL.fed_closed  }),
    ];

    case "NS": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Heritage Day",                              familyDay,    { note: "3rd Monday in February — Viola Desmond Day", closures: CL.prov_open }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_closed  }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Natal Day",                                 civicHoliday, { optional: true, note: "Not statutory in all municipalities", closures: CL.optional }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,    { closures: CL.fed_open    }),
    ];

    case "NT": return [
      h("New Year's Day",                            newYears,       { closures: CL.fed_open    }),
      h("Good Friday",                               goodFriday,     { closures: CL.fed_varies  }),
      h("Victoria Day",                              victoriaDay,    { closures: CL.fed_open    }),
      h("National Indigenous Peoples Day",           indigenousDay,  { closures: CL.prov_open   }),
      h("Canada Day",                                canadaDay,      { closures: CL.fed_open    }),
      h("Civic Holiday",                             civicHoliday,   { closures: CL.prov_open   }),
      h("Labour Day",                                labourDay,      { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,           { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving,   { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,    { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,      { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,      { closures: CL.fed_open    }),
    ];

    case "NU": return [
      h("New Year's Day",                            newYears,       { closures: CL.fed_open    }),
      h("Good Friday",                               goodFriday,     { closures: CL.fed_varies  }),
      h("Victoria Day",                              victoriaDay,    { closures: CL.fed_open    }),
      h("National Indigenous Peoples Day",           indigenousDay,  { closures: CL.prov_open   }),
      h("Canada Day",                                canadaDay,      { closures: CL.fed_open    }),
      h("Nunavut Day",                               new Date(Date.UTC(year, 6, 9)), { closures: CL.prov_open }),
      h("Civic Holiday",                             civicHoliday,   { closures: CL.prov_open   }),
      h("Labour Day",                                labourDay,      { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,           { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving,   { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,    { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,      { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,      { closures: CL.fed_open    }),
    ];

    case "ON": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Family Day",                                familyDay,    { closures: CL.prov_open   }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_open    }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Civic Holiday",                             civicHoliday, { optional: true, note: "Not statutory — widely observed", closures: CL.optional }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { optional: true, note: "Federal employees only in ON", closures: CL.fed_only }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,    { closures: CL.fed_open    }),
    ];

    case "PE": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Islander Day",                              familyDay,    { note: "3rd Monday in February", closures: CL.prov_open }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_closed  }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Civic Holiday",                             civicHoliday, { optional: true,           closures: CL.optional }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,    { closures: CL.fed_open    }),
    ];

    case "QC": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_open    }),
      h("Easter Monday",                             easterMon,    { closures: CL.fed_open    }),
      h("National Patriots' Day",                    victoriaDay,  { note: "Monday before May 25", closures: CL.fed_open }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Saint-Jean-Baptiste Day",                   new Date(Date.UTC(year, 5, 24)), { note: "Quebec National Day", closures: CL.prov_varies }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { optional: true, note: "Federal employees only", closures: CL.fed_only }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
    ];

    case "SK": return [
      h("New Year's Day",                            newYears,     { closures: CL.fed_open    }),
      h("Family Day",                                familyDay,    { closures: CL.prov_open   }),
      h("Good Friday",                               goodFriday,   { closures: CL.fed_open    }),
      h("Victoria Day",                              victoriaDay,  { closures: CL.fed_open    }),
      h("Canada Day",                                canadaDay,    { closures: CL.fed_open    }),
      h("Saskatchewan Day",                          civicHoliday, { closures: CL.prov_open   }),
      h("Labour Day",                                labourDay,    { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,         { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving, { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,  { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,    { closures: CL.fed_closed  }),
      h("Boxing Day",                                boxingDay,    { closures: CL.fed_open    }),
    ];

    case "YT": return [
      h("New Year's Day",                            newYears,      { closures: CL.fed_open    }),
      h("Good Friday",                               goodFriday,    { closures: CL.fed_varies  }),
      h("Victoria Day",                              victoriaDay,   { closures: CL.fed_open    }),
      h("National Indigenous Peoples Day",           indigenousDay, { closures: CL.prov_open   }),
      h("Canada Day",                                canadaDay,     { closures: CL.fed_open    }),
      h("Discovery Day",                             nthWeekday(year, 8, 1, 3), { note: "3rd Monday in August", closures: CL.prov_open }),
      h("Labour Day",                                labourDay,     { closures: CL.fed_open    }),
      h("National Day for Truth and Reconciliation", ndtr,          { closures: CL.fed_open    }),
      h("Thanksgiving",                              thanksgiving,  { closures: CL.fed_open    }),
      h("Remembrance Day",                           remembrance,   { closures: CL.fed_closed  }),
      h("Christmas Day",                             christmas,     { closures: CL.fed_closed  }),
    ];

    default: return [];
  }
}

function sortedHolidays(list) {
  return list.slice().sort((a, b) => a.date.localeCompare(b.date));
}

// ── Response helpers ──────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS_HEADERS });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return errorResponse("Method not allowed — use GET.", 405);
    }

    // ── Health check (bypasses auth for RapidAPI monitoring) ───────────────
    if (path === "/health") {
      return jsonResponse({ status: "ok" });
    }

    // ── RapidAPI proxy secret check ─────────────────────────────────────────
    if (env.RAPIDAPI_PROXY_SECRET) {
      const incoming = request.headers.get("X-RapidAPI-Proxy-Secret");
      if (incoming !== env.RAPIDAPI_PROXY_SECRET) {
        return errorResponse("Unauthorized.", 401);
      }
    }

    try {
      // ── GET /provinces ──────────────────────────────────────────────────────
      if (path === "/provinces") {
        return jsonResponse({
          provinces: Object.entries(PROVINCES).map(([code, name]) => ({ code, name })),
        });
      }

      // ── GET /holidays ───────────────────────────────────────────────────────
      if (path === "/holidays") {
        const yearParam = url.searchParams.get("year");
        const year      = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear();
        const province  = url.searchParams.get("province")?.toUpperCase() ?? null;

        if (isNaN(year) || year < 2000 || year > 3000) {
          return errorResponse("year must be an integer between 2000 and 3000.");
        }
        if (province && !PROVINCES[province]) {
          return errorResponse(
            `Unknown province code "${province}". Call /provinces for valid codes.`
          );
        }

        if (province) {
          return jsonResponse({
            year,
            province,
            provinceName: PROVINCES[province],
            holidays:     sortedHolidays(holidaysFor(year, province)),
            disclaimer:   "Statutory holiday rules change. Verify compliance-critical dates with official provincial sources.",
          });
        }

        // All provinces
        const holidays = {};
        for (const code of Object.keys(PROVINCES)) {
          holidays[code] = sortedHolidays(holidaysFor(year, code));
        }
        return jsonResponse({
          year,
          holidays,
          disclaimer: "Statutory holiday rules change. Verify compliance-critical dates with official provincial sources.",
        });
      }

      // ── GET /next ───────────────────────────────────────────────────────────
      if (path === "/next") {
        const province = url.searchParams.get("province")?.toUpperCase() ?? null;

        if (!province) {
          return errorResponse("province parameter is required for /next (e.g. ?province=ON).");
        }
        if (!PROVINCES[province]) {
          return errorResponse(
            `Unknown province code "${province}". Call /provinces for valid codes.`
          );
        }

        const today = fmt(new Date());
        for (let y = new Date().getUTCFullYear(); y <= new Date().getUTCFullYear() + 1; y++) {
          const next = sortedHolidays(holidaysFor(y, province)).find(hol => hol.date >= today);
          if (next) {
            return jsonResponse({ province, provinceName: PROVINCES[province], next });
          }
        }
        return jsonResponse({ province, provinceName: PROVINCES[province], next: null });
      }

      // ── 404 ─────────────────────────────────────────────────────────────────
      return errorResponse(
        "Not found. Endpoints: " +
        "GET /provinces | " +
        "GET /holidays?year=YYYY[&province=XX] | " +
        "GET /next?province=XX",
        404
      );

    } catch (e) {
      return errorResponse("Internal server error: " + e.message, 500);
    }
  },
};
