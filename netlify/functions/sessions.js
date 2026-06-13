const GAS_URL = 'https://script.google.com/macros/s/AKfycby_cX5hecM9YE5cns8I1BKSDR_WqbMoVarOGAY-JtqVIs-0_iGzd9OfIOam_ly5wOE/exec';

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
      const res = await fetch(GAS_URL + '?sheet=sessions', { redirect: 'follow' });
      const text = await res.text();
      return { statusCode: 200, headers, body: text };
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
