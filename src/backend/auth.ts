import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'pg';
import type { BackendConfig } from './config.js';
import { ApiError, bad, email, hash, hex, lockAccount, rateLimit, record, string, tag, token } from './core.js';
import { transaction, type Transaction } from './database.js';

const derive = promisify(scrypt);
const accessSeconds = 15 * 60;
const refreshDays = 30;

export interface Principal {
  accountId: string;
  username: string;
  deviceId: string;
  deviceTag: string;
  sessionId: string;
}

const denied = () => new ApiError(401, 'AUTH_REQUIRED');
const rejected = () => new ApiError(401, 'PROJECT_AUTH_FAILED');
const invitationRejected = () => new ApiError(403, 'INVITE_INVALID');

async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64) as Buffer).toString('hex');
}

async function matches(password: string, stored: string | undefined) {
  const [salt, digest] = (stored || '').split(':');
  const valid = !!salt && /^[a-f0-9]{128}$/.test(digest ?? '');
  const candidate = await derive(password, valid ? salt! : 'findlink-unregistered-account', 64) as Buffer;
  return valid && timingSafeEqual(candidate, Buffer.from(digest!, 'hex'));
}

async function issueSession(db: Transaction, accountId: string, deviceId: string, id = randomUUID()) {
  const accessToken = token(), refreshToken = token();
  await db.query(`INSERT INTO findlink_control.sessions(id,account_id,device_id,access_hash,refresh_hash,access_until,refresh_until)
    VALUES($1,$2,$3,$4,$5,now()+make_interval(secs=>$6),now()+make_interval(days=>$7))
    ON CONFLICT(id) DO UPDATE SET access_hash=excluded.access_hash,refresh_hash=excluded.refresh_hash,
      access_until=excluded.access_until,refresh_until=excluded.refresh_until`,
    [id, accountId, deviceId, hash(accessToken), hash(refreshToken), accessSeconds, refreshDays]);
  return { accessToken, refreshToken, expiresIn: accessSeconds, deviceId };
}

async function redeem(db: Transaction, code: string, account: string, purpose: 'NEW' | 'RECOVERY', address?: string) {
  const { rows } = await db.query(`SELECT * FROM findlink_control.invites
    WHERE hash=$1 AND redeemed_at IS NULL AND expires_at>now() FOR UPDATE`, [hash(code)]);
  const invite = rows[0];
  if (!invite || (address && invite.email !== address) || (invite.account_id && invite.account_id !== account)
    || (purpose === 'RECOVERY') !== (invite.purpose === 'RECOVERY')) throw invitationRejected();
  await db.query('UPDATE findlink_control.invites SET account_id=$2,redeemed_at=now() WHERE hash=$1', [invite.hash, account]);
  return invite as { email: string; purpose: 'TRIAL' | 'ACCOUNT' | 'RECOVERY' };
}

