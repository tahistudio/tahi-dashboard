import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { RECORDER_DEVICES_MIGRATION } from './recorder-devices-migration'

describe('recorder devices migration 0114', () => {
  it('mirrors the standalone SQL and contains only additive, re-runnable creates', () => {
    const sql = readFileSync('drizzle/migrations/0114_recorder_devices.sql', 'utf8')
      .replace(/^--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)
    const normalise = (value: string) => value.replace(/\s+/g, ' ').trim()
    expect(sql.map(normalise)).toEqual(RECORDER_DEVICES_MIGRATION.map(normalise))
    for (const statement of sql) expect(statement).toMatch(/^CREATE (?:TABLE|INDEX) IF NOT EXISTS /)
    expect(sql.filter(statement => statement.startsWith('CREATE TABLE'))).toHaveLength(4)
  })

  it('preserves existing recordings, enforces identity constraints and can run twice', () => {
    const database = new DatabaseSync(':memory:')
    try {
      database.exec('PRAGMA foreign_keys=ON; CREATE TABLE meeting_recordings (id text PRIMARY KEY);')
      database.exec("INSERT INTO meeting_recordings VALUES ('recording-1'), ('recording-2')")
      for (let run = 0; run < 2; run++) {
        for (const statement of RECORDER_DEVICES_MIGRATION) database.exec(statement)
      }
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'recorder_%' ORDER BY name").all()
      expect(tables.map(row => row.name)).toEqual([
        'recorder_devices', 'recorder_pairing_attempts', 'recorder_pairing_codes', 'recorder_recordings',
      ])
      database.exec("INSERT INTO recorder_devices(id,team_member_id,name,token_hash,created_at,last_seen_at) VALUES ('device-1','member','PC','hash','now','now')")
      expect(() => database.exec("INSERT INTO recorder_devices(id,team_member_id,name,token_hash,created_at,last_seen_at) VALUES ('device-2','member','Other PC','hash','now','now')")).toThrow(/UNIQUE/)
      database.exec("INSERT INTO recorder_recordings VALUES ('recording-1','device-1','member','ref',NULL,'now')")
      expect(() => database.exec("INSERT INTO recorder_recordings VALUES ('recording-2','device-1','member','ref',NULL,'now')")).toThrow(/UNIQUE/)
      expect(() => database.exec("INSERT INTO recorder_recordings VALUES ('missing','device-2','member','ref',NULL,'now')")).toThrow(/FOREIGN KEY/)
      expect(database.prepare('SELECT COUNT(*) AS total FROM meeting_recordings').get()?.total).toBe(2)
      const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_recorder_%' ORDER BY name").all()
      expect(indexes).toHaveLength(5)
    } finally {
      database.close()
    }
  })
})
