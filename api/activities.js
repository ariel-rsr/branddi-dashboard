export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.PIPEDRIVE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { userId, start = 0 } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const allowed = ['26246629', '26246640'];
  if (!allowed.includes(userId)) return res.status(403).json({ error: 'Unauthorized userId' });

  try {
    const url = `https://brandmonitor.pipedrive.com/api/v1/activities?user_id=${userId}&limit=100&start=${start}&api_token=${apiKey}`;
    const upstream = await fetch(url);
    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
