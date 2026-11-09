
import { getStore } from '@netlify/blobs';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const bookings = getStore({
  name: 'cj-group-bookings',
  consistency: 'strong'
});

const validStatuses = [
  'Pending',
  'Confirmed',
  'Cancelled'
];

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function authenticated(request) {
  const password = process.env.CJ_ADMIN_PASSWORD || '';
  const supplied = request.headers.get('x-cj-admin-password') || '';

  if (!password || !supplied) return false;

  const a = Buffer.from(password);
  const b = Buffer.from(supplied);

  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(request) {
  try {
    // CREATE A BOOKING
    if (request.method === 'POST') {
      const data = await request.json();

      const booking = {
        id: randomUUID(),
        customer_name: String(data.customer_name || '').trim(),
        customer_phone: String(data.customer_phone || '').trim(),
        customer_email: String(data.customer_email || '').trim(),
        division: String(data.division || '').trim(),
        service_requested: String(data.service_requested || '').trim(),
        preferred_date: String(data.preferred_date || '').trim(),
        special_notes: String(data.special_notes || '').trim(),
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
        return response({
          success: false,
          error: 'Please complete all required fields.'
        }, 400);
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(booking.customer_email)) {
        return response({
          success: false,
          error: 'Please enter a valid email address.'
        }, 400);
      }

      await bookings.setJSON(
        `booking/${booking.id}`,
        booking
      );

      return response({
        success: true,
        message: 'Booking received successfully.',
        booking: {
          id: booking.id,
          status: booking.status
        }
      }, 201);
    }

    // ADMIN ACCESS REQUIRED
    if (!authenticated(request)) {
      return response({
        success: false,
        error: 'Dashboard authentication required.'
      }, 401);
    }

    // VIEW ALL BOOKINGS
    if (request.method === 'GET') {
      const { blobs } = await bookings.list({
        prefix: 'booking/'
      });

      const records = await Promise.all(
        blobs.map(({ key }) =>
          bookings.get(key, { type: 'json' })
        )
      );

      const results = records
        .filter(Boolean)
        .sort((a, b) =>
          String(b.submitted_at || '').localeCompare(
            String(a.submitted_at || '')
          )
        );

      return response({
        success: true,
        bookings: results
      });
    }

    // UPDATE BOOKING STATUS
    if (request.method === 'PATCH') {
      const data = await request.json();

      const id = String(data.id || '');
      const status = String(data.status || '');

      if (!id || !validStatuses.includes(status)) {
        return response({
          success: false,
          error: 'Invalid booking ID or status.'
        }, 400);
      }

      const key = `booking/${id}`;

      const booking = await bookings.get(key, {
        type: 'json'
      });

      if (!booking) {
        return response({
          success: false,
          error: 'Booking not found.'
        }, 404);
      }

      booking.status = status;
      booking.updated_at = new Date().toISOString();

      await bookings.setJSON(key, booking);

      return response({
        success: true,
        booking
      });
    }

    return response({
      success: false,
      error: 'Method not allowed.'
    }, 405);

  } catch (error) {
    console.error('C&J booking error:', error);

    return response({
      success: false,
      error: 'Something went wrong. Please try again.'
    }, 500);
  }
        }
