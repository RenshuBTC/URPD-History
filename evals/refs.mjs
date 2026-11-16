// The independent references the data checks compare against: BRK's own series (bitview.space), fetched once a run.
// The site builds each day or block from BRK's URPD buckets; these are BRK's separately computed totals for the same
// day (the day series) or the same block (the same series by height, asked for one block at a time).

const BASE = "https://bitview.space";
export const SERIES = ["date", "first_height", "price_close", "circulating_supply", "realized_cap", "supply_in_profit_share", "sth_supply", "lth_supply"];
export const BLOCK_SERIES = ["timestamp", "price", "circulating_supply", "realized_cap", "supply_in_profit_share", "sth_supply", "lth_supply"];

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

// ref(name, "YYYY-MM-DD"): the series' value on that day, or null. refAt(name, height): its value at that block, or
// null (asked for the heights given). dayOf(height): the day BRK puts that block on. lastHeight(day): the day's last
// block, or null for the day in progress.
export async function loadRefs(heights = []) {
  const data = {};
  for (const name of SERIES) {
    const j = await getJSON(`${BASE}/api/series/${name}/day1`);
    data[name] = Array.isArray(j) ? j : j.data;
  }
  const index = new Map(data.date.map((d, i) => [d, i]));
  const blocks = new Map();
  for (const h of [...new Set(heights)].filter((x) => Number.isInteger(x) && x >= 0)) {
    const at = {};
    for (const name of BLOCK_SERIES) {
      try {
        const j = await getJSON(`${BASE}/api/series/${name}/height?start=${h}&limit=1`);
        at[name] = j && j.start === h && Array.isArray(j.data) && j.data.length ? j.data[0] : null;
      } catch (e) { at[name] = null; }
    }
    blocks.set(h, at);
  }
  const firsts = data.first_height;
  return {
    ref: (name, day) => { const i = index.get(day); const v = i === undefined ? null : data[name][i]; return v == null ? null : v; },
    refAt: (name, h) => { const at = blocks.get(h); return at && at[name] != null ? at[name] : null; },
    dayOf: (h) => { let day = null; for (let i = 0; i < data.date.length; i++) if (typeof firsts[i] === "number" && data.date[i] && firsts[i] <= h) day = data.date[i]; return day; },
    lastHeight: (day) => { const i = index.get(day); if (i === undefined) return null; for (let j = i + 1; j < firsts.length; j++) if (typeof firsts[j] === "number" && data.date[j]) return firsts[j] - 1; return null; },
    firstHeight: (day) => { const i = index.get(day); return i === undefined || typeof firsts[i] !== "number" ? null : firsts[i]; },
    lastDay: data.date[data.date.length - 1],
  };
}
