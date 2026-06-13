const GAS_URL = 'https://script.google.com/macros/s/AKfycby_cX5hecM9YE5cns8I1BKSDR_WqbMoVarOGAY-JtqVIs-0_iGzd9OfIOam_ly5wOE/exec';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const eventType = body.event;
    const payload = body.payload;

    // Only process new bookings
    if (eventType !== 'invitee.created') {
      return { statusCode: 200, headers, body: JSON.stringify({ result: 'ignored' }) };
    }

    const invitee = payload.invitee;
    const eventDetails = payload.event;
    const questions = payload.questions_and_answers || [];

    // Extract phone from questions if available
    const phoneQ = questions.find(q =>
      q.question.toLowerCase().includes('phone') ||
      q.question.toLowerCase().includes('whatsapp')
    );

    const session = {
      sheet: 'sessions',
      first_name:   invitee.name ? invitee.name.split(' ')[0] : '',
      last_name:    invitee.name ? invitee.name.split(' ').slice(1).join(' ') : '',
      email:        invitee.email || '',
      phone:        phoneQ ? phoneQ.answer : '',
      session_type: eventDetails.name || 'Discovery Call',
      datetime:     eventDetails.start_time || new Date().toISOString(),
      meeting_link: eventDetails.location?.join_url || '',
      status:       'confirmed',
      notes:        '',
      outcome:      '',
      calendly_id:  invitee.uuid || '',
      created_at:   new Date().toISOString()
    };

    // Save to Google Sheet sessions tab
    await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(session),
      redirect: 'follow'
    });

    return { statusCode: 200, headers, body: JSON.stringify({ result: 'success' }) };
  } catch (err) {
    console.error('Webhook error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
