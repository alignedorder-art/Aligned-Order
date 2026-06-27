const GAS_URL = 'https://script.google.com/macros/s/AKfycby_cX5hecM9YE5cns8I1BKSDR_WqbMoVarOGAY-JtqVIs-0_iGzd9OfIOam_ly5wOE/exec';
const CALENDLY_TOKEN = 'eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzgxMzM2NTAyLCJqdGkiOiJhYjRkZGYxYS0wNTBlLTRlNDUtOGM2Yy0yZjk5ZmY5ZjNjNzEiLCJ1c2VyX3V1aWQiOiJmNjdjNWM2ZC0wMjkyLTRkMjUtYjliNC1hM2I4MDNkNWFlYmIiLCJzY29wZSI6ImF2YWlsYWJpbGl0eTpyZWFkIGF2YWlsYWJpbGl0eTp3cml0ZSBldmVudF90eXBlczpyZWFkIGV2ZW50X3R5cGVzOndyaXRlIGxvY2F0aW9uczpyZWFkIHJvdXRpbmdfZm9ybXM6cmVhZCBzaGFyZXM6d3JpdGUgc2NoZWR1bGVkX2V2ZW50czpyZWFkIHNjaGVkdWxlZF9ldmVudHM6d3JpdGUgc2NoZWR1bGluZ19saW5rczp3cml0ZSB3ZWJob29rczpyZWFkIHdlYmhvb2tzOndyaXRlIGdyb3VwczpyZWFkIG9yZ2FuaXphdGlvbnM6cmVhZCBvcmdhbml6YXRpb25zOndyaXRlIHVzZXJzOnJlYWQgY29udGFjdHM6cmVhZCBjb250YWN0czp3cml0ZSJ9.s0ZRGgAouaYitWQxM6IYKqmHDeoIv4q5PfqHurMfK2vkTuyIOGGfM7nVF2QtYw_YFno3VoaRWtdFm3Iua8HNVg';

async function fetchWithTimeout(url, options = {}, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {

    // ── GET: return Calendly sessions + admin-assigned from GAS ──────────────
    if (event.httpMethod === 'GET') {
      const results = [];

      // Run Calendly fetch + GAS sessions fetch in parallel
      const [calendlyDone, gasDone] = await Promise.allSettled([

        // 1. Calendly events
        (async () => {
          const userRes = await fetchWithTimeout('https://api.calendly.com/users/me', {
            headers: { 'Authorization': 'Bearer ' + CALENDLY_TOKEN }
          }, 5000);
          const userData = await userRes.json();
          const userUri = userData.resource && userData.resource.uri;
          if (!userUri) return [];

          const eventsRes = await fetchWithTimeout(
            `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&count=20&sort=start_time:desc`,
            { headers: { 'Authorization': 'Bearer ' + CALENDLY_TOKEN } },
            5000
          );
          const eventsData = await eventsRes.json();
          const events = eventsData.collection || [];

          const inviteePromises = events.map(async (ev) => {
            try {
              const uuid = ev.uri.split('/').pop();
              const invRes = await fetchWithTimeout(
                `https://api.calendly.com/scheduled_events/${uuid}/invitees?count=1`,
                { headers: { 'Authorization': 'Bearer ' + CALENDLY_TOKEN } },
                4000
              );
              const invData = await invRes.json();
              const inv = invData.collection && invData.collection[0];
              if (!inv) return null;
              return {
                first_name:   inv.name ? (inv.name.split(' ')[0] || inv.name) : (inv.email ? inv.email.split('@')[0] : 'Unknown'),
                last_name:    inv.name && inv.name.split(' ').length > 1 ? inv.name.split(' ').slice(1).join(' ') : '',
                email:        inv.email || '',
                phone:        '',
                session_type: ev.name || 'Session',
                datetime:     ev.start_time || '',
                meeting_link: (ev.location && ev.location.join_url) || '',
                status:       ev.status === 'canceled' ? 'cancelled' : 'confirmed',
                notes:        '',
                outcome:      '',
                calendly_id:  uuid,
                created_at:   ev.created_at || '',
                source:       'calendly'
              };
            } catch(e) { return null; }
          });

          const invitees = await Promise.all(inviteePromises);
          return invitees.filter(Boolean);
        })(),

        // 2. Admin-assigned sessions from GAS sessions sheet
        (async () => {
          const res = await fetchWithTimeout(
            GAS_URL + '?sheet=sessions',
            { redirect: 'follow' },
            6000
          );
          const text = await res.text();
          try {
            const rows = JSON.parse(text);
            if (!Array.isArray(rows)) return [];

            // Only include admin-assigned (no calendly_id, or explicitly source=manual)
            // Exclude Calendly webhook entries which have both calendly_id + no manual marker
            return rows.filter(r => {
              const hasCalendlyId = !!(r.calendly_id && String(r.calendly_id).trim());
              const isManual = (r.source === 'manual') ||
                               (r.assigned_by_admin === true) ||
                               (r.assigned_by_admin === 'true') ||
                               (r.assigned_by_admin === 'TRUE');
              // Include if: no calendly_id (pure admin assign) OR explicitly marked manual
              return (!hasCalendlyId || isManual) && (r.first_name || r.email) && r.datetime;
            }).map(r => ({
              first_name:   String(r.first_name   || ''),
              last_name:    String(r.last_name    || ''),
              email:        String(r.email        || ''),
              phone:        String(r.phone        || ''),
              session_type: String(r.session_type || ''),
              datetime:     String(r.datetime     || ''),
              meeting_link: String(r.meeting_link || ''),
              status:       String(r.status       || 'pending'),
              notes:        String(r.notes        || ''),
              outcome:      String(r.outcome      || ''),
              calendly_id:  '',
              created_at:   String(r.created_at   || ''),
              source:       'manual'
            }));
          } catch(e) {
            console.warn('GAS parse error:', e.message);
            return [];
          }
        })()

      ]);

      // Merge results
      const calendlySessions = (calendlyDone.status === 'fulfilled' ? calendlyDone.value : []) || [];
      const gasSessions      = (gasDone.status      === 'fulfilled' ? gasDone.value      : []) || [];

      // Deduplicate: if same person/date appears in both, prefer Calendly version
      const calKeys = new Set(calendlySessions.map(s => s.email + '|' + (s.datetime||'').slice(0,10)));
      const uniqueGas = gasSessions.filter(s =>
        !calKeys.has(s.email + '|' + (s.datetime||'').slice(0,10))
      );

      calendlySessions.forEach(s => results.push(s));
      uniqueGas.forEach(s => results.push(s));

      // Sort newest first
      results.sort((a, b) => new Date(b.datetime) - new Date(a.datetime));

      console.log(`Sessions returned: ${calendlySessions.length} Calendly + ${uniqueGas.length} admin-assigned`);
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    // ── POST: save a session to GAS ──────────────────────────────────────────
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      const res = await fetchWithTimeout(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...data, sheet: 'sessions' }),
        redirect: 'follow'
      }, 8000);
      const text = await res.text();
      return { statusCode: 200, headers, body: text };
    }

    // ── PATCH: update a session in GAS ───────────────────────────────────────
    if (event.httpMethod === 'PATCH') {
      const data = JSON.parse(event.body);
      const res = await fetchWithTimeout(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...data, sheet: 'sessions', _action: 'update' }),
        redirect: 'follow'
      }, 8000);
      const text = await res.text();
      return { statusCode: 200, headers, body: text };
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
