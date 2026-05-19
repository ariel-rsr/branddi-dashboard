export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.PIPEDRIVE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { filterId, userId, done } = req.query;
  if (!filterId && !userId) return res.status(400).json({ error: 'filterId or userId required' });

  const BASE = 'https://brandmonitor.pipedrive.com/api/v1';
  const isDone = done === '1';

  try {
    // Fetch filter conditions from Pipedrive
    let conditions = null;
    if (filterId) {
      const fRes = await fetch(`${BASE}/filters/${filterId}?api_token=${apiKey}`);
      const fData = await fRes.json();
      if (!fData.success) return res.status(400).json({ error: 'Filter not found' });
      conditions = fData.data.conditions;
    }

    // Fetch all activities for the user(s)
    const userIds = userId ? [userId] : ['26246629', '26246640'];
    const allowed = ['26246629', '26246640'];
    for (const uid of userIds) {
      if (!allowed.includes(uid)) return res.status(403).json({ error: 'Unauthorized userId' });
    }

    let allActivities = [];
    for (const uid of userIds) {
      let start = 0;
      while (true) {
        const url = `${BASE}/activities?user_id=${uid}&limit=100&start=${start}&api_token=${apiKey}`;
        const r = await fetch(url);
        const j = await r.json();
        if (!j.success) break;
        allActivities = allActivities.concat(j.data || []);
        if (!j.additional_data?.pagination?.more_items_in_collection) break;
        start += 100;
        if (allActivities.length > 3000) break;
      }
    }

    // Apply done filter
    let filtered = allActivities.filter(a => {
      const actDone = a.done === true || a.done === 1;
      return isDone ? actDone : !actDone;
    });

    // Apply Pipedrive filter conditions if present
    if (conditions) {
      filtered = filtered.filter(a => applyConditions(a, conditions));
    }

    return res.status(200).json({ success: true, data: filtered });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── Condition evaluator ────────────────────────────────────────────────────
// field_id map (activity object fields used in IC filters)
const FIELD_MAP = {
  '2':  (a) => a.subject || '',           // subject
  '3':  (a) => a.type || '',              // type
  '4':  (a) => String(a.done || false),   // done
  '5':  (a) => a.marked_as_done_time || a.update_time || '', // done_date
  '9':  (a) => a.due_date || '',          // due_date
  '14': (a) => String(a.user_id || ''),   // assigned_to_user_id
};

function getField(a, fieldId) {
  const fn = FIELD_MAP[fieldId];
  return fn ? fn(a) : '';
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function thisMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth()+1, 0);
  return { start: fmtDate(start), end: fmtDate(end) };
}

function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function evalCondition(a, cond) {
  const { field_id, operator, value, json_value_flag } = cond;
  const fieldVal = getField(a, field_id);

  // Parse JSON value arrays (e.g. type lists)
  let parsedValue = value;
  if (json_value_flag) {
    try { parsedValue = JSON.parse(value); } catch(e) { parsedValue = value; }
  }

  switch (operator) {
    case '=':
      if (Array.isArray(parsedValue)) {
        return parsedValue.includes(fieldVal);
      }
      // Handle special date keywords
      if (value === 'today') return fieldVal <= todayStr();
      if (value === 'this_month') {
        const { start, end } = thisMonthRange();
        return fieldVal >= start && fieldVal <= end;
      }
      if (value === 'true') return fieldVal === 'true' || fieldVal === true;
      if (value === 'false') return fieldVal === 'false' || fieldVal === false || fieldVal === '';
      return String(fieldVal) === String(value);

    case '!=':
      return String(fieldVal).toLowerCase() !== String(value).toLowerCase();

    case '<=':
      if (value === 'today') return fieldVal <= todayStr();
      if (value === 'this_month') return fieldVal <= thisMonthRange().end;
      return fieldVal <= value;

    case '>=':
      if (value === 'today') return fieldVal >= todayStr();
      return fieldVal >= value;

    case "LIKE '%$%'":
      return String(fieldVal).toLowerCase().includes(String(value).toLowerCase());

    case "NOT LIKE '%$%'":
      return !String(fieldVal).toLowerCase().includes(String(value).toLowerCase());

    default:
      return true; // unknown operator: don't filter out
  }
}

function applyConditions(a, condGroup) {
  if (!condGroup || !condGroup.conditions) return true;

  const results = condGroup.conditions.map(cond => {
    // Nested group
    if (cond.conditions) return applyConditions(a, cond);
    // Leaf condition
    return evalCondition(a, cond);
  });

  if (condGroup.glue === 'or') return results.some(Boolean);
  return results.every(Boolean); // 'and'
}
