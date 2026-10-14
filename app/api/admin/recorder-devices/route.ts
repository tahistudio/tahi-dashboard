import { NextRequest, NextResponse } from 'next/server'
import { listRecorderDevices, withRecorderDevicesContext } from '@/lib/recorder-devices'

export async function GET(req: NextRequest) {
  return withRecorderDevicesContext(req, async context => NextResponse.json({ items: await listRecorderDevices(context) }))
}
