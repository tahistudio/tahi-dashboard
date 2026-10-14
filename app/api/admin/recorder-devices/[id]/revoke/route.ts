import { NextRequest, NextResponse } from 'next/server'
import { revokeRecorderDevice, withRecorderDevicesContext } from '@/lib/recorder-devices'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRecorderDevicesContext(req, async context => NextResponse.json(await revokeRecorderDevice(context, (await params).id)))
}
