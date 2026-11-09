
import { getStore } from '@netlify/blobs';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const store = getStore({
  name: 'cj-bookings',
  consistency: 'strong'
});

const allowedStatuses = ['Pending', 'Confirmed', 'Cancelled'];

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function isAdmin(request) {
  const expected = process.env.CJ_ADMIN_PASSWORD || '';
  const supplied = request.headers.get('x-cj-admin-password') || '';

  if (!expected || !supplied) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);

  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(request) {
  if (request.method === 'POST') {
    let body;

    try {
      body = await request.json();
    } catch {
      return reply({ error: 'Invalid booking details.' }, 400);
    }

    const booking = {
      id: randomUUID(),
      customer_name: String(body.customer_name || '').trim(),
      customer_phone: String(body.customer_phone || '').trim(),
      customer_email: String(body.customer_email || '').trim(),
      division: String(body.division || '').trim(),
      service_requested: String(body.service_requested || '').trim(),
      preferred_date: String(body.preferred_date || '').trim(),
      special_notes: String(body.special_notes || '').trim(),
      submitted_at: new Date().toISOString(),
      status: 'Pending'
    };

    if (
      !booking.customer_name ||
      !booking.customer_phone ||
      !booking.customer_email ||
      !booking.division ||
      !booking.service_requested ||
      !booking.preferred_date
    ) {
      return reply({ error: 'Please complete all required fields.' }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.customer_email)) {
      return reply({ error: 'Enter a valid email address.' }, 400);
    }

    booking.customer_name = booking.customer_name.slice(0, 120);
    booking.customer_phone = booking.customer_phone.slice(0, 40);
    booking.customer_email = booking.customer_email.slice(0, 160);
    booking.division = booking.division.slice(0, 100);
    booking.service_requested = booking.service_requested.slice(0, 180);
    booking.preferred_date = booking.preferred_date.slice(0, 30);
    booking.special_notes = booking.special_notes.slice(0, 1200);

    await store.setJSON(`booking/${booking.id}`, booking);

    return reply({
      success: true,
      booking: {
        id: booking.id,
        status: booking.status
      }
    }, 201);
  }

  if (!isAdmin(request)) {
    return reply({ error: 'Dashboard authentication required.' }, 401);
  }

  if (request.method === 'GET') {
    const { blobs } = await store.list({ prefix: 'booking/' });

    const bookings = (
      await Promise.all(
        blobs.map(({ key }) =>
          store.get(key, { type: 'json' })
        )
      )
    ).filter(Boolean);

    bookings.sort((a, b) =>
      String(b.submitted_at).localeCompare(String(a.submitted_at))
    );

    return reply({ bookings });
  }

  if (request.method === 'PATCH') {
    let body;

    try {
      body = await request.json();
    } catch {
      return reply({ error: 'Invalid update.' }, 400);
    }

    const id = String(body.id || '');
    const status = String(body.status || '');

    if (!id || !allowedStatuses.includes(status)) {
      return reply({ error: 'Invalid booking ID or status.' }, 400);
    }

    const key = `booking/${id}`;
    const booking = await store.get(key, { type: 'json' });

    if (!booking) {
      return reply({ error: 'Booking not found.' }, 404);
    }

    booking.status = status;
    booking.updated_at = new Date().toISOString();

    await store.setJSON(key, booking);

    return reply({ success: true, booking });
  }

  return reply({ error: 'Method not allowed.' }, 405);
      }
