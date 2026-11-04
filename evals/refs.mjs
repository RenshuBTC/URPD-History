// The independent references the data checks compare against: BRK's own day series (bitview.space), fetched once a
// run. The site builds each day from BRK's URPD buckets; these are BRK's separately computed totals for the same day.

const BASE = "https://bitview.space";
export const SERIES = ["date", "price_close", "circulating_supply", "realized_cap", "supply_in_profit_share", "sth_supply", "lth_supply"];

async function getJSON(url) {
  let last;
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { "user-agent": "bitcoinurpd-evals" } });
      if (r.ok) return await r.json();
      last = new Error("HTTP " + r.status + " for " + url);
      if (r.status < 500 && r.status !== 429) break;
    } catch (e) { last = e; }
    await new Promise((res) => setTimeout(res, 2000 * (k + 1)));
  }
  throw last;
}

// ref(name, "YYYY-MM-DD"): the series' value on that day, or null.
export async function loadRefs() {
  const data = {};
  for (const name of SERIES) {
    const j = await getJSON(`${BASE}/api/series/${name}/day1`);
    data[name] = Array.isArray(j) ? j : j.data;
  }
  const index = new Map(data.date.map((d, i) => [d, i]));
  return { ref: (name, day) => { const i = index.get(day); const v = i === undefined ? null : data[name][i]; return v == null ? null : v; },
    lastDay: data.date[data.date.length - 1] };
}
