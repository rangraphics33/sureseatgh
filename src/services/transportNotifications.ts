import { getSupabaseClient } from './supabaseClient.ts'

export interface TransportNotification {
  id: string
  bookingId: string | null
  departureId: string | null
  eventType: string
  title: string
  message: string
  createdAt: string
  readAt: string | null
}

interface NotificationRow {
  notification_id: string
  booking_id: string | null
  departure_id: string | null
  event_type: string
  title: string
  message: string
  created_at: string
  read_at: string | null
}

function throwOnError(error: { message: string } | null, operation: string) {
  if (error) throw new Error(`${operation}: ${error.message}`)
}

export const transportNotificationService = {
  async listMine(limit = 50): Promise<TransportNotification[]> {
    const { data, error } = await getSupabaseClient().rpc('list_my_transport_notifications', {
      p_limit: limit,
    })
    throwOnError(error, 'Could not load notifications')
    return ((data ?? []) as NotificationRow[]).map((row) => ({
      id: row.notification_id,
      bookingId: row.booking_id,
      departureId: row.departure_id,
      eventType: row.event_type,
      title: row.title,
      message: row.message,
      createdAt: row.created_at,
      readAt: row.read_at,
    }))
  },

  async markAllRead(): Promise<void> {
    const { error } = await getSupabaseClient().rpc('mark_my_transport_notifications_read')
    throwOnError(error, 'Could not mark notifications as read')
  },
}
