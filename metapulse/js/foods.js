/* 常用食物庫的篩選與排序（純函數） */

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');

/** 最近吃過、最常吃的排前面：使用次數 + 最近 14 天內的新近加權 */
export function scoreFood(f, now = Date.now()) {
  const days = f.lastUsed ? (now - f.lastUsed) / 864e5 : Infinity;
  const recency = days === Infinity ? 0 : Math.max(0, 14 - days) * 1.5;
  return (+f.uses || 0) + recency;
}

export function searchFoods(lib, q, now = Date.now()) {
  const k = norm(q);
  const hit = k ? lib.filter(f => norm(f.name).includes(k)) : lib.slice();
  return hit.sort((a, b) => {
    if (k) { // 開頭相符的優先
      const sa = norm(a.name).startsWith(k), sb = norm(b.name).startsWith(k);
      if (sa !== sb) return sa ? -1 : 1;
    }
    return scoreFood(b, now) - scoreFood(a, now) || String(a.name).localeCompare(String(b.name), 'zh-Hant');
  });
}

/** 依名稱（不分大小寫與空白）找既有食物 */
export function findByName(lib, name) {
  const k = norm(name);
  return lib.find(f => norm(f.name) === k) || null;
}

/** 「常吃」：把以前的每一餐（同一個 group）依內容分組，最常吃、最近吃的排前面
 *  同一組 = 食物名稱和份量都一樣。只看最近 60 天；回傳最多 n 組，每組附上最近那一次的品項 */
export function frequentMeals(meals, now = Date.now(), n = 6) {
  const since = now - 60 * 864e5, byGroup = new Map();
  for (const m of meals || []) {
    const t = Date.parse(m.at);
    if (!m.group || !(t >= since) || t > now) continue;
    if (!byGroup.has(m.group)) byGroup.set(m.group, []);
    byGroup.get(m.group).push(m);
  }
  const sets = new Map();
  for (const items of byGroup.values()) {
    const key = items.map(m => norm(m.name) + '×' + (Math.round((+m.qty || 0) * 4) / 4) + (m.unit || '')).sort().join('|');
    const t = Date.parse(items[0].at);
    const s = sets.get(key) || { key, count: 0, last: 0, items };
    s.count++;
    if (t > s.last) { s.last = t; s.items = items; }
    sets.set(key, s);
  }
  return [...sets.values()]
    .map(s => ({ ...s, score: s.count + Math.max(0, 14 - (now - s.last) / 864e5) * 0.3,
      label: s.items.map(m => m.name).join('＋'), points: s.items.reduce((a, m) => a + (+m.points || 0), 0) }))
    .sort((a, b) => b.score - a.score || b.last - a.last)
    .slice(0, n);
}
