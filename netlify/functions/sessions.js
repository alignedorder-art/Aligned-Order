const GAS_URL      = 'https://script.google.com/macros/s/AKfycby_cX5hecM9YE5cns8I1BKSDR_WqbMoVarOGAY-JtqVIs-0_iGzd9OfIOam_ly5wOE/exec';
const CALENDLY_TOKEN = 'eyJraWQiOiIxY2UxZTEzNjE3ZGNmNzY2YjNjZWJjY2Y4ZGM1YmFmYThhNjVlNjg0MDIzZjdjMzJiZTgzNDliMjM4MDEzNWI0IiwidHlwIjoiUEFUIiwiYWxnIjoiRVMyNTYifQ.eyJpc3MiOiJodHRwczovL2F1dGguY2FsZW5kbHkuY29tIiwiaWF0IjoxNzgxMzMzOTYxLCJqdGkiOiJjNWU0MDkxMi01ZmQ2LTRkOTctOWY0OS0wYTY5NDhmMTA2NTUiLCJ1c2VyX3V1aWQiOiJmNjdjNWM2ZC0wMjkyLTRkMjUtYjliNC1hM2I4MDNkNWFlYmIiLCJzY29wZSI6IndlYmhvb2tzOnJlYWQgd2ViaG9va3M6d3JpdGUifQ.SZE7Tjxa7GX0_edWoux90CmxLVC3-0DTkF5BBD4gDMqdpjT0AOE3hVPSLD2dAsKsINre6mIlgCEdbQFUO9P0MA';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    if (event.httpMethod === 'GET') {
      // 1. Get manual sessions from Google Sheet
      let sheetSessions = [];
      try {
        const sheetRes = await fetch(GAS_URL + '?sheet=sessions', { redirect: 'follow' });
        const sheetText = await sheetRes.text();
        const parsed = JSON.parse(sheetText);
        if (Array.isArray(parsed)) sheetSessions = parsed;
      } catch(e) {}

      // 2. Get Calendly bookings
      let calendlySessions = [];
      try {
        // First get user URI
        const userRes = await fetch('https://api.calendly.com/users/me', {
          headers: { 'Authorization': 'Bearer ' + CALENDLY_TOKEN, 'Content-Type': 'application/json' }
        });
        const userData = await userRes.json();
        const userUri = userData.resource && userData.resource.uri;

        if (userUri) {
          // Get scheduled events
          const eventsRes = await fetch(
            `https://api.calendly.com/scheduled_events?user=${encodeURIComponent(userUri)}&count=100&sort=start_time:desc`,
            { headers: { 'Authorization': 'Bearer ' + CALENDLY_TOKEN, 'Content-Type': 'application/json' } }
          );
          const eventsData = await eventsRes.json();
          const events = (eventsData.collection || []).filter(e => e.status !== 'canceled');

          // Get invitee details for each event
          for (const ev of events.slice(0, 20)) {
            try {
              const uuid = ev.uri.split('/').pop();
              const invRes = await fetch(
                `https://api.calendly.com/scheduled_events/${uuid}/invitees?count=1`,
                { headers: { 'Authorization': 'Bearer ' + CALENDLY_TOKEN } }
              );
              const invData = await invRes.json();
              const inv = invData.collection && invData.collection[0];
              if (inv) {
                calendlySessions.push({
                  first_name:   inv.name ? inv.name.split(' ')[0] : '',
                  last_name:    inv.name ? inv.name.split(' ').slice(1).join(' ') : '',
                  email:        inv.email || '',
                  phone:        '',
                  session_type: ev.name || 'Session',
                  datetime:     ev.start_time || '',
                  meeting_link: (ev.location && ev.location.join_url) || '',
                  status:       ev.status === 'active' ? 'confirmed' : ev.status,
                  notes:        '',
                  outcome:      '',
                  calendly_id:  uuid,
                  created_at:   ev.created_at || '',
                  source:       'calendly'
                });
              }
            } catch(e) {}
          }
        }
      } catch(e) {
        console.warn('Calendly fetch error:', e.message);
      }

      // 3. Merge — Calendly sessions take priority, add manual ones not in Calendly
      const calendlyEmails = new Set(calendlySessions.map(s => s.email));
      const manualOnly = sheetSessions.filter(s => !calendlyEmails.has(s.email));
      const merged = [...calendlySessions, ...manualOnly];

      return { statusCode: 200, headers, body: JSON.stringify(merged) };
    }

    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body);
      const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...data, sheet: 'sessions' }),
        redirect: 'follow'
      });
      const text = await res.text();
      return { statusCode: 200, headers, body: text };
    }

    if (event.httpMethod === 'PATCH') {
      const data = JSON.parse(event.body);
      const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ ...data, sheet: 'sessions', _action: 'update' }),
        redirect: 'follow'
      });
      const text = await res.text();
      return { statusCode: 200, headers, body: text };
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
