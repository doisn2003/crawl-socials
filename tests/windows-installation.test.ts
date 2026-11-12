import assert from 'node:assert/strict';
import test from 'node:test';
import { installationTagFromRegistry } from '../src/infrastructure/managed/windows-installation.js';

test('trial installation tags are stable for the Windows installation and omit the registry identifier', () => {
  const guid = '174f9d8b-78a3-4434-a682-e48afb75c9e5';
  const entry = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${guid}\r\n\r\n`;
  const tag = installationTagFromRegistry(entry);
  assert.match(tag ?? '', /^[a-f\d]{64}$/);
  assert.equal(installationTagFromRegistry(entry.replace(guid, guid.toUpperCase())), tag);
  assert.notEqual(installationTagFromRegistry(entry.replace('174f', '274f')), tag);
  assert.equal(installationTagFromRegistry(entry.replace('MachineGuid', 'OtherValue')), undefined);
  assert.equal(installationTagFromRegistry(entry.replace('REG_SZ', 'REG_BINARY')), undefined);
  assert.equal(installationTagFromRegistry(entry.replace(guid, 'unknown')), undefined);
});
