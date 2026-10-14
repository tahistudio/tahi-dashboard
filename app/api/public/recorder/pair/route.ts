import { NextRequest } from 'next/server'
import { exchangeRecorderPairingCode, recorderDevicesResponse } from '@/lib/recorder-devices'

export async function POST(req: NextRequest) {
  return recorderDevicesResponse(() => exchangeRecorderPairingCode(req))
}
