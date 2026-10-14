import { NextRequest, NextResponse } from 'next/server'
import { createRecorderPairingCode, withRecorderDevicesContext } from '@/lib/recorder-devices'

export async function POST(req: NextRequest) {
  return withRecorderDevicesContext(req, async context => NextResponse.json(await createRecorderPairingCode(context), {
    status: 201, headers: { 'Cache-Control': 'no-store' },
  }), true)
}