export function createAuth(pool: Pool, config: BackendConfig) {
  const deviceTag = (deviceKey: string) => tag(config.identityKey, 'device', hex(deviceKey));

  async function principal(access: unknown, deviceKey: unknown): Promise<Principal> {
    if (typeof access !== 'string' || !/^[a-f0-9]{64}$/.test(access) || typeof deviceKey !== 'string' || !/^[a-f0-9]{64}$/.test(deviceKey)) throw denied();
    const key = deviceTag(deviceKey);
    const { rows } = await pool.query(`SELECT s.id,s.account_id,s.device_id,u.username
      FROM findlink_control.sessions s JOIN findlink_control.devices d ON d.id=s.device_id
      JOIN csd_backup.users u ON u.id=s.account_id
      WHERE s.access_hash=$1 AND d.key_hash=$2 AND s.access_until>now() AND d.revoked_at IS NULL`,
      [hash(access), key]);
    const row = rows[0];
    if (!row) throw denied();
    return { accountId: row.account_id, username: row.username, deviceId: row.device_id, sessionId: row.id, deviceTag: key };
  }

  async function login(value: unknown, deviceKey: string, ipTag: string, register: boolean) {
    const body = record(value);
    const username = string(body.username, 200).trim().normalize('NFC').toLowerCase();
    if (!username) throw bad('PROJECT_AUTH_INPUT_INVALID');
    const password = string(body.password, register ? 256 : 1024, register ? 12 : 1);
    const code = body.invite ? hex(body.invite) : null;
    if (register && !code) throw invitationRejected();
    const address = register ? email(username) : null;
    const key = deviceTag(deviceKey);
    await rateLimit(pool, 'auth:ip:' + ipTag, 25, 900);
    await rateLimit(pool, 'auth:user:' + tag(config.identityKey, 'login', username), 8, 900);
    await rateLimit(pool, 'auth:device:' + key, 15, 900);
    let accountId = randomUUID();
    let passwordDigest: string | null = null;
    if (register) passwordDigest = await passwordHash(password);
    else {
      const { rows } = await pool.query('SELECT id,password_hash FROM csd_backup.users WHERE username=$1', [username]);
      if (!await matches(password, rows[0]?.password_hash)) throw rejected();
      accountId = rows[0].id;
      passwordDigest = rows[0].password_hash;
    }

    try {
      return await transaction(pool, async db => {
        if (register) await db.query('INSERT INTO csd_backup.users(id,username,password_hash) VALUES($1,$2,$3)', [accountId, username, passwordDigest]);
        else {
          const current = await db.query('SELECT password_hash FROM csd_backup.users WHERE id=$1 FOR UPDATE', [accountId]);
          if (current.rows[0]?.password_hash !== passwordDigest) throw rejected();
        }
        await db.query('INSERT INTO findlink_control.accounts(id) VALUES($1) ON CONFLICT DO NOTHING', [accountId]);
        const account = await lockAccount(db, accountId);
        if (code) {
          const invite = await redeem(db, code, accountId, 'NEW', address ?? account.email ?? undefined);
          await db.query('UPDATE findlink_control.accounts SET email=$2,email_verified_at=now() WHERE id=$1', [accountId, invite.email]);
        }
        let deviceId = (await db.query('SELECT id,revoked_at FROM findlink_control.devices WHERE account_id=$1 AND key_hash=$2', [accountId, key])).rows[0];
        if (deviceId?.revoked_at) throw new ApiError(403, 'DEVICE_REVOKED');
        if (!deviceId) {
          const count = (await db.query('SELECT count(*)::int AS n FROM findlink_control.devices WHERE account_id=$1 AND revoked_at IS NULL', [accountId])).rows[0].n;
          if (count >= 2) throw new ApiError(403, 'DEVICE_LIMIT_REACHED');
          deviceId = { id: randomUUID() };
          await db.query('INSERT INTO findlink_control.devices(id,account_id,key_hash) VALUES($1,$2,$3)', [deviceId.id, accountId, key]);
        }
        await db.query('UPDATE findlink_control.devices SET seen_at=now() WHERE id=$1', [deviceId.id]);
        // A device has one active desktop session. Restarting the client rotates that session.
        await db.query('DELETE FROM findlink_control.sessions WHERE device_id=$1', [deviceId.id]);
        return { id: accountId, username, ...await issueSession(db, accountId, deviceId.id) };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ApiError(409, 'PROJECT_USERNAME_EXISTS');
      throw error;
    }
  }

  async function refresh(value: unknown, deviceKey: string) {
    const refreshHash = hash(hex(record(value).refreshToken)), key = deviceTag(deviceKey);
    await rateLimit(pool, 'refresh:' + key, 60, 900);
    const session = await transaction(pool, async db => {
      const { rows } = await db.query(`SELECT s.* FROM findlink_control.sessions s JOIN findlink_control.devices d ON d.id=s.device_id
        WHERE s.refresh_hash=$1 AND d.key_hash=$2 AND s.refresh_until>now() AND d.revoked_at IS NULL FOR UPDATE OF s`, [refreshHash, key]);
      const row = rows[0];
      if (!row) {
        await db.query(`DELETE FROM findlink_control.sessions s USING findlink_control.refresh_replays r,findlink_control.devices d
          WHERE r.refresh_hash=$1 AND r.until_at>now() AND r.session_id=s.id AND d.id=s.device_id AND d.key_hash=$2`, [refreshHash, key]);
        return null;
      }
      await db.query('INSERT INTO findlink_control.refresh_replays VALUES($1,$2,$3)', [refreshHash, row.id, row.refresh_until]);
      return issueSession(db, row.account_id, row.device_id, row.id);
    });
    if (!session) throw denied();
    return session;
  }

  async function recover(value: unknown, ipTag: string) {
    const body = record(value);
    const code = hex(body.code);
    const password = string(body.password, 256, 12);
    await rateLimit(pool, 'recover:' + ipTag, 8, 900);
    const encoded = await passwordHash(password);
    await transaction(pool, async db => {
      const { rows } = await db.query(`SELECT account_id FROM findlink_control.invites WHERE hash=$1 AND purpose='RECOVERY'`, [hash(code)]);
      const accountId = rows[0]?.account_id;
      if (!accountId) throw invitationRejected();
      // Lock in the same order as password login.
      await db.query('SELECT id FROM csd_backup.users WHERE id=$1 FOR UPDATE', [accountId]);
      await lockAccount(db, accountId);
      await redeem(db, code, accountId, 'RECOVERY');
      await db.query('UPDATE csd_backup.users SET password_hash=$2 WHERE id=$1', [accountId, encoded]);
      await db.query('DELETE FROM findlink_control.sessions WHERE account_id=$1', [accountId]);
      await db.query('UPDATE findlink_control.accounts SET epoch=epoch+1 WHERE id=$1', [accountId]);
    });
  }

  return {
    principal, login, refresh, recover, deviceTag,
    async logout(actor: Principal) {
      await transaction(pool, async db => {
        await lockAccount(db, actor.accountId);
        const current = await db.query('DELETE FROM findlink_control.sessions WHERE id=$1 RETURNING id', [actor.sessionId]);
        if (current.rowCount) await db.query('UPDATE findlink_control.leases SET ended_at=now() WHERE device_id=$1 AND ended_at IS NULL', [actor.deviceId]);
      });
    },
  };
}
