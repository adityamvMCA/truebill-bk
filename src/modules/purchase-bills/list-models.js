const base = process.env.LLM_BASE_URL;
const key = process.env.LLM_API_KEY;

fetch(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } })
  .then((r) => r.json())
  .then((j) => (j.data || []).forEach((m) => console.log(m.id)))
  .catch((e) => console.error(e.message));